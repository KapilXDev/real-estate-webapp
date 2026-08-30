import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import type { TenantContext } from "../../database/database.service";
import type { CreateListingDto, UpdateListingDto } from "../dto/write-listing.dto";
import { toStaffListing, toStaffListingSummary } from "../mappers/staff-listing.mapper";
import {
  FACING_TO_DB,
  FURNISHING_TO_DB,
  POSSESSION_TO_DB,
  PROPERTY_TYPE_TO_DB,
  STATUS_TO_DB,
  TRANSACTION_TO_DB,
} from "../utils/enum-maps";
import { ListingWriteRepository } from "../repositories/listing-write.repository";
import { PropertyRepository } from "../repositories/property.repository";
import { ReraRepository } from "../repositories/rera.repository";

/**
 * Staff write operations on listings.
 *
 * This is where the rules that are neither storage nor transport live — most importantly the one
 * below, which is a legal requirement rather than a product preference.
 */
@Injectable()
export class ListingAdminService {
  private readonly logger = new Logger(ListingAdminService.name);

  constructor(
    private readonly properties: PropertyRepository,
    private readonly listings: ListingWriteRepository,
    private readonly rera: ReraRepository,
  ) {}

  /**
   * ⚠️⚠️ THE RERA PUBLICATION GATE. Do not add a bypass flag to this.
   *
   * A registered agent's RERA number must appear in ALL advertising, and a listing page is
   * advertising. The penalty runs to ₹10 lakh. The agent here spans two jurisdictions — Punjab
   * RERA for Mohali/Kharar/Zirakpur, Chandigarh's own separate authority for Chandigarh — so
   * holding *a* registration is not enough: it has to be the one for the authority that governs
   * the property being advertised.
   *
   * So publication is blocked at the service layer, where every write path must pass, rather than
   * relying on the UI to check. The listing can be created and edited freely as a DRAFT; it just
   * cannot go ACTIVE without a valid registration for its own jurisdiction.
   *
   * Deliberately checked on the transition to ACTIVE rather than on every save: an agent adding
   * inventory before their Chandigarh registration comes through should be able to prepare it,
   * and blocking the draft would push them to enter it somewhere else instead.
   */
  private async assertPublishable(
    context: TenantContext,
    organizationId: string,
    state: string,
  ): Promise<void> {
    const registration = await this.rera.findValid(organizationId, state, context);
    if (!registration) {
      throw new ForbiddenException(
        `Cannot publish a listing in ${state}: this organisation has no valid RERA registration ` +
          `for that jurisdiction. A registration number must appear in all advertising, and ` +
          `${state} is regulated separately from the rest of the tricity. Add one before ` +
          `publishing, or save the listing as a draft.`,
      );
    }
  }

  async create(
    dto: CreateListingDto,
    principal: { organizationId: string; userId: string },
  ): Promise<{ id: string }> {
    const context: TenantContext = { organizationId: principal.organizationId };

    const localityId = await this.properties.resolveLocality(
      dto.citySlug,
      dto.localitySlug,
      context,
    );
    if (!localityId) {
      /*
       * ⚠️ Resolved as a PAIR. Locality slugs are unique per city only, so "sector-70" alone is
       * ambiguous across Mohali, Chandigarh and Zirakpur — and guessing wrong would file the
       * property in a different town, which is the single most damaging data error this endpoint
       * can make. An unknown pair is rejected rather than partially matched.
       */
      throw new BadRequestException(
        `Unknown locality "${dto.citySlug}/${dto.localitySlug}". Locality slugs are unique per ` +
          `city, so both parts must match.`,
      );
    }

    const status = STATUS_TO_DB[dto.status ?? "active"];
    if (status === "ACTIVE") {
      const state = await this.stateForLocality(context, dto.citySlug, dto.localitySlug);
      await this.assertPublishable(context, principal.organizationId, state);
    }

    const propertyId = await this.properties.findOrCreate(
      {
        localityId,
        propertyType: PROPERTY_TYPE_TO_DB[dto.propertyType],
        lat: dto.lat,
        lng: dto.lng,
        addressLine: dto.addressLine,
        plotNumber: dto.plotNumber,
        pincode: dto.pincode,
        plotAreaSqft: dto.plotAreaSqft,
        builtUpAreaSqft: dto.builtUpAreaSqft,
        carpetAreaSqft: dto.carpetAreaSqft,
        areaInputValue: dto.areaInputValue,
        areaInputUnit: dto.areaInputUnit,
        areaConversionFactor: dto.areaConversionFactor,
        areaInputBasis: dto.areaInputBasis,
        bedrooms: dto.bedrooms,
        bathrooms: dto.bathrooms,
        balconies: dto.balconies,
        totalFloors: dto.totalFloors,
        floorNumber: dto.floorNumber,
        facing: dto.facing ? FACING_TO_DB[dto.facing] : undefined,
        yearBuilt: dto.yearBuilt,
      },
      context,
    );

    const id = await this.listings.create(
      {
        organizationId: principal.organizationId,
        propertyId,
        listedByUserId: principal.userId,
        transactionType: TRANSACTION_TO_DB[dto.transactionType ?? "sale"],
        status,
        visibility: dto.visibility ?? "PUBLIC",
        possession: POSSESSION_TO_DB[dto.possession ?? "ready-to-move"],
        possessionDate: dto.possessionDate,
        price: dto.price,
        priceOnRequest: dto.priceOnRequest,
        maintenanceMonthly: dto.maintenanceCharges,
        furnishing: dto.furnishing ? FURNISHING_TO_DB[dto.furnishing] : undefined,
        title: dto.title,
        description: dto.description,
        features: dto.features,
      },
      context,
    );

    // The opening price is the first point on the price-history line. Without it, the first
    // reduction has nothing to be a reduction FROM and "reduced by ₹5L" cannot be computed.
    await this.listings.recordPriceChange(id, dto.price, principal.userId, context);

    return { id };
  }

  async update(
    listingId: string,
    dto: UpdateListingDto,
    principal: { organizationId: string; userId: string },
  ): Promise<void> {
    const context: TenantContext = { organizationId: principal.organizationId };

    const current = await this.listings.findState(listingId, context);
    /*
     * Not found and not yours are reported identically. RLS already returns zero rows for another
     * organisation's listing, and distinguishing the two here would turn this endpoint into an
     * oracle for probing which listing ids exist in a competitor's inventory.
     */
    if (!current) throw new NotFoundException("Listing not found.");

    const nextStatus = dto.status ? STATUS_TO_DB[dto.status] : undefined;
    if (nextStatus === "ACTIVE" && current.status !== "ACTIVE") {
      await this.assertPublishable(context, principal.organizationId, current.city_state);
    }

    const updated = await this.listings.update(
      listingId,
      {
        status: nextStatus,
        visibility: dto.visibility,
        possession: dto.possession ? POSSESSION_TO_DB[dto.possession] : undefined,
        possessionDate: dto.possessionDate,
        price: dto.price,
        priceOnRequest: dto.priceOnRequest,
        maintenanceMonthly: dto.maintenanceCharges,
        furnishing: dto.furnishing ? FURNISHING_TO_DB[dto.furnishing] : undefined,
        title: dto.title,
        description: dto.description,
        features: dto.features,
        closePrice: dto.closePrice,
      },
      context,
    );
    if (!updated) throw new NotFoundException("Listing not found.");

    // Only when it actually moved — an edit that re-submits the same price must not draw a
    // "price changed" marker on the history chart.
    if (dto.price !== undefined && Number(current.price) !== dto.price) {
      await this.listings.recordPriceChange(listingId, dto.price, principal.userId, context);
    }
  }

  async listForOrg(principal: { organizationId: string }, status?: string) {
    const rows = await this.listings.findForOrg(
      { organizationId: principal.organizationId },
      { status },
    );
    return rows.map(toStaffListingSummary);
  }

  /** One listing, with every field the edit form needs to round-trip it. */
  async getForEdit(listingId: string, principal: { organizationId: string }) {
    const row = await this.listings.findOneForEdit(listingId, {
      organizationId: principal.organizationId,
    });
    if (!row) throw new NotFoundException("Listing not found.");
    return toStaffListing(row);
  }

  /** The jurisdiction a locality falls under, for the RERA gate. */
  private async stateForLocality(
    context: TenantContext,
    citySlug: string,
    localitySlug: string,
  ): Promise<string> {
    const state = await this.properties.stateForLocality(citySlug, localitySlug, context);
    if (!state) {
      throw new BadRequestException(`Unknown locality "${citySlug}/${localitySlug}".`);
    }
    return state;
  }
}
