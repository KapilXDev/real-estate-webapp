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
   *
   * ⚠️⚠️ BOTH NAMED LIMITERS MUST BE OVERRIDDEN, NOT JUST `default`. `ThrottlerModule.forRoot`
   * declares two — `short` (10 per SECOND) and `default` (120 per minute) — and `@Throttle` only
   * replaces the ones it names. Raising `default` alone left `short` in force, so the eleventh
   * image in any one second got a 429 and the browser rendered a blank box for it. A search page
   * with fifteen cards therefore lost a third of its photos, exactly the failure this decorator
   * was written to prevent, and it is invisible to any test that fetches one image at a time.
   *
   * Found by the browser suite: 20 parallel requests to one image returned ten 200s and ten 429s.
   */
  @Throttle({
    short: { limit: 200, ttl: 1_000 },
    default: { limit: 600, ttl: 60_000 },
  })
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

    /*
     * ⚠️⚠️ WITHOUT THIS, EVERY LISTING PHOTO IS BLANK IN A BROWSER — AND FINE IN curl.
     *
     * `helmet()` sets `Cross-Origin-Resource-Policy: same-origin` globally, which tells the
     * browser to refuse to EMBED this response in a document from another origin. The public site
     * runs on a different origin from the API (:3000 vs :3001 in dev, and separate hosts in
     * production), so every `<img>` was being blocked at render time.
     *
     * It is invisible to any command-line check: curl, fetch-in-node and the API's own tests all
     * return 200 with correct bytes, because CORP is enforced by the browser, not the server. It
     * was verified "working" three separate ways before someone actually looked at the page.
     *
     * Public listing photos are meant to be embedded on other origins — that is the entire point
     * of a media URL — so this route opts out. Nothing else does, and the staff route below stays
     * same-origin because those images are session-scoped and are only ever shown by the admin.
     */
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    result.body.pipe(response);
  }
}

/**
 * Staff photo delivery.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THE PUBLIC ROUTE ABOVE CANNOT SERVE A DRAFT'S PHOTOS, EVER.
 *
 * `MediaDeliveryController.serve` is `@Public()`, which means the guard skips token verification
 * entirely — so `request.principal` is never populated and the lookup runs as ANONYMOUS. RLS then
 * correctly refuses the media of a PENDING_REVIEW or PRIVATE listing, *even when the request
 * carries a perfectly valid staff token for the organisation that owns it*.
 *
 * The effect was that an agent uploading a photo to a new listing — which starts as a draft —
 * saw the upload succeed and then a blank thumbnail, with a 404 and no explanation. Indisting-
 * uishable from "the upload is broken", which is what it was reported as.
 *
 * The fix is a separate authenticated route rather than optional auth on the public one: making
 * the guard populate a principal on `@Public()` routes would change the behaviour of every public
 * endpoint at once, to fix one. Here the auth posture is explicit in the path.
 */
@Controller("staff/media")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffMediaDeliveryController {
  constructor(private readonly media: MediaService) {}

  /*
   * ⚠️ Same two-limiter trap as the public delivery route above — see the long note there. The
   * admin's photo grid loads every thumbnail on a listing at once, so without raising `short`
   * (10 per second) an agent with a dozen photos sees the last few as grey boxes, which is
   * indistinguishable from a failed upload.
   */
  @Throttle({
    short: { limit: 200, ttl: 1_000 },
    default: { limit: 600, ttl: 60_000 },
  })
  @Get(":mediaId/:variant")
  async serve(
    @Param("mediaId") mediaId: string,
    @Param("variant") variant: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    // The caller's own tenant context — so RLS resolves in favour of their own drafts, and still
    // refuses another organisation's inventory.
    const result = await this.media.streamVariant(mediaId, variant, {
      organizationId: request.principal!.org!,
    });
    if (!result) throw new NotFoundException("Image not found.");

    response.setHeader("Content-Type", result.contentType);
    // Private, and briefly: an agent who replaces a photo should see the change, and this is a
    // per-user response that must never be cached by a shared proxy.
    response.setHeader("Cache-Control", "private, max-age=60");
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
