import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { Public } from "../../identity/guards/jwt-auth.guard";
import { SearchListingsDto } from "../dto/search-listings.dto";
import { CatalogService } from "../services/catalog.service";

/**
 * The public catalog — everything an anonymous visitor to the website reads.
 *
 * ⚠️ EVERY ROUTE HERE IS `@Public()`. That is the product: a property search that requires a login
 * is a property search nobody uses, and these pages must be crawlable for SEO, which is a core
 * feature rather than a nice-to-have. Tenant isolation on this surface comes from RLS evaluating
 * an anonymous context, not from authentication.
 *
 * The controller does no work beyond shape: parse, delegate, translate a null into a 404. Anything
 * resembling a decision belongs in `CatalogService`.
 */
@Controller("catalog")
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /**
   * ⚠️ Throttled more tightly than the global default despite being a read.
   *
   * Search is the most expensive public operation on the platform — full-text, spatial
   * intersection against a GiST index, and a window count, all reachable without credentials.
   * The global limit is sized for ordinary API traffic, not for someone iterating polygons.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("listings")
  async search(@Query() query: SearchListingsDto) {
    return this.catalog.search(query.toParams());
  }

  /**
   * ⚠️ Declared BEFORE `listings/:listingKey`.
   *
   * Nest matches routes in declaration order, so a `:listingKey` parameter route registered first
   * would swallow `/listings/own` and hand the literal string "own" to the service as a uuid. The
   * symptom is a 404 on a page that plainly exists — cheap to avoid, annoying to diagnose.
   */
  @Public()
  @Get("listings/own")
  async ownListings(@Query("includeSold") includeSold?: string) {
    return this.catalog.getHostListings({ includeSold: includeSold === "true" });
  }

  @Public()
  @Get("listings/:listingKey")
  async byKey(@Param("listingKey") listingKey: string) {
    const listing = await this.catalog.getByKey(listingKey);
    // 404 rather than 200-with-null: a withdrawn listing must read as gone to a crawler, or the
    // URL stays indexed and buyers keep landing on an empty page.
    if (!listing) throw new NotFoundException("Listing not found.");
    return listing;
  }

  /**
   * Listings in one locality.
   *
   * The city segment is not decoration — locality slugs are unique per city only, so
   * `/localities/sector-70/listings` would be ambiguous across three municipalities.
   */
  @Public()
  @Get("localities/:citySlug/:localitySlug/listings")
  async byLocality(
    @Param("citySlug") citySlug: string,
    @Param("localitySlug") localitySlug: string,
    @Query("limit") limit?: string,
  ) {
    return this.catalog.getByLocality({ citySlug, localitySlug }, clampLimit(limit));
  }

  @Public()
  @Get("localities/:citySlug/:localitySlug/stats")
  async localityStats(
    @Param("citySlug") citySlug: string,
    @Param("localitySlug") localitySlug: string,
  ) {
    // Null is a legitimate answer — not enough inventory to publish a figure — so it is returned
    // as a 200 with an explicit shape rather than a 404, which would imply the locality is unknown.
    const stats = await this.catalog.getMarketStats({ citySlug, localitySlug });
    return { stats };
  }

  @Public()
  @Get("cities/:citySlug/listings")
  async byCity(@Param("citySlug") citySlug: string, @Query("limit") limit?: string) {
    return this.catalog.getByCity(citySlug, clampLimit(limit));
  }
}

/** Clamped rather than validated: a bad `limit` should narrow the page, never fail the request. */
function clampLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(60, Math.max(1, Math.floor(parsed)));
}
