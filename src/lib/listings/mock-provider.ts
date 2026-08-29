/**
 * Sample-data provider — stands in until the IDX/MLS feed is approved.
 *
 * Generation is SEEDED and deterministic: the same neighborhood config always produces the same
 * listings. That keeps snapshots, screenshots, and shared links stable between runs, which a
 * `Math.random()` approach would not.
 *
 * Listings are derived from `src/config/neighborhoods.ts` — price bands, housing types, and
 * coordinates all come from that file. Replace the placeholder neighborhoods with the realtor's
 * real market and the sample inventory relocates with it, no changes needed here.
 *
 * The query engine below (filtering, polygon search, sorting, pagination) is NOT throwaway —
 * it defines the exact search semantics the RESO provider must reproduce.
 */

import { neighborhoods, type Neighborhood, type PropertyType } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { pointInAnyPolygon, pointInBounds } from "./geo";
import type { ListingProvider, MarketStats } from "./provider";
import type {
  Listing,
  ListingMedia,
  ListingQuery,
  ListingResult,
  ListingStatus,
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

/** Deterministic string -> integer seed, so a neighborhood slug always yields the same homes. */
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
  items[Math.floor(rng() * items.length)];

/** Pick `count` distinct items. Returns fewer if the pool is smaller. */
function pickSome<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

/** Round to a realistic listing price — agents price at $5k increments, not $412,837. */
const roundPrice = (n: number) => Math.round(n / 5000) * 5000;

/* ------------------------------------------------------------------ *
 * Vocabulary for generated listings
 * ------------------------------------------------------------------ */

const STREET_NAMES = [
  "Oak", "Maple", "Cedar", "Walnut", "Chestnut", "Lincoln", "Jefferson",
  "Adams", "Monroe", "Sherman", "Grant", "Highland", "Park", "Lakeview",
  "Riverside", "Summit", "Hawthorne", "Sycamore", "Briarwood", "Fairview",
];

const STREET_TYPES = ["St", "Ave", "Blvd", "Ln", "Dr", "Ct", "Pl", "Ter"];

/** Feature tags buyers actually filter on. Keep aligned with the filter UI. */
const FEATURE_POOL = [
  "Garage", "Fenced Yard", "Updated Kitchen", "Hardwood Floors", "Fireplace",
  "Finished Basement", "Central Air", "Primary Suite", "Walk-In Closet",
  "Covered Porch", "Pool", "Waterfront", "New Construction", "Solar",
  "Home Office", "Open Floor Plan", "Stainless Appliances", "Deck",
];

/** Weighted so most inventory is Active — matching a real market snapshot. */
const STATUS_WEIGHTS: [ListingStatus, number][] = [
  ["Active", 0.55],
  ["Pending", 0.14],
  ["Active Under Contract", 0.08],
  ["Coming Soon", 0.05],
  ["Closed", 0.18],
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

/** Competing brokerages, so attribution rendering is exercised with varied data. */
const OTHER_OFFICES = [
  { office: "Cornerstone Realty Group", agent: "M. Delgado" },
  { office: "Prairie State Properties", agent: "J. Okonkwo" },
  { office: "Heritage Home Partners", agent: "S. Lindqvist" },
  { office: "Redbud Real Estate", agent: "A. Varlamov" },
  { office: "Anchor & Key Realty", agent: "T. Nakamura" },
];

/* ------------------------------------------------------------------ *
 * Listing generation
 * ------------------------------------------------------------------ */

/** Scatter a point within `radiusKm` of a center, biased toward the middle like real density. */
function scatter(
  rng: Rng,
  center: { lat: number; lng: number },
  radiusKm: number,
): { lat: number; lng: number } {
  const angle = rng() * 2 * Math.PI;
  // sqrt() would distribute evenly by area; squaring instead clusters toward the center.
  const distance = radiusKm * rng() ** 1.6;
  const latDelta = distance / 111;
  const lngDelta = distance / (111 * Math.cos((center.lat * Math.PI) / 180));
  return {
    lat: center.lat + latDelta * Math.sin(angle),
    lng: center.lng + lngDelta * Math.cos(angle),
  };
}

function buildRemarks(
  rng: Rng,
  neighborhood: Neighborhood,
  beds: number,
  propertyType: PropertyType,
  features: string[],
): string {
  const openers = [
    `Well-kept ${beds}-bedroom ${propertyType.replace("-", " ")} in the heart of ${neighborhood.name}.`,
    `Move-in ready in ${neighborhood.name} — ${beds} bedrooms and thoughtful updates throughout.`,
    `Rare opportunity in ${neighborhood.name}: a ${beds}-bedroom home with genuine character.`,
    `Bright and comfortable ${beds}-bedroom ${propertyType.replace("-", " ")} on a quiet ${neighborhood.name} street.`,
  ];
  const closers = [
    "Schedule a showing before it's gone.",
    "Easy to show — reach out for a private tour.",
    "Priced to reflect current market conditions.",
    "Ask about recent updates and utility costs.",
  ];
  const featureLine = features.length
    ? ` Highlights include ${features.slice(0, 3).join(", ").toLowerCase()}.`
    : "";

  return `${pick(rng, openers)}${featureLine} ${neighborhood.tagline}. ${pick(rng, closers)}`;
}

function buildMedia(rng: Rng, seedKey: string, address: string): ListingMedia[] {
  const captions = [
    "Front exterior",
    "Living room",
    "Kitchen",
    "Primary bedroom",
    "Bathroom",
    "Back yard",
  ];
  const count = randInt(rng, 4, 6);
  return Array.from({ length: count }, (_, i) => ({
    // Locally generated SVG — no external image service, so the site works fully offline.
    url: `/api/placeholder/${seedKey}-${i}/1200/800`,
    caption: `${captions[i] ?? "Interior"} — ${address}`,
    order: i,
  }));
}

function generateForNeighborhood(neighborhood: Neighborhood, count: number): Listing[] {
  const rng = makeRng(hashSeed(neighborhood.slug));
  const now = Date.now();

  return Array.from({ length: count }, (_, i) => {
    const listingKey = `${neighborhood.slug}-${String(i + 1).padStart(3, "0")}`;
    const propertyType = pick(rng, neighborhood.housingTypes);
    const status = weightedStatus(rng);

    // Condos skew smaller; single-family skews larger.
    const isCompact = propertyType === "condo" || propertyType === "townhouse";
    const bedroomsTotal = isCompact ? randInt(rng, 1, 3) : randInt(rng, 2, 5);
    const bathroomsTotal = Math.max(1, bedroomsTotal - randInt(rng, 0, 1)) + (rng() > 0.6 ? 0.5 : 0);
    const livingArea = isCompact
      ? randInt(rng, 650, 1900)
      : randInt(rng, 1200, 3600);

    // Price from the neighborhood band, nudged by size so listings stay internally consistent.
    const { min, max } = neighborhood.priceRange;
    const sizeFactor = livingArea / (isCompact ? 1300 : 2200);
    const basePrice = min + (max - min) * rng();
    const listPrice = roundPrice(
      Math.min(max * 1.1, Math.max(min * 0.9, basePrice * (0.75 + 0.35 * sizeFactor))),
    );

    const coordinates = scatter(rng, neighborhood.center, neighborhood.radiusKm);
    const streetNumber = String(randInt(rng, 100, 4899));
    const streetName = `${pick(rng, STREET_NAMES)} ${pick(rng, STREET_TYPES)}`;
    const unit = propertyType === "condo" && rng() > 0.4 ? `#${randInt(rng, 1, 12)}${pick(rng, ["A", "B", "C"])}` : undefined;

    const unparsed = [
      `${streetNumber} ${streetName}${unit ? ` ${unit}` : ""}`,
      site.market.city,
      `${site.market.state} ${randInt(rng, 62701, 62712)}`,
    ].join(", ");

    const daysOnMarket = status === "Coming Soon" ? 0 : randInt(rng, 1, 120);
    const listDate = new Date(now - daysOnMarket * 86_400_000);

    // ~15% of inventory is the site owner's — enough to populate their own-listings page.
    const isOwnListing = rng() < 0.15;
    const other = pick(rng, OTHER_OFFICES);

    const features = pickSome(rng, FEATURE_POOL, randInt(rng, 3, 7));
    if (propertyType === "single-family" && !features.includes("Garage") && rng() > 0.5) {
      features.push("Garage");
    }

    return {
      listingKey,
      mlsNumber: `MLS${hashSeed(listingKey) % 900000 + 100000}`,
      status,
      listPrice,
      closePrice:
        status === "Closed"
          ? roundPrice(listPrice * (0.94 + rng() * 0.09))
          : undefined,
      address: {
        streetNumber,
        streetName,
        unit,
        city: site.market.city,
        stateOrProvince: site.market.state,
        postalCode: String(randInt(rng, 62701, 62712)),
        unparsed,
      },
      coordinates,
      neighborhoodSlug: neighborhood.slug,
      bedroomsTotal,
      bathroomsTotal,
      livingArea,
      lotSizeSquareFeet: isCompact ? undefined : randInt(rng, 4000, 18000),
      yearBuilt: randInt(rng, 1905, 2024),
      propertyType,
      associationFee: isCompact ? randInt(rng, 150, 620) : rng() > 0.85 ? randInt(rng, 40, 180) : undefined,
      taxAnnualAmount: Math.round((listPrice * (0.017 + rng() * 0.008)) / 10) * 10,
      publicRemarks: buildRemarks(rng, neighborhood, bedroomsTotal, propertyType, features),
      features,
      media: buildMedia(rng, listingKey, unparsed),
      daysOnMarket,
      modificationTimestamp: new Date(now - randInt(rng, 1, 20) * 3_600_000).toISOString(),
      listDate: listDate.toISOString(),
      listOfficeName: isOwnListing ? site.brokerage.name : other.office,
      listAgentFullName: isOwnListing ? site.agent.name : other.agent,
      isOwnListing,
    } satisfies Listing;
  });
}

/** Built once per process. Deterministic, so it is safe to treat as a stable fixture set. */
let cachedListings: Listing[] | null = null;

function allListings(): Listing[] {
  if (cachedListings) return cachedListings;

  cachedListings = neighborhoods.flatMap((n) =>
    // Larger areas get more inventory, keeping map density believable.
    generateForNeighborhood(n, Math.round(14 + n.radiusKm * 5)),
  );
  return cachedListings;
}

/* ------------------------------------------------------------------ *
 * Query engine — defines the search semantics ResoProvider must match
 * ------------------------------------------------------------------ */

function matches(listing: Listing, q: ListingQuery): boolean {
  if (q.status?.length && !q.status.includes(listing.status)) return false;
  if (q.neighborhoodSlugs?.length && !q.neighborhoodSlugs.includes(listing.neighborhoodSlug)) return false;

  if (q.minPrice !== undefined && listing.listPrice < q.minPrice) return false;
  if (q.maxPrice !== undefined && listing.listPrice > q.maxPrice) return false;
  if (q.minBeds !== undefined && listing.bedroomsTotal < q.minBeds) return false;
  if (q.minBaths !== undefined && listing.bathroomsTotal < q.minBaths) return false;
  if (q.minSqft !== undefined && listing.livingArea < q.minSqft) return false;
  if (q.maxSqft !== undefined && listing.livingArea > q.maxSqft) return false;
  if (q.minYearBuilt !== undefined && listing.yearBuilt < q.minYearBuilt) return false;
  if (q.propertyTypes?.length && !q.propertyTypes.includes(listing.propertyType)) return false;

  // A listing with no HOA satisfies any max-HOA filter.
  if (q.maxHoaFee !== undefined && (listing.associationFee ?? 0) > q.maxHoaFee) return false;

  // Required features are AND-ed: the listing must have every one requested.
  if (q.features?.length && !q.features.every((f) => listing.features.includes(f))) return false;

  if (q.bounds && !pointInBounds(listing.coordinates, q.bounds)) return false;
  if (q.polygons?.length && !pointInAnyPolygon(listing.coordinates, q.polygons)) return false;

  if (q.q) {
    const needle = q.q.toLowerCase().trim();
    const haystack = [
      listing.address.unparsed,
      listing.mlsNumber,
      listing.neighborhoodSlug.replace(/-/g, " "),
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
      return sorted.sort((a, b) => b.bedroomsTotal - a.bedroomsTotal);
    case "sqft-desc":
      return sorted.sort((a, b) => b.livingArea - a.livingArea);
    case "newest":
    default:
      return sorted.sort((a, b) => a.daysOnMarket - b.daysOnMarket);
  }
}

const median = (nums: number[]): number => {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export class MockProvider implements ListingProvider {
  readonly name = "MockProvider (sample data)";
  /** False — so the UI suppresses real MLS attribution over fabricated listings. */
  readonly isLiveMlsData = false;

  async search(query: ListingQuery): Promise<ListingResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));

    // Default to for-sale inventory; buyers rarely want closed sales mixed in.
    const effective: ListingQuery = {
      ...query,
      status: query.status ?? ["Active", "Active Under Contract", "Coming Soon"],
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
      .filter((l) => l.isOwnListing && (opts?.includeSold || l.status !== "Closed"))
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket);
  }

  async getByNeighborhood(slug: string, limit = 6): Promise<Listing[]> {
    return allListings()
      .filter((l) => l.neighborhoodSlug === slug && l.status === "Active")
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket)
      .slice(0, limit);
  }

  async getMarketStats(neighborhoodSlug: string): Promise<MarketStats | null> {
    const inArea = allListings().filter((l) => l.neighborhoodSlug === neighborhoodSlug);
    if (inArea.length === 0) return null;

    const active = inArea.filter((l) => l.status === "Active");
    const closed = inArea.filter((l) => l.status === "Closed" && l.daysOnMarket <= 90);

    return {
      neighborhoodSlug,
      activeCount: active.length,
      medianListPrice: median(active.map((l) => l.listPrice)),
      medianPricePerSqft: Math.round(median(active.map((l) => l.listPrice / l.livingArea))),
      medianDaysOnMarket: Math.round(median(active.map((l) => l.daysOnMarket))),
      closedLast90Days: closed.length,
      // Below ~5 sales the median is noise, not signal — don't publish a misleading number.
      medianClosePrice: closed.length >= 5 ? median(closed.map((l) => l.closePrice ?? l.listPrice)) : null,
      priceChangePercent: null,
      generatedAt: new Date().toISOString(),
    };
  }
}
