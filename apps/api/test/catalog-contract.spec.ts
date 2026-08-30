import { plainToInstance } from "class-transformer";
import { describe, expect, it } from "vitest";
import { toSearchParams, type ListingSearchParamsDto } from "@tricity/contracts";

import { SearchListingsDto } from "../src/catalog/dto/search-listings.dto";

/**
 * ⚠️ THE DRIFT GUARD BETWEEN THE CLIENT'S ENCODER AND THE SERVER'S PARSER.
 *
 * `@tricity/contracts` defines `toSearchParams`, which `apps/web` uses to build the query string.
 * `SearchListingsDto` parses that string back on the server. Ideally the server would import the
 * contract's own `parseLocalityRef` so there is one implementation — but `apps/api` compiles to
 * CommonJS and the workspace packages ship raw TypeScript, so a *value* import from contracts
 * cannot survive the build (see `catalog/utils/locality-ref.ts`). The server therefore keeps its
 * own copy.
 *
 * Two implementations of one format is exactly how a filter silently starts returning everything:
 * one side writes `citySlugs=a&citySlugs=b`, the other reads `citySlugs=a,b`, both typecheck, and
 * nothing complains until a buyer sees the wrong results.
 *
 * This test closes that hole by round-tripping the REAL encoder through the REAL DTO. Vitest runs
 * TypeScript natively, so it can import contracts as a value where the compiled app cannot.
 *
 * If this fails, do not "fix" it by editing the expectation — the encoder and parser have
 * genuinely diverged and one of them is now wrong.
 */

/** Mirror what Nest's ValidationPipe does to a query object, without booting the app. */
function parseQueryString(search: URLSearchParams): SearchListingsDto {
  // Express/qs semantics: a repeated key becomes an array, a single key stays a scalar. Getting
  // this wrong in the test would hide the exact bug the test exists to catch.
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }
  return plainToInstance(SearchListingsDto, raw);
}

function roundTrip(params: ListingSearchParamsDto): ListingSearchParamsDto {
  return parseQueryString(toSearchParams(params)).toParams();
}

describe("search params survive the client encoder -> server parser round trip", () => {
  it("keeps a single locality as a (city, locality) pair", () => {
    const out = roundTrip({ localities: [{ citySlug: "mohali", localitySlug: "sector-70" }] });

    expect(out.localities).toEqual([{ citySlug: "mohali", localitySlug: "sector-70" }]);
  });

  it("keeps MULTIPLE localities distinct rather than collapsing them", () => {
    /*
     * The single-value case passes under almost any encoding. This is the one that catches a
     * comma-joined encoder being read as repeated keys, or vice versa — and it is the case a
     * buyer hits the moment they tick a second area.
     */
    const localities = [
      { citySlug: "mohali", localitySlug: "sector-70" },
      { citySlug: "chandigarh", localitySlug: "sector-9" },
      { citySlug: "kharar", localitySlug: "sunny-enclave" },
    ];

    expect(roundTrip({ localities }).localities).toEqual(localities);
  });

  it("does not confuse two same-named localities in different cities", () => {
    // The whole reason the wire carries a pair: `phase-7` exists in more than one municipality.
    const localities = [
      { citySlug: "mohali", localitySlug: "phase-7" },
      { citySlug: "kharar", localitySlug: "phase-7" },
    ];

    expect(roundTrip({ localities }).localities).toEqual(localities);
  });

  it("round-trips every scalar filter with its type intact", () => {
    const params: ListingSearchParamsDto = {
      q: "corner plot",
      minPrice: 5_000_000,
      maxPrice: 25_000_000,
      minBeds: 3,
      minBaths: 2,
      minSqft: 1200,
      maxSqft: 5000,
      minYearBuilt: 2010,
      maxMaintenance: 4000,
      sort: "price-asc",
      page: 2,
      pageSize: 48,
      transactionType: "sale",
    };

    const out = roundTrip(params);

    // ⚠️ toEqual, not a loose comparison: `"5000000"` would pass a `==` check and then sort
    // lexically in SQL. The types have to survive, not just the values.
    for (const [key, value] of Object.entries(params)) {
      expect(out[key as keyof ListingSearchParamsDto], `${key} did not round-trip`).toEqual(value);
    }
  });

  it("round-trips repeated string lists", () => {
    const params: ListingSearchParamsDto = {
      citySlugs: ["mohali", "chandigarh"],
      propertyTypes: ["kothi", "plot", "builder-floor"],
      possession: ["ready-to-move", "under-construction"],
      furnishing: ["semi-furnished"],
      status: ["active", "under-offer"],
      features: ["Corner Plot", "Park Facing"],
    };

    const out = roundTrip(params);

    expect(out.citySlugs).toEqual(params.citySlugs);
    expect(out.propertyTypes).toEqual(params.propertyTypes);
    expect(out.possession).toEqual(params.possession);
    expect(out.furnishing).toEqual(params.furnishing);
    expect(out.status).toEqual(params.status);
    expect(out.features).toEqual(params.features);
  });

  it("round-trips a single-element list as a list, not a bare string", () => {
    // `?propertyTypes=flat` arrives as a scalar. Anything downstream calling `.map` on it would
    // throw — and only for searches with exactly one type selected.
    const out = roundTrip({ propertyTypes: ["flat"] });

    expect(Array.isArray(out.propertyTypes)).toBe(true);
    expect(out.propertyTypes).toEqual(["flat"]);
  });

  it("round-trips map bounds without transposing them", () => {
    const bounds = { north: 30.8, south: 30.6, east: 76.9, west: 76.6 };

    expect(roundTrip({ bounds }).bounds).toEqual(bounds);
  });

  it("round-trips polygons with lat/lng in the right order", () => {
    /*
     * Asymmetric on purpose. A square polygon would survive a lat/lng swap unnoticed; these
     * points do not, so a transposition shows up here rather than as "map search returns nothing".
     */
    const polygons = [
      [
        { lat: 30.71, lng: 76.72 },
        { lat: 30.74, lng: 76.73 },
        { lat: 30.73, lng: 76.78 },
      ],
    ];

    expect(roundTrip({ polygons }).polygons).toEqual(polygons);
  });

  it("drops an empty query to an empty query rather than inventing filters", () => {
    const out = roundTrip({});

    // Every value must be undefined — a stray `[]` or `0` here becomes a filter that matches
    // nothing, turning an unfiltered search into an empty results page.
    for (const [key, value] of Object.entries(out)) {
      expect(value, `${key} should be absent on an empty query`).toBeUndefined();
    }
  });
});

describe("the parser rejects what the encoder would never produce", () => {
  it("drops a bare locality slug with no city", () => {
    // `?area=sector-70` is ambiguous across three sector-numbering municipalities. Half-matching
    // it would tell a buyer a property is in a different town.
    const parsed = parseQueryString(new URLSearchParams([["area", "sector-70"]]));

    expect(parsed.toParams().localities).toEqual([]);
  });

  it("drops an over-deep locality path", () => {
    const parsed = parseQueryString(new URLSearchParams([["area", "punjab/mohali/sector-70"]]));

    expect(parsed.toParams().localities).toEqual([]);
  });

  it("survives malformed polygon JSON instead of throwing", () => {
    // A hand-mangled URL must not 500 a public search page.
    const parsed = parseQueryString(new URLSearchParams([["polygons", "{not json"]]));

    expect(parsed.toParams().polygons).toBeUndefined();
  });

  it("caps polygon count and vertex count", () => {
    const hugePolygon = Array.from({ length: 5000 }, (_, i) => ({ lat: 30 + i / 1e6, lng: 76 }));
    const manyPolygons = Array.from({ length: 50 }, () => hugePolygon);

    const parsed = parseQueryString(
      new URLSearchParams([["polygons", JSON.stringify(manyPolygons)]]),
    );
    const out = parsed.toParams().polygons!;

    // Each polygon becomes an ST_Intersects against the GiST index; unbounded input is a cheap
    // request that turns into arbitrarily expensive server work.
    expect(out.length).toBeLessThanOrEqual(10);
    expect(Math.max(...out.map((p) => p.length))).toBeLessThanOrEqual(200);
  });

  it("discards unknown enum values rather than passing them to SQL", () => {
    const parsed = parseQueryString(
      new URLSearchParams([
        ["propertyTypes", "kothi"],
        ["propertyTypes", "castle"],
      ]),
    );

    expect(parsed.toParams().propertyTypes).toEqual(["kothi"]);
  });
});
