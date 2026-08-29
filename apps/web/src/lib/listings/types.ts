/**
 * Listing domain model — tricity (Chandigarh / Mohali / Kharar) market.
 *
 * ⚠️ THIS FILE USED TO MIRROR THE RESO DATA DICTIONARY. It no longer does, deliberately.
 *
 * RESO field names (ListingKey, StandardStatus, AssociationFee...) exist to make an IDX/MLS feed
 * map one-to-one onto your model. **There is no MLS in India** — no IDX, no RESO Web API, no
 * cooperative listing database. Keeping that vocabulary would imply a feed integration that is
 * never going to happen and would send the next developer looking for a mapping layer that does
 * not exist.
 *
 * The vocabulary here is the one the market actually uses. Where a concept has no Indian
 * equivalent (escrow "Pending", HOA dues) it has been replaced rather than translated.
 *
 * Inventory instead comes from: the agent's own listings, builder/developer project inventory,
 * and the partner broker network. See docs/DATA_MODEL.md.
 */

import type { AreaUnit } from "@tricity/domain";

/**
 * Property types as advertised in the tricity.
 *
 * "kothi" (independent house), "builder floor" (one floor of a low-rise, sold separately) and
 * "SCO/SCF" (Shop-Cum-Office / Shop-Cum-Flat, the standard commercial plot formats in Chandigarh
 * and Mohali) have no US equivalent worth approximating. Plots are a first-class category here in
 * a way they are not in most western markets — a large share of transactions are bare land.
 */
export type PropertyType =
  | "plot"
  | "kothi"
  | "builder-floor"
  | "flat"
  | "villa"
  | "sco"
  | "scf"
  | "booth"
  | "farmhouse";

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  plot: "Plot",
  kothi: "Kothi (Independent House)",
  "builder-floor": "Builder Floor",
  flat: "Flat / Apartment",
  villa: "Villa",
  sco: "SCO (Shop-Cum-Office)",
  scf: "SCF (Shop-Cum-Flat)",
  booth: "Booth",
  farmhouse: "Farmhouse",
};

/** Short labels for chips and filter pills where the parenthetical would not fit. */
export const PROPERTY_TYPE_SHORT: Record<PropertyType, string> = {
  plot: "Plot",
  kothi: "Kothi",
  "builder-floor": "Builder Floor",
  flat: "Flat",
  villa: "Villa",
  sco: "SCO",
  scf: "SCF",
  booth: "Booth",
  farmhouse: "Farmhouse",
};

/** Types with no interior — bedroom/bathroom/furnishing filters do not apply to these. */
export const LAND_PROPERTY_TYPES: PropertyType[] = ["plot"];

export const isLandType = (type: PropertyType): boolean =>
  LAND_PROPERTY_TYPES.includes(type);

/** Residential vs commercial, which is the first fork in almost every buyer's search. */
export const COMMERCIAL_PROPERTY_TYPES: PropertyType[] = ["sco", "scf", "booth"];

/**
 * Listing status.
 *
 * Replaces RESO StandardStatus. "Active Under Contract" and "Pending" are US escrow states with
 * no counterpart in an Indian transaction, which runs agreement-to-sell → registry. "Under Offer"
 * covers the practical equivalent — a token amount (bayana) has been taken.
 */
export type ListingStatus =
  | "Active"
  | "Under Offer"
  | "Sold"
  | "Rented"
  | "Coming Soon";

/**
 * Possession status — arguably the single most-used filter in the Indian market, ahead of price
 * band. "Ready to move" vs "under construction" changes financing, risk, and RERA exposure, and
 * buyers self-select on it before anything else.
 */
export type PossessionStatus =
  | "ready-to-move"
  | "under-construction"
  | "new-launch";

export const POSSESSION_LABELS: Record<PossessionStatus, string> = {
  "ready-to-move": "Ready to Move",
  "under-construction": "Under Construction",
  "new-launch": "New Launch",
};

/** Furnishing level. A standard filter here; flats are routinely let/sold furnished. */
export type Furnishing = "unfurnished" | "semi-furnished" | "fully-furnished";

export const FURNISHING_LABELS: Record<Furnishing, string> = {
  unfurnished: "Unfurnished",
  "semi-furnished": "Semi-Furnished",
  "fully-furnished": "Fully Furnished",
};

/** Which direction the plot/house faces. Genuinely affects price here — this is not decoration. */
export type Facing =
  | "north"
  | "south"
  | "east"
  | "west"
  | "north-east"
  | "north-west"
  | "south-east"
  | "south-west";

export interface ListingMedia {
  url: string;
  /** Alt text. Required for accessibility and worth real SEO value on listing pages. */
  caption: string;
  /** 0 is the primary/hero photo. */
  order: number;
}

/**
 * An area as captured at data entry.
 *
 * Stored as BOTH the canonical square footage and the value/unit the lister actually typed,
 * because marla/kanal/gaj do not divide cleanly into square feet. `conversionFactor` is persisted
 * per row so a later correction to the marla constant cannot silently restate historical
 * listings. See @tricity/domain.
 */
export interface StoredArea {
  /** Canonical square feet — use this for search, sort and comparison. Never for display. */
  sqft: number;
  /** What the lister typed, e.g. 10. */
  inputValue: number;
  /** The unit they chose, e.g. MARLA. */
  inputUnit: AreaUnit;
  /** The factor applied at write time. */
  conversionFactor: number;
}

export interface Listing {
  /** Our immutable primary key. */
  listingKey: string;
  /**
   * Human-facing reference code buyers and agents quote on the phone.
   *
   * NOT an MLS number — there is no MLS. This is issued by us and is meaningful only within this
   * platform, which is why it is prefixed rather than presented as an industry identifier.
   */
  referenceCode: string;
  status: ListingStatus;

  /** Asking price in rupees. Stored as a plain number; formatted to lakh/crore at the edge. */
  listPrice: number;
  /** Set once sold. Drives the sold-history credibility page. */
  closePrice?: number;
  /** True when the lister will not publish a price ("Price on request") — common for premium stock. */
  priceOnRequest?: boolean;

  address: {
    /** House/plot number, e.g. "1247". */
    houseNumber?: string;
    /** Free-text line for society/project name, block, or street. */
    line1: string;
    /** Named project or society, when part of one. */
    projectName?: string;
    city: string;
    state: string;
    pincode: string;
    /** Full single-line form for display and schema.org. */
    unparsed: string;
  };

  coordinates: { lat: number; lng: number };

  /**
   * Where this sits, as a (city, locality) pair.
   *
   * ⚠️ Must be a PAIR. Locality slugs are unique per city, not globally — the database enforces
   * UNIQUE (city_id, slug). Keying a listing on a bare locality slug would let a Mohali sector
   * collide with a Chandigarh one and silently show buyers property in the wrong city.
   */
  citySlug: string;
  localitySlug: string;

  /** Bedroom count. Absent for plots and most commercial units. */
  bedroomsTotal?: number;
  bathroomsTotal?: number;
  /** Balconies are quoted separately here and buyers ask about them. */
  balconies?: number;

  /** Covered/built-up area. Absent for bare plots. */
  builtUpArea?: StoredArea;
  /**
   * Carpet area — the RERA-mandated basis for sale of under-construction property.
   *
   * RERA requires carpet area (not super/built-up) to be the quoted basis, precisely because
   * "super area" was routinely inflated. Where we have it, it should lead.
   */
  carpetArea?: StoredArea;
  /** Plot/land area. Present for plots, kothis and villas; absent for flats. */
  plotArea?: StoredArea;

  /** Floor this unit is on, and how many the building has. Meaningless for plots. */
  floor?: number;
  totalFloors?: number;

  yearBuilt?: number;
  possession: PossessionStatus;
  /** Expected handover, for under-construction and new-launch stock. */
  possessionDate?: string;

  propertyType: PropertyType;
  furnishing?: Furnishing;
  facing?: Facing;

  /** Monthly society maintenance in rupees. Replaces the US HOA fee concept. */
  maintenanceCharges?: number;
  /** Annual municipal property tax, where known. */
  propertyTaxAnnual?: number;

  /** Marketing description. */
  publicRemarks: string;
  /** Searchable feature tags: "Corner Plot", "Park Facing", "Modular Kitchen", ... */
  features: string[];

  media: ListingMedia[];

  daysOnMarket: number;
  /** ISO timestamp. Shown as the "last updated" freshness stamp. */
  modificationTimestamp: string;
  listDate: string;

  /**
   * ATTRIBUTION AND RERA COMPLIANCE.
   *
   * Under RERA an agent's registration number must appear in ALL advertising, including the
   * website. Penalty is up to ₹10 lakh. `reraAgentRegistration` is therefore required on every
   * listing, not optional — see ListingAttribution, which renders it unconditionally.
   *
   * Chandigarh is a Union Territory with its OWN authority, separate from Punjab RERA which
   * covers Mohali and Kharar. An agent operating across the tricity spans two jurisdictions and
   * needs a registration for each, so the applicable one is carried per listing.
   */
  listedByFirm: string;
  listedByAgent: string;
  reraAgentRegistration: string;
  /**
   * The project's own RERA registration, for units in a registered project. Distinct from the
   * agent's registration and separately required in advertising for those projects.
   */
  reraProjectRegistration?: string;

  /** True when this is the site owner's own listing, which unlocks richer presentation. */
  isOwnListing: boolean;
}

/** Sort orders offered to buyers. */
export type ListingSort =
  | "newest"
  | "price-asc"
  | "price-desc"
  | "beds-desc"
  | "area-desc";

/**
 * A geographic polygon drawn by the user on the map.
 * Powers the draw-your-own-area search — the feature that expresses intent no dropdown can
 * ("this side of the highway only").
 */
export type Polygon = { lat: number; lng: number }[];

/**
 * A locality reference in a query. Always city-qualified, for the collision reason above.
 * Serialised in URLs as "city/locality", e.g. "mohali/sector-70".
 */
export interface LocalityRef {
  citySlug: string;
  localitySlug: string;
}

/** Every filter a buyer can apply. All optional — an empty object means "everything active". */
export interface ListingQuery {
  /** Free-text: address, reference code, project or locality name. */
  q?: string;
  /** City-level filter, for "everything in Mohali". */
  citySlugs?: string[];
  localities?: LocalityRef[];
  status?: ListingStatus[];

  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  /** Area filters operate on canonical square feet regardless of the unit the buyer chose. */
  minSqft?: number;
  maxSqft?: number;
  minYearBuilt?: number;
  propertyTypes?: PropertyType[];
  possession?: PossessionStatus[];
  furnishing?: Furnishing[];

  /** Cap on monthly society maintenance. */
  maxMaintenance?: number;
  /** Required feature tags — listing must have all of them. */
  features?: string[];

  /** Map-drawn areas. Multiple polygons = union, matching how buyers think about multiple areas. */
  polygons?: Polygon[];
  /** Viewport bounds, for "search as I move the map". */
  bounds?: { north: number; south: number; east: number; west: number };

  sort?: ListingSort;
  page?: number;
  pageSize?: number;
}

export interface ListingResult {
  listings: Listing[];
  /** Total matches before pagination — drives the result count and page controls. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The area figure to sort, filter and compare on, in canonical square feet.
 *
 * Order matters and is deliberate: carpet area is the RERA basis and the most honest number;
 * built-up is the common fallback; plot area is used for bare land where there is no interior.
 */
export function comparableSqft(listing: Listing): number {
  return (
    listing.carpetArea?.sqft ??
    listing.builtUpArea?.sqft ??
    listing.plotArea?.sqft ??
    0
  );
}

/** "mohali/sector-70" — the stable key for a city-qualified locality. */
export function localityRefKey(ref: LocalityRef): string {
  return `${ref.citySlug}/${ref.localitySlug}`;
}
