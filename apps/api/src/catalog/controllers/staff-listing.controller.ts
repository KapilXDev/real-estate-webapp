import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  JwtAuthGuard,
  StaffOnly,
  type AuthenticatedRequest,
} from "../../identity/guards/jwt-auth.guard";
import { CreateListingDto, UpdateListingDto } from "../dto/write-listing.dto";
import { ListingAdminService } from "../services/listing-admin.service";

/**
 * Staff inventory management.
 *
 * ⚠️ `@StaffOnly()` IS ON THE CLASS, NOT THE ROUTES. The guard only enforces a principal kind when
 * a route asks for one, so a write route that forgot the decorator would accept a CONSUMER's
 * access token — a valid, unexpired token belonging to a buyer who signed in by phone OTP, now
 * able to create listings. `/auth/staff/me` shipped with exactly that gap once. At class level
 * the safe answer is the default and a new route has to opt out to be wrong.
 */
@Controller("staff/listings")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffListingController {
  constructor(private readonly listings: ListingAdminService) {}

  /**
   * ⚠️ The organisation comes from `request.principal`, never from the body.
   *
   * `CreateListingDto` has no `organizationId` field at all, so there is nothing for a caller to
   * set. Combined with the `listing_write_policy` WITH CHECK in the database, a cross-tenant write
   * needs both the DTO and the RLS policy to be wrong at the same time.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateListingDto, @Req() request: AuthenticatedRequest) {
    return this.listings.create(dto, {
      organizationId: request.principal!.org!,
      userId: request.principal!.sub,
    });
  }

  @Patch(":listingId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param("listingId") listingId: string,
    @Body() dto: UpdateListingDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.listings.update(listingId, dto, {
      organizationId: request.principal!.org!,
      userId: request.principal!.sub,
    });
  }

  /**
   * The organisation's own inventory INCLUDING drafts — which the public catalog never returns.
   *
   * No organisation filter in the query: RLS scopes it to the caller's org. That is the point of
   * the design, and adding a redundant `WHERE organization_id = ...` here would invite someone
   * later to make it a parameter.
   */
  @Get()
  async list(@Req() request: AuthenticatedRequest, @Query("status") status?: string) {
    return this.listings.listForOrg({ organizationId: request.principal!.org! }, status);
  }

  /**
   * One listing, for the edit form.
   *
   * ⚠️ Returns the STAFF projection, not the public one — raw stored values, drafts included, no
   * derived RERA or agent fields. See `staff-listing.row.ts` for why the two are separate types.
   */
  @Get(":listingId")
  async getOne(@Param("listingId") listingId: string, @Req() request: AuthenticatedRequest) {
    return this.listings.getForEdit(listingId, { organizationId: request.principal!.org! });
  }
}
