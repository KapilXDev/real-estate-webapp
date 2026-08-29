/**
 * Bidirectional mapping between URL search params and `ListingQuery`.
 *
 * WHY THE URL IS THE SOURCE OF TRUTH FOR SEARCH STATE:
 *  - Buyers share searches ("look at this one"). State in React only would break that.
 *  - Back/forward navigation works for free.
 *  - Filtered result pages are crawlable, which is how a neighborhood + price-band page can
 *    ever rank.
 *  - The page still works with JavaScript disabled, because the hero form is a plain GET.
 *
 * Polygons are the one thing that cannot go in a readable URL — an encoded ring of coordinates
 * is long and opaque, so it is compacted (see encode/decodePolygons) rather than expanded.
 */

import type { PropertyType } from "@/config/neighborhoods";
import type { ListingQuery, ListingSort, ListingStatus, Polygon } from "./types";

const VALID_SORTS: ListingSort[] = [
  "newest",
  "price-asc",
  "price-desc",
  "beds-desc",
  "sqft-desc",
];

const VALID_PROPERTY_TYPES: PropertyType[] = [
  "single-family",
  "condo",
  "townhouse",
  "multi-family",
  "land",
];

const VALID_STATUSES: ListingStatus[] = [
  "Active",
  "Active Under Contract",
  "Pending",
  "Closed",
  "Coming Soon",
];

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function list(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Polygons as "lat lng lat lng|lat lng ...".
 * Coordinates are rounded to 5 decimals (~1m) — far finer than a finger-drawn boundary needs,
 * and it keeps the URL from ballooning with meaningless precision.
 */
function encodePolygons(polygons: Polygon[]): string {
  return polygons
    .map((ring) =>
      ring.map((p) => `${p.lat.toFixed(5)} ${p.lng.toFixed(5)}`).join(" "),
    )
    .join("|");
}

function decodePolygons(value: string | undefined): Polygon[] | undefined {
  if (!value) return undefined;

  const polygons = value
    .split("|")
    .map((ring) => {
      const nums = ring.split(/\s+/).map(Number).filter(Number.isFinite);
      const points: Polygon = [];
      // Coordinates come in lat/lng pairs; a trailing odd value is malformed input, so drop it.
      for (let i = 0; i + 1 < nums.length; i += 2) {
        points.push({ lat: nums[i], lng: nums[i + 1] });
      }
      return points;
    })
    // A ring needs at least 3 points to enclose area.
    .filter((ring) => ring.length >= 3);

  return polygons.length > 0 ? polygons : undefined;
}

/** Next 15+ hands `searchParams` as this shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function parseSearchParams(params: RawSearchParams): ListingQuery {
  const sort = first(params.sort);
  const propertyTypes = list(first(params.type))?.filter((t): t is PropertyType =>
    VALID_PROPERTY_TYPES.includes(t as PropertyType),
  );
  const status = list(first(params.status))?.filter((s): s is ListingStatus =>
    VALID_STATUSES.includes(s as ListingStatus),
  );

  return {
    q: first(params.q),
    neighborhoodSlugs: list(first(params.area)),
    status,
    minPrice: num(first(params.minPrice)),
    maxPrice: num(first(params.maxPrice)),
    minBeds: num(first(params.beds)),
    minBaths: num(first(params.baths)),
    minSqft: num(first(params.minSqft)),
    maxSqft: num(first(params.maxSqft)),
    minYearBuilt: num(first(params.minYear)),
    propertyTypes,
    maxHoaFee: num(first(params.maxHoa)),
    features: list(first(params.features)),
    polygons: decodePolygons(first(params.poly)),
    sort: VALID_SORTS.includes(sort as ListingSort) ? (sort as ListingSort) : "newest",
    page: num(first(params.page)) ?? 1,
    pageSize: 24,
  };
}

/**
 * Serialize a query back to a URLSearchParams. Omits defaults and empty values so shared URLs
 * stay short and readable rather than carrying every filter at its default setting.
 */
export function toSearchParams(query: ListingQuery): URLSearchParams {
  const params = new URLSearchParams();

  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  };

  set("q", query.q);
  set("minPrice", query.minPrice);
  set("maxPrice", query.maxPrice);
  set("beds", query.minBeds);
  set("baths", query.minBaths);
  set("minSqft", query.minSqft);
  set("maxSqft", query.maxSqft);
  set("minYear", query.minYearBuilt);
  set("maxHoa", query.maxHoaFee);

  if (query.neighborhoodSlugs?.length) params.set("area", query.neighborhoodSlugs.join(","));
  if (query.propertyTypes?.length) params.set("type", query.propertyTypes.join(","));
  if (query.status?.length) params.set("status", query.status.join(","));
  if (query.features?.length) params.set("features", query.features.join(","));
  if (query.polygons?.length) params.set("poly", encodePolygons(query.polygons));

  // "newest" is the default — no need to spell it out in the URL.
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  return params;
}

/** Count of filters the user actively set. Drives the "3 filters" badge on mobile. */
export function activeFilterCount(query: ListingQuery): number {
  return [
    query.minPrice,
    query.maxPrice,
    query.minBeds,
    query.minBaths,
    query.minSqft,
    query.maxSqft,
    query.minYearBuilt,
    query.maxHoaFee,
    query.neighborhoodSlugs?.length,
    query.propertyTypes?.length,
    query.features?.length,
    query.polygons?.length,
  ].filter(Boolean).length;
}

/** Human-readable summary for the results heading and page title. */
export function describeQuery(query: ListingQuery): string {
  const parts: string[] = [];

  if (query.minBeds) parts.push(`${query.minBeds}+ bed`);
  if (query.propertyTypes?.length === 1) {
    parts.push(query.propertyTypes[0].replace("-", " "));
  } else {
    parts.push("homes");
  }
  if (query.maxPrice) parts.push(`under $${Math.round(query.maxPrice / 1000)}k`);
  if (query.polygons?.length) parts.push("in your drawn area");

  return parts.join(" ");
}
