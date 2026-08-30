/**
 * Catalog wire contract — what `GET /api/catalog/listings` actually puts on the wire.
 *
 * ⚠️ THIS IS NOT THE UI MODEL AND NOT THE DATABASE ROW. It is deliberately a third thing.
 *
 * The website's `Listing` type is shaped for rendering (nested address object, optional fields
 * the UI branches on). The `listing`/`property` tables are shaped for storage and tenancy. If the
 * API returned either one directly, every future change to that side would break the other — a
 * column rename would ripple into a React component, or a UI convenience field would push its way
 * into the schema.
 *
 * So: the API maps row → this, and the website maps this → its own `Listing`. Two small mappers,
 * each owned by the side that changes, and neither side can drift from the other without a
 * TypeScript error here.
 *
 * Conventions on this wire:
 *  - Money is INR **rupees as a plain number**. Never a formatted string, and never "85" meaning
 *    85 lakh — lakh/crore is a rendering concern (`@tricity/domain`), not a transport one.
 *  - Areas are canonical **square feet**, plus the value/unit the lister actually typed.
 *  - Timestamps are **ISO 8601 strings**, because JSON has no date type and a number would be
 *    ambiguous between seconds and milliseconds.
 *  - Enum-ish fields are lowercase kebab strings, matching the URL vocabulary the site already
 *    uses, rather than the SCREAMING_SNAKE of the Postgres enums.
 */

export type ListingStatusDto = "active" | "under-offer" | "sold" | "rented" | "coming-soon";

export type PropertyTypeDto =
  | "plot"
  | "kothi"
  | "builder-floor"
  | "flat"
  | "villa"
  | "sco"
  | "scf"
  | "booth"
  | "farmhouse";

export type PossessionDto = "ready-to-move" | "under-construction" | "new-launch";

export type FurnishingDto = "unfurnished" | "semi-furnished" | "fully-furnished";

export type FacingDto =
  | "north"
  | "south"
  | "east"
  | "west"
  | "north-east"
  | "north-west"
  | "south-east"
  | "south-west";

export type TransactionTypeDto = "sale" | "rent" | "lease";

export type AreaUnitDto = "SQ_FT" | "SQ_YD" | "MARLA" | "KANAL" | "ACRE" | "BIGHA" | "SQ_M";

/**
 * An area, carried both ways.
 *
 * `sqft` is what search, sort and comparison use. `inputValue`/`inputUnit` are what the lister
 * typed, echoed back verbatim so a seller who entered "10 marla" is never shown "2722.5 sq ft".
 * `conversionFactor` travels with it because marla is regionally ambiguous (272.25 sq ft in
 * Punjab, 225 elsewhere) — pinning the factor per row means a later correction to the constant
 * cannot silently restate historical listings.
 */
export interface AreaDto {
  sqft: number;
  inputValue?: number;
  inputUnit?: AreaUnitDto;
  conversionFactor?: number;
}

export interface ListingMediaVariantDto {
  /** "thumb" | "card" | "hero" — see the media module's VARIANTS. */
  name: string;
  url: string;
  width: number;
}

export interface ListingMediaDto {
  /** The default (card) variant. Always present, so a client can ignore `variants` entirely. */
  url: string;
  /**
   * Every size we generated, so the browser can pick one per breakpoint via `srcset`.
   *
   * ⚠️ THIS IS WHY WE DO NOT PUT THESE THROUGH `next/image`. The API has already produced exactly
   * the sizes the layout needs, in WebP; the optimizer would fetch an 800px WebP and re-encode it
   * — paying twice for work already done, and coupling the site's build config to the media
   * host's hostname, whose failure mode is a silently blank image rather than an error.
   */
  variants?: ListingMediaVariantDto[];
  caption: string;
  order: number;
}

export interface ListingDto {
  /** Immutable primary key (uuid). */
  listingKey: string;
  /** Human-facing code buyers quote on the phone, e.g. "TE-001042". Not an MLS number. */
  referenceCode: string;
  status: ListingStatusDto;
  transactionType: TransactionTypeDto;

  /** Asking price in rupees. Present even when `priceOnRequest` is true — see below. */
  listPrice: number;
  /**
   * When true the UI must render "Price on request" instead of the figure.
   *
   * ⚠️ The API still sends `listPrice` so the listing stays sortable and filterable by price.
   * That is a deliberate trade: withholding it entirely would drop premium stock out of every
   * price-sorted result, which is the opposite of what the lister wants. Do not render it.
   */
  priceOnRequest: boolean;
  closePrice?: number;

  address: {
    houseNumber?: string;
    line1: string;
    projectName?: string;
    city: string;
    state: string;
    pincode: string;
    unparsed: string;
  };

  coordinates: { lat: number; lng: number };

  /**
   * ⚠️ Always a (city, locality) PAIR. Locality slugs are unique per city, not globally — the
   * database enforces UNIQUE (city_id, slug). A bare "sector-70" is ambiguous across the three
   * sector-numbering municipalities in the tricity, and resolving it wrong tells a buyer a
   * property is in a different town.
   */
  citySlug: string;
  localitySlug: string;

  bedroomsTotal?: number;
  bathroomsTotal?: number;
  balconies?: number;

  builtUpArea?: AreaDto;
  /** Carpet area — the RERA basis for under-construction sale. Where present, it leads. */
  carpetArea?: AreaDto;
  plotArea?: AreaDto;

  floor?: number;
  totalFloors?: number;
  yearBuilt?: number;

  possession: PossessionDto;
  /** ISO date (yyyy-mm-dd). Only ever set for unbuilt stock. */
  possessionDate?: string;

  propertyType: PropertyTypeDto;
  furnishing?: FurnishingDto;
  facing?: FacingDto;

  maintenanceCharges?: number;

  publicRemarks: string;
  features: string[];
  media: ListingMediaDto[];

  daysOnMarket: number;
  modificationTimestamp: string;
  listDate: string;

  /**
   * RERA ATTRIBUTION — required on every listing, never optional.
   *
   * A registered agent's RERA number must appear in all advertising, and a website is
   * advertising. The agent spans two jurisdictions (Punjab RERA for Mohali/Kharar/Zirakpur,
   * Chandigarh's own authority for Chandigarh), so the applicable registration is resolved per
   * listing from the city's state and carried here rather than hardcoded in the UI.
   */
  listedByFirm: string;
  listedByAgent: string;
  reraAgentRegistration: string;
  /** The project's own registration, for units in a RERA-registered project. */
  reraProjectRegistration?: string;

  /** True when this belongs to the site owner's organisation rather than a partner. */
  isOwnListing: boolean;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export type ListingSortDto = "newest" | "price-asc" | "price-desc" | "beds-desc" | "area-desc";

/** A locality reference. City-qualified, for the slug-collision reason above. */
export interface LocalityRefDto {
  citySlug: string;
  localitySlug: string;
}

export interface BoundsDto {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type PolygonDto = { lat: number; lng: number }[];

/**
 * Search parameters, as the API accepts them.
 *
 * Serialised into a query string by `toSearchParams` below so the client and server cannot
 * disagree about the encoding — which is the classic place a shared type stops helping, because
 * the type describes the object and the bug is in the string.
 */
export interface ListingSearchParamsDto {
  q?: string;
  citySlugs?: string[];
  localities?: LocalityRefDto[];
  status?: ListingStatusDto[];
  transactionType?: TransactionTypeDto;

  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  maxSqft?: number;
  minYearBuilt?: number;

  propertyTypes?: PropertyTypeDto[];
  possession?: PossessionDto[];
  furnishing?: FurnishingDto[];
  maxMaintenance?: number;
  features?: string[];

  polygons?: PolygonDto[];
  bounds?: BoundsDto;

  sort?: ListingSortDto;
  page?: number;
  pageSize?: number;
}

export interface ListingSearchResponseDto {
  listings: ListingDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MarketStatsDto {
  citySlug: string;
  localitySlug: string;
  activeCount: number;
  medianListPrice: number;
  medianPricePerSqft: number;
  medianDaysOnMarket: number;
  closedLast90Days: number;
  medianClosePrice: number | null;
  priceChangePercent: number | null;
  generatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Query-string encoding
 * ------------------------------------------------------------------ */

/**
 * Encode search params for a GET request.
 *
 * ⚠️ Lives HERE, next to the type, rather than in either app. The pairing of a shared type with
 * two independently-written encoders is a well-worn way to ship a bug that typechecks perfectly:
 * one side writes `citySlugs=a&citySlugs=b`, the other reads `citySlugs=a,b`, and nothing
 * complains until a filter silently returns everything.
 *
 * Encoding rules:
 *  - scalars: `minPrice=5000000`
 *  - string lists: repeated keys, `propertyTypes=flat&propertyTypes=kothi`
 *  - localities: `area=mohali/sector-70`, repeated — matching the URL vocabulary the site
 *    already uses, so a shared link and an API call read the same way
 *  - polygons and bounds: JSON, because there is no readable flat encoding for them and a
 *    hand-rolled one is a parser nobody wants to own
 */
export function toSearchParams(params: ListingSearchParamsDto): URLSearchParams {
  const search = new URLSearchParams();

  const scalar = (key: string, value: string | number | undefined): void => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  };
  const list = (key: string, values: readonly string[] | undefined): void => {
    for (const value of values ?? []) search.append(key, value);
  };

  scalar("q", params.q);
  list("citySlugs", params.citySlugs);
  for (const ref of params.localities ?? []) {
    search.append("area", `${ref.citySlug}/${ref.localitySlug}`);
  }
  list("status", params.status);
  scalar("transactionType", params.transactionType);

  scalar("minPrice", params.minPrice);
  scalar("maxPrice", params.maxPrice);
  scalar("minBeds", params.minBeds);
  scalar("minBaths", params.minBaths);
  scalar("minSqft", params.minSqft);
  scalar("maxSqft", params.maxSqft);
  scalar("minYearBuilt", params.minYearBuilt);

  list("propertyTypes", params.propertyTypes);
  list("possession", params.possession);
  list("furnishing", params.furnishing);
  scalar("maxMaintenance", params.maxMaintenance);
  list("features", params.features);

  if (params.polygons?.length) search.set("polygons", JSON.stringify(params.polygons));
  if (params.bounds) search.set("bounds", JSON.stringify(params.bounds));

  scalar("sort", params.sort);
  scalar("page", params.page);
  scalar("pageSize", params.pageSize);

  return search;
}

/** Split an `area=city/locality` param back into a pair. Returns null for a malformed value. */
export function parseLocalityRef(raw: string): LocalityRefDto | null {
  const [citySlug, localitySlug, ...rest] = raw.split("/");
  if (!citySlug || !localitySlug || rest.length > 0) return null;
  return { citySlug, localitySlug };
}
