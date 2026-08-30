import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";

import {
  JwtAuthGuard,
  Public,
  StaffOnly,
  type AuthenticatedRequest,
} from "../../identity/guards/jwt-auth.guard";
import { ReorderMediaDto, UploadMediaDto } from "../dto/media.dto";
import { toAdminMediaDto, toMediaDto } from "../mappers/media.mapper";
import { MediaService } from "../services/media.service";

/**
 * Photo delivery — public, and the highest-traffic route on the API.
 *
 * ⚠️ A PROXY, NOT A REDIRECT TO STORAGE. Redirecting to a bucket URL would be cheaper, and it
 * would also make every photo world-readable to anyone holding the URL, regardless of whether the
 * listing is PRIVATE or still a DRAFT. `streamVariant` resolves the row under the caller's tenant
 * context first, so RLS decides — which is the whole reason `listing_media` went under RLS in
 * migration 0018.
 *
 * In production a CDN sits in front of this. The long `Cache-Control` below is what makes that
 * work: the variant keys are immutable, so an edge cache never needs to revalidate.
 */
@Controller("media")
export class MediaDeliveryController {
  constructor(private readonly media: MediaService) {}

  /**
   * ⚠️ DECLARED BEFORE `:mediaId/:variant`, and it has to be.
   *
   * Nest matches in declaration order, so with the parameter route first, a request for
   * `/media/listings/{uuid}` binds `mediaId = "listings"` and `variant = "{uuid}"` — and the
   * literal segment is never reached. It fails as `invalid input syntax for type uuid` deep in
   * the driver, which points at the repository rather than at the routing table. Exactly the trap
   * called out in PublicCatalogController, walked into anyway, and caught by the smoke test.
   */
  @Public()
  @Get("listings/:listingId")
  async forListing(@Param("listingId") listingId: string) {
    const rows = await this.media.listForListing(listingId);
    return rows.map(toMediaDto);
  }

  @Public()
  /*
   * Deliberately loose compared to the other public routes. A single listing page pulls a dozen
   * images at once, and a browser opening six parallel connections must not trip the limiter —
   * the failure mode is a page of broken images, which looks like the site is broken.
   */
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Get(":mediaId/:variant")
  async serve(
    @Param("mediaId") mediaId: string,
    @Param("variant") variant: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.media.streamVariant(mediaId, variant);
    if (!result) throw new NotFoundException("Image not found.");

    response.setHeader("Content-Type", result.contentType);
    // Variant objects are immutable — a reprocess writes new keys under a new media id — so this
    // can be cached indefinitely by browsers and CDNs alike.
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // The bytes are an image and nothing else; stops a content-sniffing browser from deciding
    // otherwise on a response the API serves from user-supplied input.
    response.setHeader("X-Content-Type-Options", "nosniff");

    result.body.pipe(response);
  }
}

/**
 * Staff photo management.
 *
 * `@StaffOnly()` on the class for the usual reason — a route that forgets the decorator would
 * accept a buyer's phone-OTP token, and here that means a buyer uploading images to an agent's
 * listing.
 */
@Controller("staff/listings/:listingId/media")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffMediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * ⚠️ `memoryStorage` is implicit (no `dest`), so the file lands in a Buffer rather than a temp
   * file. That is what we want — sharp reads from memory and nothing needs cleaning up — but it
   * makes the size limit load-bearing rather than advisory: without it, a large upload is
   * unbounded heap allocation on an authenticated endpoint.
   *
   * The limit is duplicated in MediaService; multer stops the stream early, the service is the
   * backstop for any other caller.
   */
  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("listingId") listingId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadMediaDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file received. Send multipart/form-data with a "file" field.',
      );
    }

    return this.media.upload(
      { listingId, buffer: file.buffer, caption: dto.caption },
      { organizationId: request.principal!.org! },
    );
  }

  /** Includes PENDING and FAILED rows — the agent needs to see an upload that did not work. */
  @Get()
  async list(@Param("listingId") listingId: string, @Req() request: AuthenticatedRequest) {
    const rows = await this.media.listForAdmin(listingId, {
      organizationId: request.principal!.org!,
    });
    return rows.map(toAdminMediaDto);
  }

  /**
   * Reorder. The first entry becomes the hero image, which is the highest-leverage single
   * decision on a listing page.
   */
  @Put("order")
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @Param("listingId") listingId: string,
    @Body() dto: ReorderMediaDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.media.reorder(listingId, dto.order, {
      organizationId: request.principal!.org!,
    });
  }

  @Delete(":mediaId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("mediaId") mediaId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.media.remove(mediaId, { organizationId: request.principal!.org! });
  }
}
