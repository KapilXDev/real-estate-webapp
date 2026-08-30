import {
  toSearchParams,
  type ListingDto,
  type ListingSearchParamsDto,
  type ListingSearchResponseDto,
  type MarketStatsDto,
} from "@tricity/contracts";
import type { AreaUnit } from "@tricity/domain";

import type { ListingProvider, MarketStats } from "./provider";
import type {
  Listing,
  ListingQuery,
  ListingResult,
  ListingStatus,
  LocalityRef,
  PropertyType,
  StoredArea,
} from "./types";

/**
 * Real inventory, served by the NestJS catalog service.
 *
 * This is the provider the site runs on once there is anything to sell. `MockProvider` stays for
 * local development and for the period before real listings are entered — see `index.ts` for how
 * the choice is made.
 *
 * ⚠️ `isLiveData = true`. That flag is not cosmetic: it un-suppresses RERA attribution and lets
 * `robots.ts` allow indexing. Setting it while this provider is pointed at seeded demo data would
 * publish fabricated inventory under a real registration number, which is an advertising problem
 * rather than a display bug. Point it at a database with real listings, or don't set
 * `LISTING_PROVIDER=api`.
 *
 * ⚠️ EVERY METHOD HERE RUNS ON THE SERVER. Listing and locality pages are Server Components by
 * design — SEO is a core feature — so `API_URL` is a server-only variable with no `NEXT_PUBLIC_`
 * prefix. If a client component ever needs listings it must go through a route handler, not
 * through this class; importing it into the browser bundle would leak the internal API origin.
 */
export class ApiProvider implements ListingProvider {
  readonly name = "ApiProvider (NestJS catalog)";
  readonly isLiveData = true;

  private readonly baseUrl: string;
  private readonly revalidateSeconds: number;

  constructor(options: { baseUrl?: string; revalidateSeconds?: number } = {}) {
    const base = options.baseUrl ?? process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
    if (!base) {
      throw new Error(
        "LISTING_PROVIDER=api requires API_URL (e.g. http://localhost:3001/api). " +
          "Set it in .env — see .env.example.",
      );
    }
    this.baseUrl = base.replace(/\/$/, "");
    /*
     * 60s ISR by default. Property listings are not real-time: a price change appearing a minute
     * late costs nothing, whereas an uncached search means every crawler hit is a spatial query.
     * `getByKey` overrides this — see the note there.
     */
    this.revalidateSeconds = options.revalidateSeconds ?? 60;
  }

  private async get<T>(path: string, init?: { revalidate?: number }): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        next: { revalidate: init?.revalidate ?? this.revalidateSeconds },
      });
    } catch (error) {
      /*
       * ⚠️ A DOWN API MUST NOT TAKE THE WEBSITE DOWN.
       *
       * These calls happen during server rendering, so an unhandled throw is a 500 on a page a
       * buyer (or Googlebot) is looking at. Returning null degrades to "no listings here", which
       * the pages already handle because the empty-inventory state has to exist anyway. The log
       * line is what makes the outage visible.
       */
      console.error(`[ApiProvider] ${url} failed:`, error);
      return null;
    }

    // 404 is a legitimate answer for a withdrawn listing, not an error worth logging.
    if (response.status === 404) return null;
    if (!response.ok) {
      console.error(`[ApiProvider] ${url} returned ${response.status}`);
      return null;
    }

    return (await response.json()) as T;
  }

  async search(query: ListingQuery): Promise<ListingResult> {
    const params = toSearchParams(toContractParams(query));
    const result = await this.get<ListingSearchResponseDto>(
      `/catalog/listings?${params.toString()}`,
    );

    if (!result) {
      // Shape matters: the UI reads `total` for the result count and `page` for pagination, so a
      // failed fetch has to return a well-formed empty page rather than a partial object.
      return { listings: [], total: 0, page: query.page ?? 1, pageSize: query.pageSize ?? 24 };
    }

    return {
      listings: result.listings.map(toListing),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async getByKey(listingKey: string): Promise<Listing | null> {
    /*
     * Shorter cache than search: this is the page where someone decides to call about a property.
     * A stale "Active" badge on a listing that went under offer this morning wastes the buyer's
     * time and the agent's credibility, which is worth more than the cache hit.
     */
    const dto = await this.get<ListingDto>(`/catalog/listings/${encodeURIComponent(listingKey)}`, {
      revalidate: 30,
    });
    return dto ? toListing(dto) : null;
  }

  async getOwnListings(opts: { includeSold?: boolean } = {}): Promise<Listing[]> {
    const dtos = await this.get<ListingDto[]>(
      `/catalog/listings/own?includeSold=${opts.includeSold ? "true" : "false"}`,
    );
    return (dtos ?? []).map(toListing);
  }

  async getByLocality(ref: LocalityRef, limit = 12): Promise<Listing[]> {
    const dtos = await this.get<ListingDto[]>(
      `/catalog/localities/${encodeURIComponent(ref.citySlug)}/` +
        `${encodeURIComponent(ref.localitySlug)}/listings?limit=${limit}`,
    );
    return (dtos ?? []).map(toListing);
  }

  async getByCity(citySlug: string, limit = 12): Promise<Listing[]> {
    const dtos = await this.get<ListingDto[]>(
      `/catalog/cities/${encodeURIComponent(citySlug)}/listings?limit=${limit}`,
    );
    return (dtos ?? []).map(toListing);
  }

  async getMarketStats(ref: LocalityRef): Promise<MarketStats | null> {
    const result = await this.get<{ stats: MarketStatsDto | null }>(
      `/catalog/localities/${encodeURIComponent(ref.citySlug)}/` +
        `${encodeURIComponent(ref.localitySlug)}/stats`,
      // Market reports are dated content; an hour of staleness is invisible and the aggregate is
      // by far the most expensive query in the catalog.
      { revalidate: 3600 },
    );
    return result?.stats ?? null;
  }
}

/* ------------------------------------------------------------------ *
 * Mapping: wire <-> UI model
 * ------------------------------------------------------------------ */

const STATUS_FROM_DTO: Record<ListingDto["status"], ListingStatus> = {
  active: "Active",
  "under-offer": "Under Offer",
  sold: "Sold",
  rented: "Rented",
  "coming-soon": "Coming Soon",
};

const STATUS_TO_DTO: Record<ListingStatus, ListingDto["status"]> = {
  Active: "active",
  "Under Offer": "under-offer",
  Sold: "sold",
  Rented: "rented",
  "Coming Soon": "coming-soon",
};

/**
 * Wire area -> `StoredArea`.
 *
 * ⚠️ `StoredArea` requires `inputValue`, `inputUnit` and `conversionFactor`, but the API only
 * sends them for the ONE area the seller actually typed — that is the whole point of
 * `area_input_basis`. For every other area we synthesise a sq ft identity (factor 1), which is
 * truthful: the figure genuinely is a square-foot measurement and was not entered in marla.
 *
 * Do not "fix" this by copying the marla input across all three areas. Echoing "10 marla" beside
 * a carpet area the seller never expressed that way is a false statement about the property, and
 * `formatArea` would render it.
 */
function toStoredArea(area: ListingDto["plotArea"]): StoredArea | undefined {
  if (!area) return undefined;
  return {
    sqft: area.sqft,
    inputValue: area.inputValue ?? area.sqft,
    inputUnit: (area.inputUnit ?? "SQ_FT") as AreaUnit,
    conversionFactor: area.conversionFactor ?? 1,
  };
}

export function toListing(dto: ListingDto): Listing {
  return {
    listingKey: dto.listingKey,
    referenceCode: dto.referenceCode,
    status: STATUS_FROM_DTO[dto.status] ?? "Active",

    listPrice: dto.listPrice,
    closePrice: dto.closePrice,
    priceOnRequest: dto.priceOnRequest,

    address: dto.address,
    coordinates: dto.coordinates,
    citySlug: dto.citySlug,
    localitySlug: dto.localitySlug,

    bedroomsTotal: dto.bedroomsTotal,
    bathroomsTotal: dto.bathroomsTotal,
    balconies: dto.balconies,

    builtUpArea: toStoredArea(dto.builtUpArea),
    carpetArea: toStoredArea(dto.carpetArea),
    plotArea: toStoredArea(dto.plotArea),

    floor: dto.floor,
    totalFloors: dto.totalFloors,
    yearBuilt: dto.yearBuilt,
    possession: dto.possession,
    possessionDate: dto.possessionDate,

    propertyType: dto.propertyType as PropertyType,
    furnishing: dto.furnishing,
    facing: dto.facing,

    maintenanceCharges: dto.maintenanceCharges,

    publicRemarks: dto.publicRemarks,
    features: dto.features,
    media: dto.media,

    daysOnMarket: dto.daysOnMarket,
    modificationTimestamp: dto.modificationTimestamp,
    listDate: dto.listDate,

    listedByFirm: dto.listedByFirm,
    listedByAgent: dto.listedByAgent,
    reraAgentRegistration: dto.reraAgentRegistration,
    reraProjectRegistration: dto.reraProjectRegistration,

    isOwnListing: dto.isOwnListing,
  };
}

/** UI query -> wire params. A near-identity map; the two vocabularies differ only on status. */
function toContractParams(query: ListingQuery): ListingSearchParamsDto {
  return {
    q: query.q,
    citySlugs: query.citySlugs,
    localities: query.localities,
    status: query.status?.map((s) => STATUS_TO_DTO[s]).filter(Boolean),
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    minBeds: query.minBeds,
    minBaths: query.minBaths,
    minSqft: query.minSqft,
    maxSqft: query.maxSqft,
    minYearBuilt: query.minYearBuilt,
    propertyTypes: query.propertyTypes,
    possession: query.possession,
    furnishing: query.furnishing,
    maxMaintenance: query.maxMaintenance,
    features: query.features,
    polygons: query.polygons,
    bounds: query.bounds,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  };
}
