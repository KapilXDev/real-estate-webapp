/**
 * Listing domain model.
 *
 * Field names deliberately mirror the RESO Data Dictionary (ListPrice, BedroomsTotal,
 * StandardStatus, ...) in camelCase. When the IDX feed is approved, mapping RESO Web API
 * responses onto this shape is close to one-to-one — which is the whole point of naming it
 * this way rather than inventing our own vocabulary.
 *
 * @see https://www.reso.org/data-dictionary/
 */

import type { PropertyType } from "@/config/neighborhoods";

/** RESO StandardStatus, narrowed to the values that matter for a consumer-facing site. */
export type ListingStatus =
  | "Active"
  | "Active Under Contract"
  | "Pending"
  | "Closed"
  | "Coming Soon";

export interface ListingMedia {
  url: string;
  /** Alt text. Required for accessibility and worth real SEO value on listing pages. */
  caption: string;
  /** RESO Order — 0 is the primary/hero photo. */
  order: number;
}

export interface Listing {
  /** RESO ListingKey — the feed's immutable primary key. */
  listingKey: string;
  /** RESO ListingId — the human-facing MLS number buyers quote to you. */
  mlsNumber: string;
  status: ListingStatus;

  listPrice: number;
  /** Set once closed; drives "sold" credibility pages. */
  closePrice?: number;

  address: {
    streetNumber: string;
    streetName: string;
    unit?: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    /** RESO UnparsedAddress — full single-line form. */
    unparsed: string;
  };

  coordinates: { lat: number; lng: number };
  /** Slug of the neighborhood this sits in. Links listings to the SEO pages. */
  neighborhoodSlug: string;

  bedroomsTotal: number;
  bathroomsTotal: number;
  /** Interior square footage (RESO LivingArea). */
  livingArea: number;
  /** Lot size in square feet. Absent for condos. */
  lotSizeSquareFeet?: number;
  yearBuilt: number;
  propertyType: PropertyType;

  /** Monthly HOA/association fee, if any. A top-5 buyer filter — do not omit it. */
  associationFee?: number;
  /** Annual property tax. Feeds the true-cost mortgage calculator. */
  taxAnnualAmount?: number;

  /** RESO PublicRemarks — the marketing description. */
  publicRemarks: string;
  /** Searchable feature tags: "Waterfront", "Pool", "New Construction", ... */
  features: string[];

  media: ListingMedia[];

  daysOnMarket: number;
  /** ISO timestamp. Displayed as the required "last updated" compliance stamp. */
  modificationTimestamp: string;
  listDate: string;

  /**
   * ATTRIBUTION — legally required on every rendered view of this listing, including search
   * cards and map thumbnails. Never render a listing without surfacing these.
   */
  listOfficeName: string;
  listAgentFullName: string;
  /** True when this is the site owner's own listing, which unlocks richer presentation. */
  isOwnListing: boolean;
}

/** Sort orders offered to buyers. */
export type ListingSort =
  | "newest"
  | "price-asc"
  | "price-desc"
  | "beds-desc"
  | "sqft-desc";

/**
 * A geographic polygon drawn by the user on the map.
 * Powers the draw-your-own-area search — the feature that expresses intent no dropdown can
 * ("this side of the highway only").
 */
export type Polygon = { lat: number; lng: number }[];

/** Every filter a buyer can apply. All optional — an empty object means "everything active". */
export interface ListingQuery {
  /** Free-text: address, MLS number, or neighborhood name. */
  q?: string;
  neighborhoodSlugs?: string[];
  status?: ListingStatus[];

  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  maxSqft?: number;
  minYearBuilt?: number;
  propertyTypes?: PropertyType[];

  /** Cap on monthly HOA. Buyers filter on this more than expected. */
  maxHoaFee?: number;
  /** Required feature tags — listing must have all of them. */
  features?: string[];

  /** Map-drawn areas. Multiple polygons = union, matching Zillow's multi-area search. */
  polygons?: Polygon[];
  /** Viewport bounds, for "search as I move the map". */
  bounds?: { north: number; south: number; east: number; west: number };

  sort?: ListingSort;
  page?: number;
  pageSize?: number;
}

export interface ListingResult {
  listings: Listing[];
  /** Total matches before pagination — drives the "1,240 homes" count and page controls. */
  total: number;
  page: number;
  pageSize: number;
}
