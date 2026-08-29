/**
 * Sample-data provider — stands in until real inventory exists behind the catalog API.
 *
 * Generation is SEEDED and deterministic: the same geography always produces the same listings.
 * That keeps snapshots, screenshots and shared links stable between runs, which a `Math.random()`
 * approach would not.
 *
 * Geography comes from `@tricity/geo`, so this inventory sits on the same 102 localities the
 * database is seeded with. Price bands and editorial come from `src/config/localities.ts`.
 *
 * ⚠️ EVERY PRICE AND AREA BELOW IS FABRICATED. The bands are plausible-looking placeholders, not
 * market data. `isLiveData` is false, which keeps the site out of search indexes and suppresses
 * provenance claims — do not flip it until real listings are being served.
 *
 * The query engine below (filtering, polygon search, sorting, pagination) is NOT throwaway — it
 * defines the exact search semantics the API-backed provider must reproduce.
 */

import { Area, type AreaUnit } from "@tricity/domain";
import { LOCALITIES, getCity, type LocalitySeed } from "@tricity/geo";

import { getLocalityContent } from "@/config/localities";
import { reraForState, site } from "@/config/site";
import { pointInAnyPolygon, pointInBounds } from "./geo";
import type { ListingProvider, MarketStats } from "./provider";
import {
  comparableSqft,
  isLandType,
  type Furnishing,
  type Listing,
  type ListingMedia,
  type ListingQuery,
  type ListingResult,
  type ListingStatus,
  type LocalityRef,
  type PossessionStatus,
  type PropertyType,
  type StoredArea,
} from "./types";

/* ------------------------------------------------------------------ *
 * Seeded pseudo-randomness
 * ------------------------------------------------------------------ */

/** Mulberry32 — small, fast, good enough distribution for fixture data. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic string -> integer seed, so a locality always yields the same properties. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Rng = () => number;

const randInt = (rng: Rng, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;

const pick = <T,>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!;

/** Pick `count` distinct items. Returns fewer if the pool is smaller. */
function pickSome<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

/**
 * Round to a price a person would actually quote.
 *
 * Nobody advertises ₹87,43,912. Below a crore, asking prices land on 50,000 steps ("₹85.5 lakh");
 * above it they land on lakh steps ("₹1.25 crore"). Getting this wrong makes every generated
 * listing read as machine output at a glance.
 */
function roundPrice(n: number): number {
  const step = n >= 10_000_000 ? 100_000 : 50_000;
  return Math.round(n / step) * step;
}

/* ------------------------------------------------------------------ *
 * Market shape — ⚠️ ALL PLACEHOLDER
 * ------------------------------------------------------------------ */

/**
 * Fallback asking bands per city, in rupees, for localities with no editorial content.
 *
 * ⚠️ INVENTED FIGURES. Ordered roughly by how the tricity actually stratifies (Chandigarh
 * dearest, Kharar cheapest) so the generated data behaves sensibly under sorting and filtering,
 * but these are not researched numbers and must not be presented to anyone as market guidance.
 */
const CITY_PRICE_BANDS: Record<string, { min: number; max: number }> = {
  chandigarh: { min: 15_000_000, max: 120_000_000 },
  mohali: { min: 6_000_000, max: 35_000_000 },
  "new-chandigarh": { min: 5_000_000, max: 40_000_000 },
  panchkula: { min: 7_000_000, max: 45_000_000 },
  zirakpur: { min: 3_000_000, max: 15_000_000 },
  kharar: { min: 3_000_000, max: 14_000_000 },
};

/** Dominant stock per city, used where a locality has no editorial content of its own. */
const CITY_HOUSING_TYPES: Record<string, PropertyType[]> = {
  chandigarh: ["kothi", "builder-floor", "flat", "sco"],
  mohali: ["flat", "builder-floor", "kothi", "plot"],
  "new-chandigarh": ["plot", "flat", "villa"],
  panchkula: ["kothi", "flat", "builder-floor"],
  zirakpur: ["flat", "builder-floor"],
  kharar: ["plot", "builder-floor", "flat"],
};

/** Pincode ranges per city. Approximate — replace with real ones during the content pass. */
const CITY_PINCODES: Record<string, [number, number]> = {
  chandigarh: [160001, 160047],
  mohali: [160055, 160071],
  kharar: [140301, 140308],
  zirakpur: [140603, 140604],
  "new-chandigarh": [140901, 140901],
  panchkula: [134109, 134116],
};

/**
 * Feature tags buyers here actually filter on. Keep aligned with the filter UI.
 *
 * Deliberately not a translation of the US list — "Corner Plot", "Park Facing" and "Power
 * Backup" are the things that move price in this market; "Finished Basement" is not.
 */
const FEATURE_POOL = [
  "Corner Plot",
  "Park Facing",
  "Wide Road",
  "Modular Kitchen",
  "Power Backup",
  "Covered Parking",
  "Lift",
  "Gated Society",
  "Vaastu Compliant",
  "Servant Room",
  "Pooja Room",
  "Terrace Access",
  "Borewell",
  "24x7 Security",
  "Club House",
  "Piped Gas",
  "Near School",
  "Main Road Facing",
];

/** Features that only make sense on bare land. */
const PLOT_FEATURES = ["Corner Plot", "Park Facing", "Wide Road", "Main Road Facing"];

/** Weighted so most inventory is Active — matching a real market snapshot. */
const STATUS_WEIGHTS: [ListingStatus, number][] = [
  ["Active", 0.58],
  ["Under Offer", 0.1],
  ["Coming Soon", 0.05],
  ["Sold", 0.27],
];

function weightedStatus(rng: Rng): ListingStatus {
  const roll = rng();
  let cumulative = 0;
  for (const [status, weight] of STATUS_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return status;
  }
  return "Active";
}

/** Partner firms, so attribution rendering is exercised with varied data. */
const PARTNER_FIRMS = [
  { firm: "Shivalik Property Consultants", agent: "H. Grewal" },
  { firm: "Tricity Homes & Estates", agent: "N. Bhatia" },
  { firm: "Landmark Properties Mohali", agent: "R. Sandhu" },
  { firm: "Capitol Realty Chandigarh", agent: "A. Chopra" },
  { firm: "Sunny Belt Real Estate", agent: "J. Kaur" },
];

const FACINGS = [
  "north",
  "south",
  "east",
  "west",
  "north-east",
  "north-west",
  "south-east",
  "south-west",
] as const;

/* ------------------------------------------------------------------ *
 * Listing generation
 * ------------------------------------------------------------------ */

/** Scatter a point within `radiusM` of a centre, biased toward the middle like real density. */
function scatter(
  rng: Rng,
  center: { lat: number; lng: number },
  radiusM: number,
): { lat: number; lng: number } {
  const angle = rng() * 2 * Math.PI;
  // sqrt() would distribute evenly by area; a higher exponent clusters toward the centre.
  const distanceKm = (radiusM / 1000) * rng() ** 1.6;
  const latDelta = distanceKm / 111;
  const lngDelta = distanceKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  return {
    lat: Number((center.lat + latDelta * Math.sin(angle)).toFixed(6)),
    lng: Number((center.lng + lngDelta * Math.cos(angle)).toFixed(6)),
  };
}

/** Build a StoredArea the way the real capture path would — via Area, recording the factor. */
function storedArea(value: number, unit: AreaUnit): StoredArea {
  const area = Area.of(value, unit);
  return {
    sqft: area.sqft,
    inputValue: area.inputValue,
    inputUnit: area.inputUnit,
    conversionFactor: area.conversionFactor,
  };
}

/**
 * Plot sizes as they are actually transacted here: in whole marla, or in kanal for larger
 * properties. Generating a plot of "1,847 sq ft" would be a giveaway that no one in this market
 * touched the data.
 */
function generatePlotArea(rng: Rng, type: PropertyType): StoredArea {
  if (type === "farmhouse") return storedArea(pick(rng, [1, 1.5, 2, 2.5]), "ACRE");

  const roll = rng();
  if (roll < 0.15) return storedArea(pick(rng, [1, 1.5, 2]), "KANAL");
  return storedArea(pick(rng, [4, 5, 6, 8, 10, 12, 14, 16]), "MARLA");
}

/**
 * Plausible bedroom range per property type.
 *
 * ⚠️ NOT a uniform 1-5. A "1 BHK kothi" is a contradiction — a kothi is a whole independent house
 * and starts around 3 bedrooms; a 1 BHK is a flat. Generating implausible combinations is exactly
 * the tell that no one who knows this market looked at the data, and it undermines every other
 * signal on the page.
 */
const BEDROOM_RANGE: Partial<Record<PropertyType, [number, number]>> = {
  flat: [1, 4],
  "builder-floor": [2, 4],
  kothi: [3, 6],
  villa: [3, 5],
  farmhouse: [3, 5],
};

/** Covered area in square feet — how flats and floors are quoted. */
function generateBuiltUpArea(rng: Rng, type: PropertyType, beds: number): StoredArea {
  if (type === "flat") return storedArea(randInt(rng, 550, 2400), "SQ_FT");
  if (type === "builder-floor") return storedArea(randInt(rng, 900, 2600), "SQ_FT");
  if (type === "sco" || type === "scf" || type === "booth") {
    return storedArea(randInt(rng, 250, 1800), "SQ_FT");
  }
  // Kothis and villas scale with bedroom count.
  return storedArea(randInt(rng, 1400 + beds * 200, 2600 + beds * 400), "SQ_FT");
}

function possessionFor(rng: Rng, citySlug: string): PossessionStatus {
  // Newer areas carry proportionally more under-construction and new-launch stock.
  const newBuildHeavy = citySlug === "new-chandigarh" || citySlug === "kharar";
  const roll = rng();
  if (newBuildHeavy) {
    if (roll < 0.5) return "ready-to-move";
    if (roll < 0.85) return "under-construction";
    return "new-launch";
  }
  if (roll < 0.82) return "ready-to-move";
  if (roll < 0.96) return "under-construction";
  return "new-launch";
}

function buildRemarks(
  rng: Rng,
  localityLabel: string,
  type: PropertyType,
  beds: number | undefined,
  areaText: string,
  features: string[],
): string {
  const land = isLandType(type);

  const openers = land
    ? [
        `${areaText} residential plot in ${localityLabel}, ready for construction.`,
        `Well-located ${areaText} plot in ${localityLabel} on a clear title.`,
        `${areaText} plot in ${localityLabel} — a straightforward build opportunity.`,
      ]
    : [
        `Well-maintained ${beds} BHK ${type.replace("-", " ")} in ${localityLabel}, ${areaText}.`,
        `${beds} BHK ${type.replace("-", " ")} in ${localityLabel} — ${areaText}, ready to view.`,
        `Spacious ${beds} BHK in ${localityLabel} spanning ${areaText}.`,
      ];

  const closers = [
    "Call to arrange a site visit.",
    "Available for viewing on short notice.",
    "Documents available for inspection on request.",
    "Genuine buyers only, please.",
  ];

  const featureLine = features.length
    ? ` Key points: ${features.slice(0, 3).join(", ").toLowerCase()}.`
    : "";

  return `${pick(rng, openers)}${featureLine} ${pick(rng, closers)}`;
}

function buildMedia(rng: Rng, seedKey: string, label: string, land: boolean): ListingMedia[] {
  const captions = land
    ? ["Plot frontage", "Road access", "Surrounding development", "Locality view"]
    : ["Front elevation", "Drawing room", "Kitchen", "Master bedroom", "Bathroom", "Terrace"];

  const count = land ? randInt(rng, 3, 4) : randInt(rng, 4, 6);
  return Array.from({ length: count }, (_, i) => ({
    // Locally generated SVG — no external image service, so the site works fully offline.
    url: `/api/placeholder/${seedKey}-${i}/1200/800`,
    caption: `${captions[i] ?? "Property"} — ${label}`,
    order: i,
  }));
}

function generateForLocality(locality: LocalitySeed, count: number): Listing[] {
  const rng = makeRng(hashSeed(`${locality.citySlug}/${locality.slug}`));
  const now = Date.now();

  const city = getCity(locality.citySlug);
  const cityName = city?.name ?? locality.citySlug;
  const state = city?.state ?? "Punjab";
  const rera = reraForState(state);

  const content = getLocalityContent(locality.citySlug, locality.slug);
  const band = content?.priceRange ??
    CITY_PRICE_BANDS[locality.citySlug] ?? { min: 5_000_000, max: 30_000_000 };
  const housingTypes =
    content?.housingTypes ?? CITY_HOUSING_TYPES[locality.citySlug] ?? ["flat", "plot"];
  const pincodeRange = CITY_PINCODES[locality.citySlug] ?? [140301, 140308];

  const localityLabel = `${locality.name}, ${cityName}`;

  return Array.from({ length: count }, (_, i) => {
    const listingKey = `${locality.citySlug}-${locality.slug}-${String(i + 1).padStart(3, "0")}`;
    const propertyType = pick(rng, housingTypes);
    const status = weightedStatus(rng);
    const land = isLandType(propertyType);
    const commercial =
      propertyType === "sco" || propertyType === "scf" || propertyType === "booth";

    // Plots and commercial units have no bedrooms; everything else does.
    const bedroomRange = BEDROOM_RANGE[propertyType] ?? [2, 4];
    const bedroomsTotal =
      land || commercial ? undefined : randInt(rng, bedroomRange[0], bedroomRange[1]);
    const bathroomsTotal =
      bedroomsTotal === undefined
        ? commercial
          ? randInt(rng, 1, 2)
          : undefined
        : Math.max(1, bedroomsTotal - randInt(rng, 0, 1));

    const plotArea =
      land || propertyType === "kothi" || propertyType === "villa" || propertyType === "farmhouse"
        ? generatePlotArea(rng, propertyType)
        : undefined;

    const builtUpArea = land
      ? undefined
      : generateBuiltUpArea(rng, propertyType, bedroomsTotal ?? 2);

    // Carpet area is a fraction of built-up. RERA exists partly because "super area" was
    // routinely inflated, so the gap here is real rather than cosmetic.
    const carpetArea =
      builtUpArea && rng() > 0.35
        ? storedArea(Math.round(builtUpArea.sqft * (0.68 + rng() * 0.12)), "SQ_FT")
        : undefined;

    const sizeSqft = carpetArea?.sqft ?? builtUpArea?.sqft ?? plotArea?.sqft ?? 1000;

    // Price from the band, nudged by size so listings stay internally consistent.
    const typicalSqft = land ? 2000 : 1500;
    const sizeFactor = sizeSqft / typicalSqft;
    const basePrice = band.min + (band.max - band.min) * rng();
    const listPrice = roundPrice(
      Math.min(band.max * 1.1, Math.max(band.min * 0.9, basePrice * (0.75 + 0.35 * sizeFactor))),
    );

    const coordinates = scatter(rng, { lat: locality.lat, lng: locality.lng }, locality.radiusM);
    const houseNumber = String(randInt(rng, 1, 3200));
    const pincode = String(randInt(rng, pincodeRange[0], pincodeRange[1]));

    const unparsed = [
      `${land ? "Plot No." : "House No."} ${houseNumber}`,
      locality.name,
      cityName,
      pincode,
    ].join(", ");

    const daysOnMarket = status === "Coming Soon" ? 0 : randInt(rng, 1, 150);
    const listDate = new Date(now - daysOnMarket * 86_400_000);

    // ~15% of inventory is the site owner's — enough to populate their own-listings page.
    const isOwnListing = rng() < 0.15;
    const partner = pick(rng, PARTNER_FIRMS);

    const featurePool = land ? PLOT_FEATURES : FEATURE_POOL;
    const features = pickSome(rng, featurePool, randInt(rng, 3, Math.min(7, featurePool.length)));

    const possession = land ? "ready-to-move" : possessionFor(rng, locality.citySlug);

    const furnishing: Furnishing | undefined = land
      ? undefined
      : pick(rng, ["unfurnished", "semi-furnished", "fully-furnished"] as const);

    const areaText = (carpetArea ?? builtUpArea ?? plotArea)
      ? Area.fromStored(
          (carpetArea ?? builtUpArea ?? plotArea)!.inputValue,
          (carpetArea ?? builtUpArea ?? plotArea)!.inputUnit,
          (carpetArea ?? builtUpArea ?? plotArea)!.sqft,
          (carpetArea ?? builtUpArea ?? plotArea)!.conversionFactor,
        ).format()
      : "";

    return {
      listingKey,
      // Prefixed so it reads as our reference, not an industry-standard identifier.
      referenceCode: `TE-${(hashSeed(listingKey) % 900000) + 100000}`,
      status,
      listPrice,
      closePrice:
        status === "Sold" ? roundPrice(listPrice * (0.9 + rng() * 0.1)) : undefined,
      // A slice of premium stock is advertised without a price, as it is here.
      priceOnRequest: listPrice > 60_000_000 && rng() > 0.75,
      address: {
        houseNumber,
        line1: locality.name,
        city: cityName,
        state,
        pincode,
        unparsed,
      },
      coordinates,
      citySlug: locality.citySlug,
      localitySlug: locality.slug,
      bedroomsTotal,
      bathroomsTotal,
      balconies: land || commercial ? undefined : randInt(rng, 0, 3),
      builtUpArea,
      carpetArea,
      plotArea,
      floor:
        propertyType === "flat" || propertyType === "builder-floor"
          ? randInt(rng, 0, 12)
          : undefined,
      totalFloors:
        propertyType === "flat" || propertyType === "builder-floor"
          ? randInt(rng, 3, 15)
          : undefined,
      yearBuilt: land ? undefined : randInt(rng, 1985, 2025),
      possession,
      possessionDate:
        possession === "ready-to-move"
          ? undefined
          : new Date(now + randInt(rng, 90, 900) * 86_400_000).toISOString(),
      propertyType,
      furnishing,
      facing: pick(rng, FACINGS),
      maintenanceCharges:
        propertyType === "flat" ? randInt(rng, 1000, 8000) : rng() > 0.85 ? randInt(rng, 500, 2500) : undefined,
      // Municipal property tax here is a small annual figure, not the US-style percentage.
      propertyTaxAnnual: land ? undefined : Math.round(randInt(rng, 1500, 18000) / 100) * 100,
      publicRemarks: buildRemarks(
        rng,
        localityLabel,
        propertyType,
        bedroomsTotal,
        areaText,
        features,
      ),
      features,
      media: buildMedia(rng, listingKey, localityLabel, land),
      daysOnMarket,
      modificationTimestamp: new Date(now - randInt(rng, 1, 20) * 3_600_000).toISOString(),
      listDate: listDate.toISOString(),
      listedByFirm: isOwnListing ? site.firm.name : partner.firm,
      listedByAgent: isOwnListing ? site.agent.name : partner.agent,
      // The agent's registration for the jurisdiction this property sits in — Chandigarh's
      // authority is separate from Punjab's, so this varies by listing.
      reraAgentRegistration: rera.registration,
      reraProjectRegistration:
        possession !== "ready-to-move" ? `${rera.shortName}-PRJ-${(hashSeed(listingKey) % 9000) + 1000}` : undefined,
      isOwnListing,
    } satisfies Listing;
  });
}

/**
 * Which localities carry generated inventory.
 *
 * Localities with editorial content get a deep set so their landing pages look like real
 * markets. A spread of others gets a shallow set so city filters, the map and polygon draw have
 * something to work with outside the eight written-up areas — an empty map would hide bugs.
 */
function inventoryPlan(): { locality: LocalitySeed; count: number }[] {
  const plan: { locality: LocalitySeed; count: number }[] = [];

  for (const locality of LOCALITIES) {
    const hasContent = getLocalityContent(locality.citySlug, locality.slug) !== undefined;

    if (hasContent) {
      plan.push({ locality, count: 22 });
      continue;
    }

    // Deterministic thinning: keep roughly one locality in four, so the map is populated
    // without generating inventory for all 102.
    if (hashSeed(`${locality.citySlug}/${locality.slug}`) % 4 === 0) {
      plan.push({ locality, count: 6 });
    }
  }

  return plan;
}

/** Built once per process. Deterministic, so it is safe to treat as a stable fixture set. */
let cachedListings: Listing[] | null = null;

function allListings(): Listing[] {
  if (cachedListings) return cachedListings;
  cachedListings = inventoryPlan().flatMap(({ locality, count }) =>
    generateForLocality(locality, count),
  );
  return cachedListings;
}

/* ------------------------------------------------------------------ *
 * Query engine — defines the search semantics the API provider must match
 * ------------------------------------------------------------------ */

function matches(listing: Listing, q: ListingQuery): boolean {
  if (q.status?.length && !q.status.includes(listing.status)) return false;
  if (q.citySlugs?.length && !q.citySlugs.includes(listing.citySlug)) return false;

  if (q.localities?.length) {
    const hit = q.localities.some(
      (ref) =>
        ref.citySlug === listing.citySlug && ref.localitySlug === listing.localitySlug,
    );
    if (!hit) return false;
  }

  if (q.minPrice !== undefined && listing.listPrice < q.minPrice) return false;
  if (q.maxPrice !== undefined && listing.listPrice > q.maxPrice) return false;

  // Bedroom and bathroom filters must EXCLUDE plots rather than treat them as zero-bed. A buyer
  // asking for 3+ bedrooms does not want bare land in their results.
  if (q.minBeds !== undefined) {
    if (listing.bedroomsTotal === undefined || listing.bedroomsTotal < q.minBeds) return false;
  }
  if (q.minBaths !== undefined) {
    if (listing.bathroomsTotal === undefined || listing.bathroomsTotal < q.minBaths) return false;
  }

  const sqft = comparableSqft(listing);
  if (q.minSqft !== undefined && sqft < q.minSqft) return false;
  if (q.maxSqft !== undefined && sqft > q.maxSqft) return false;

  if (q.minYearBuilt !== undefined) {
    if (listing.yearBuilt === undefined || listing.yearBuilt < q.minYearBuilt) return false;
  }

  if (q.propertyTypes?.length && !q.propertyTypes.includes(listing.propertyType)) return false;
  if (q.possession?.length && !q.possession.includes(listing.possession)) return false;

  if (q.furnishing?.length) {
    if (!listing.furnishing || !q.furnishing.includes(listing.furnishing)) return false;
  }

  // A listing with no maintenance charge satisfies any maximum.
  if (q.maxMaintenance !== undefined && (listing.maintenanceCharges ?? 0) > q.maxMaintenance) {
    return false;
  }

  // Required features are AND-ed: the listing must have every one requested.
  if (q.features?.length && !q.features.every((f) => listing.features.includes(f))) return false;

  if (q.bounds && !pointInBounds(listing.coordinates, q.bounds)) return false;
  if (q.polygons?.length && !pointInAnyPolygon(listing.coordinates, q.polygons)) return false;

  if (q.q) {
    const needle = q.q.toLowerCase().trim();
    const haystack = [
      listing.address.unparsed,
      listing.referenceCode,
      listing.localitySlug.replace(/-/g, " "),
      listing.citySlug.replace(/-/g, " "),
      listing.publicRemarks,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

function sortListings(listings: Listing[], sort: ListingQuery["sort"]): Listing[] {
  const sorted = [...listings];
  switch (sort) {
    case "price-asc":
      return sorted.sort((a, b) => a.listPrice - b.listPrice);
    case "price-desc":
      return sorted.sort((a, b) => b.listPrice - a.listPrice);
    case "beds-desc":
      return sorted.sort((a, b) => (b.bedroomsTotal ?? 0) - (a.bedroomsTotal ?? 0));
    case "area-desc":
      return sorted.sort((a, b) => comparableSqft(b) - comparableSqft(a));
    case "newest":
    default:
      return sorted.sort((a, b) => a.daysOnMarket - b.daysOnMarket);
  }
}

const median = (nums: number[]): number => {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

/** Statuses a buyer browsing for-sale inventory expects to see by default. */
const FOR_SALE_STATUSES: ListingStatus[] = ["Active", "Under Offer", "Coming Soon"];

export class MockProvider implements ListingProvider {
  readonly name = "MockProvider (sample data)";
  /** False — so the site cannot present fabricated listings as real inventory. */
  readonly isLiveData = false;

  async search(query: ListingQuery): Promise<ListingResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(300, Math.max(1, query.pageSize ?? 24));

    const effective: ListingQuery = {
      ...query,
      status: query.status ?? FOR_SALE_STATUSES,
    };

    const filtered = allListings().filter((l) => matches(l, effective));
    const sorted = sortListings(filtered, effective.sort);
    const start = (page - 1) * pageSize;

    return {
      listings: sorted.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async getByKey(listingKey: string): Promise<Listing | null> {
    return allListings().find((l) => l.listingKey === listingKey) ?? null;
  }

  async getOwnListings(opts?: { includeSold?: boolean }): Promise<Listing[]> {
    return allListings()
      .filter((l) => l.isOwnListing && (opts?.includeSold || l.status !== "Sold"))
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket);
  }

  async getByLocality(ref: LocalityRef, limit = 6): Promise<Listing[]> {
    return allListings()
      .filter(
        (l) =>
          l.citySlug === ref.citySlug &&
          l.localitySlug === ref.localitySlug &&
          l.status === "Active",
      )
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket)
      .slice(0, limit);
  }

  async getByCity(citySlug: string, limit = 12): Promise<Listing[]> {
    return allListings()
      .filter((l) => l.citySlug === citySlug && l.status === "Active")
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket)
      .slice(0, limit);
  }

  async getMarketStats(ref: LocalityRef): Promise<MarketStats | null> {
    const inArea = allListings().filter(
      (l) => l.citySlug === ref.citySlug && l.localitySlug === ref.localitySlug,
    );
    if (inArea.length === 0) return null;

    const active = inArea.filter((l) => l.status === "Active");
    if (active.length === 0) return null;

    const sold = inArea.filter((l) => l.status === "Sold" && l.daysOnMarket <= 90);

    // Only listings with a known area can contribute to a per-sq-ft figure; including plots
    // priced by the marla alongside flats priced by the foot would produce a meaningless median.
    const perSqft = active
      .map((l) => ({ price: l.listPrice, sqft: comparableSqft(l) }))
      .filter((x) => x.sqft > 0)
      .map((x) => x.price / x.sqft);

    return {
      citySlug: ref.citySlug,
      localitySlug: ref.localitySlug,
      activeCount: active.length,
      medianListPrice: median(active.map((l) => l.listPrice)),
      medianPricePerSqft: perSqft.length ? Math.round(median(perSqft)) : 0,
      medianDaysOnMarket: Math.round(median(active.map((l) => l.daysOnMarket))),
      closedLast90Days: sold.length,
      // Below ~5 sales the median is noise, not signal — don't publish a misleading number.
      medianClosePrice:
        sold.length >= 5 ? median(sold.map((l) => l.closePrice ?? l.listPrice)) : null,
      priceChangePercent: null,
      generatedAt: new Date().toISOString(),
    };
  }
}
