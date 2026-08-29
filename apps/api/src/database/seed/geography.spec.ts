import { describe, expect, it } from "vitest";

import { CITIES, LOCALITIES, circlePolygon } from "./geography";

/**
 * Invariants for the geography seed.
 *
 * These matter more than typical fixture tests because the locality centroids are GENERATED
 * from a grid model rather than surveyed. The grid maths is easy to get subtly wrong — an
 * off-by-one in the row calculation or a sign error in the rotation would scatter sectors
 * across Punjab, and nothing downstream would complain. These tests are the guard rail.
 */

/** Generous bounding box around the tricity. Anything outside is a maths bug, not a nuance. */
const TRICITY_BOUNDS = { minLat: 30.55, maxLat: 30.9, minLng: 76.55, maxLng: 76.95 };

/** Haversine, metres. */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

describe("city seed", () => {
  it("covers the six tricity-area municipalities", () => {
    expect(CITIES.map((c) => c.slug).sort()).toEqual([
      "chandigarh",
      "kharar",
      "mohali",
      "new-chandigarh",
      "panchkula",
      "zirakpur",
    ]);
  });

  it("assigns the correct state to each city", () => {
    // Chandigarh is a Union Territory, not part of Punjab — this drives which RERA
    // authority applies, so getting it wrong has compliance consequences.
    const byslug = new Map(CITIES.map((c) => [c.slug, c.state]));
    expect(byslug.get("chandigarh")).toBe("Chandigarh");
    expect(byslug.get("mohali")).toBe("Punjab");
    expect(byslug.get("kharar")).toBe("Punjab");
    expect(byslug.get("panchkula")).toBe("Haryana");
  });

  it("places every city inside the tricity bounding box", () => {
    for (const city of CITIES) {
      expect(city.lat).toBeGreaterThan(TRICITY_BOUNDS.minLat);
      expect(city.lat).toBeLessThan(TRICITY_BOUNDS.maxLat);
      expect(city.lng).toBeGreaterThan(TRICITY_BOUNDS.minLng);
      expect(city.lng).toBeLessThan(TRICITY_BOUNDS.maxLng);
    }
  });
});

describe("locality seed", () => {
  it("places every generated locality inside the tricity bounding box", () => {
    const strays = LOCALITIES.filter(
      (l) =>
        l.lat < TRICITY_BOUNDS.minLat ||
        l.lat > TRICITY_BOUNDS.maxLat ||
        l.lng < TRICITY_BOUNDS.minLng ||
        l.lng > TRICITY_BOUNDS.maxLng,
    ).map((l) => `${l.citySlug}/${l.slug} @ ${l.lat},${l.lng}`);

    expect(strays).toEqual([]);
  });

  it("has unique slugs within each city", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const locality of LOCALITIES) {
      const key = `${locality.citySlug}/${locality.slug}`;
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }

    // The schema has UNIQUE (city_id, slug), so a duplicate here fails the seed at runtime.
    expect(duplicates).toEqual([]);
  });

  it("references only cities that exist", () => {
    const citySlugs = new Set(CITIES.map((c) => c.slug));
    const orphans = LOCALITIES.filter((l) => !citySlugs.has(l.citySlug)).map((l) => l.slug);
    expect(orphans).toEqual([]);
  });

  it("gives every locality a positive radius", () => {
    expect(LOCALITIES.every((l) => l.radiusM > 0)).toBe(true);
  });
});

describe("Chandigarh sectors", () => {
  const chandigarh = LOCALITIES.filter((l) => l.citySlug === "chandigarh");

  it("omits Sector 13", () => {
    // Le Corbusier deliberately left 13 out of the plan. Seeding it would create a locality
    // nobody searches for and that reads as a data-quality bug.
    expect(chandigarh.find((l) => l.slug === "sector-13")).toBeUndefined();
  });

  it("has 55 sectors — 1 through 56 with 13 missing", () => {
    expect(chandigarh).toHaveLength(55);
  });

  it("includes the landmark sectors", () => {
    const slugs = new Set(chandigarh.map((l) => l.slug));
    expect(slugs.has("sector-17")).toBe(true); // City Centre
    expect(slugs.has("sector-1")).toBe(true); // Capitol Complex
    expect(slugs.has("sector-56")).toBe(true);
  });

  it("spreads sectors out rather than stacking them on one point", () => {
    // A rotation or offset bug would collapse every sector onto the anchor. Assert the
    // generated grid actually spans a plausible city-sized area.
    const lats = chandigarh.map((l) => l.lat);
    const lngs = chandigarh.map((l) => l.lng);
    const spanLat = Math.max(...lats) - Math.min(...lats);
    const spanLng = Math.max(...lngs) - Math.min(...lngs);

    // Chandigarh spans very roughly 0.06-0.12 degrees each way.
    expect(spanLat).toBeGreaterThan(0.03);
    expect(spanLng).toBeGreaterThan(0.03);
    expect(spanLat).toBeLessThan(0.2);
    expect(spanLng).toBeLessThan(0.2);
  });

  it("keeps adjacent sectors in a row roughly one sector-width apart", () => {
    const s1 = chandigarh.find((l) => l.slug === "sector-1")!;
    const s2 = chandigarh.find((l) => l.slug === "sector-2")!;
    const gap = distanceM(s1.lat, s1.lng, s2.lat, s2.lng);

    // Modelled sector width is 1200m; allow generous slack for the rotation.
    expect(gap).toBeGreaterThan(900);
    expect(gap).toBeLessThan(1500);
  });
});

describe("Mohali localities", () => {
  const mohali = LOCALITIES.filter((l) => l.citySlug === "mohali");

  it("carries both naming systems — buyers use each", () => {
    // Phases 1-11 are the older town; Sectors 66-91 are the GMADA expansion. Dropping either
    // loses real search traffic.
    expect(mohali.filter((l) => l.kind === "PHASE")).toHaveLength(11);
    expect(mohali.filter((l) => l.kind === "SECTOR")).toHaveLength(26);
  });

  it("numbers sectors 66 through 91", () => {
    const numbers = mohali
      .filter((l) => l.kind === "SECTOR")
      .map((l) => Number(l.slug.replace("sector-", "")))
      .sort((a, b) => a - b);

    expect(numbers[0]).toBe(66);
    expect(numbers[numbers.length - 1]).toBe(91);
  });
});

describe("Kharar localities", () => {
  it("uses named colonies rather than a sector grid", () => {
    // Kharar is not a planned grid — inventory here is genuinely described by colony name.
    const kharar = LOCALITIES.filter((l) => l.citySlug === "kharar");
    expect(kharar.length).toBeGreaterThan(0);
    expect(kharar.every((l) => l.kind !== "SECTOR")).toBe(true);
    expect(kharar.map((l) => l.slug)).toContain("sunny-enclave");
  });
});

describe("circlePolygon", () => {
  it("returns a closed ring", () => {
    const ring = circlePolygon(30.7333, 76.7794, 700).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("emits segments + 1 points", () => {
    expect(circlePolygon(30.7333, 76.7794, 700, 24).coordinates[0]).toHaveLength(25);
    expect(circlePolygon(30.7333, 76.7794, 700, 8).coordinates[0]).toHaveLength(9);
  });

  it("puts every vertex at approximately the requested radius", () => {
    const radiusM = 700;
    const ring = circlePolygon(30.7333, 76.7794, radiusM).coordinates[0]!;

    for (const [lng, lat] of ring) {
      const d = distanceM(30.7333, 76.7794, lat, lng);
      // Planar approximation plus 6-decimal rounding; 5% tolerance is comfortable.
      expect(Math.abs(d - radiusM)).toBeLessThan(radiusM * 0.05);
    }
  });

  it("orders coordinates as GeoJSON [lng, lat], not [lat, lng]", () => {
    // Swapping these is the single most common PostGIS bug, and it silently places every
    // locality in the Indian Ocean off Somalia rather than erroring.
    const [lng, lat] = circlePolygon(30.7333, 76.7794, 700).coordinates[0]![0]!;
    expect(lng).toBeGreaterThan(76);
    expect(lng).toBeLessThan(77);
    expect(lat).toBeGreaterThan(30);
    expect(lat).toBeLessThan(31);
  });
});
