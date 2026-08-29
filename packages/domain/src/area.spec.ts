import { describe, expect, it } from "vitest";

import { Area, COMMON_AREA_UNITS, SQ_FT_PER_UNIT, formatSqft } from "./area";

/**
 * Area is the other place where a quiet arithmetic error becomes a mispriced listing: a 10 marla
 * kothi advertised as 10 kanal is off by 20x. The Punjab marla/kanal constants below are the
 * whole point of this package, so they are asserted literally rather than derived.
 */

describe("conversion constants", () => {
  it("uses the Punjab marla, not the 25 sq yd one", () => {
    // 1 marla = 30.25 sq yd = 272.25 sq ft in Punjab/Haryana. Some regions use 225 sq ft.
    // Picking the wrong one understates every plot in the market by 17%.
    expect(SQ_FT_PER_UNIT.MARLA).toBe(272.25);
    expect(SQ_FT_PER_UNIT.SQ_YD).toBe(9);
    expect(SQ_FT_PER_UNIT.MARLA).toBeCloseTo(30.25 * SQ_FT_PER_UNIT.SQ_YD, 6);
  });

  it("keeps kanal at exactly 20 marla", () => {
    expect(SQ_FT_PER_UNIT.KANAL).toBe(20 * SQ_FT_PER_UNIT.MARLA);
    expect(SQ_FT_PER_UNIT.KANAL).toBe(5445);
  });

  it("offers gaj and marla first — those are what people here actually use", () => {
    expect(COMMON_AREA_UNITS[0]).toBe("SQ_YD");
    expect(COMMON_AREA_UNITS[1]).toBe("MARLA");
  });

  it("has a label for every unit it can convert", () => {
    for (const unit of COMMON_AREA_UNITS) {
      expect(SQ_FT_PER_UNIT[unit]).toBeGreaterThan(0);
    }
  });
});

describe("Area.of", () => {
  it("converts marla and kanal to canonical square feet", () => {
    expect(Area.of(10, "MARLA").sqft).toBe(2722.5);
    expect(Area.of(1, "KANAL").sqft).toBe(5445);
    expect(Area.of(250, "SQ_YD").sqft).toBe(2250);
  });

  it("records the factor it used", () => {
    // Stored per row so a future correction to the constant cannot silently rewrite history.
    expect(Area.of(10, "MARLA").conversionFactor).toBe(272.25);
  });

  it("rejects non-positive and non-finite values", () => {
    expect(() => Area.of(0, "MARLA")).toThrow(RangeError);
    expect(() => Area.of(-5, "SQ_FT")).toThrow(RangeError);
    expect(() => Area.of(Number.NaN, "SQ_FT")).toThrow(RangeError);
    expect(() => Area.of(Number.POSITIVE_INFINITY, "SQ_FT")).toThrow(RangeError);
  });
});

describe("Area.to", () => {
  it("round-trips between marla and kanal", () => {
    expect(Area.of(1, "KANAL").to("MARLA")).toBe(20);
    expect(Area.of(20, "MARLA").to("KANAL")).toBe(1);
  });

  it("converts marla to gaj", () => {
    expect(Area.of(1, "MARLA").to("SQ_YD")).toBe(30.25);
  });
});

describe("Area.format", () => {
  it("echoes back exactly what the user typed", () => {
    // A seller who entered "10 marla" must not be shown "2722.5 sq ft" — it reads as the site
    // having misunderstood them.
    expect(Area.of(10, "MARLA").format()).toBe("10 marla");
    expect(Area.of(250, "SQ_YD").format()).toBe("250 gaj");
  });

  it("singularises where the unit has a distinct singular", () => {
    expect(Area.of(1, "ACRE").format()).toBe("1 acre");
    expect(Area.of(2, "ACRE").format()).toBe("2 acres");
  });

  it("trims trailing zeros", () => {
    expect(Area.of(10.5, "MARLA").format()).toBe("10.5 marla");
    expect(Area.of(10.0, "MARLA").format()).toBe("10 marla");
  });

  it("does not repeat itself when the input unit is already sq ft", () => {
    expect(Area.of(1700, "SQ_FT").formatWithSqft()).toBe("1700 sq ft");
  });

  it("shows both units when the input was not sq ft", () => {
    expect(Area.of(10, "MARLA").formatWithSqft()).toBe("10 marla (2,723 sq ft)");
  });
});

describe("Area.fromStored", () => {
  it("preserves what was entered even if the constant later changes", () => {
    // Simulates a row written when marla was recorded as 225 sq ft. The listing must still read
    // "10 marla" and still carry the square footage it was stored with — not be silently
    // restated under today's 272.25 factor.
    const legacy = Area.fromStored(10, "MARLA", 2250, 225);

    expect(legacy.format()).toBe("10 marla");
    expect(legacy.sqft).toBe(2250);
    expect(legacy.conversionFactor).toBe(225);
  });
});

describe("formatSqft", () => {
  it("uses Indian digit grouping", () => {
    expect(formatSqft(2722.5)).toBe("2,723 sq ft");
    // en-IN groups the last three digits then pairs: 12,50,000 not 1,250,000.
    expect(formatSqft(1_250_000)).toBe("12,50,000 sq ft");
  });
});
