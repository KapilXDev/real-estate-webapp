import { describe, expect, it } from "vitest";

import {
  PRICE_BUCKETS_SALE,
  formatMonthly,
  formatPriceLong,
  formatPriceShort,
  formatPricePerSqft,
  formatRupees,
  parsePriceInput,
} from "./money";

/**
 * These tests exist because a formatting slip here is not cosmetic — it is a factor-of-100,000
 * pricing error on the most important number on the page. `parsePriceInput` in particular is the
 * one function where a wrong answer looks completely plausible: "85" and "85 lakh" are both
 * things a human types into a price field, and they differ by five orders of magnitude.
 */

describe("formatPriceShort", () => {
  it("uses lakh below a crore and crore above it", () => {
    expect(formatPriceShort(8_500_000)).toBe("₹85 L");
    expect(formatPriceShort(12_500_000)).toBe("₹1.25 Cr");
  });

  it("switches unit exactly at the crore boundary", () => {
    // Off-by-one here would print "₹100 L" for a price everyone in the market calls 1 crore.
    expect(formatPriceShort(9_999_999)).toBe("₹100 L");
    expect(formatPriceShort(10_000_000)).toBe("₹1 Cr");
  });

  it("drops trailing zeros rather than printing 12.00 Cr", () => {
    expect(formatPriceShort(120_000_000)).toBe("₹12 Cr");
    expect(formatPriceShort(4_000_000)).toBe("₹40 L");
  });

  it("rounds to whole units once the number is large enough not to need precision", () => {
    expect(formatPriceShort(1_000_000_000)).toBe("₹100 Cr");
  });
});

describe("formatPriceLong", () => {
  it("spells the unit out for headings and prose", () => {
    expect(formatPriceLong(8_500_000)).toBe("₹85 Lakh");
    expect(formatPriceLong(12_500_000)).toBe("₹1.25 Crore");
  });

  it("falls back to full rupees below a lakh", () => {
    expect(formatPriceLong(45_000)).toBe(formatRupees(45_000));
  });
});

describe("formatRupees", () => {
  it("groups digits the Indian way, not the western way", () => {
    // 85,00,000 — NOT 8,500,000. Western grouping on an Indian price page reads as a foreign
    // site and undermines the whole thing.
    const formatted = formatRupees(8_500_000);
    expect(formatted).toContain("85,00,000");
  });

  it("never shows paise", () => {
    expect(formatRupees(8_500_000.75)).not.toContain(".");
  });
});

describe("formatPricePerSqft", () => {
  it("computes the comparison metric buyers actually use", () => {
    expect(formatPricePerSqft(8_500_000, 1700)).toBe(`${formatRupees(5000)}/sq ft`);
  });

  it("returns a dash rather than Infinity when area is missing", () => {
    // A listing with no area is common in this market; printing "₹Infinity/sq ft" would be worse
    // than saying nothing.
    expect(formatPricePerSqft(8_500_000, 0)).toBe("—");
    expect(formatPricePerSqft(8_500_000, -1)).toBe("—");
  });
});

describe("formatMonthly", () => {
  it("suffixes rent with /month", () => {
    expect(formatMonthly(25_000)).toContain("/month");
    expect(formatMonthly(25_000)).toContain("25,000");
  });
});

describe("parsePriceInput", () => {
  it("reads lakh and crore shorthand the way an agent types it", () => {
    expect(parsePriceInput("85 lakh")).toBe(8_500_000);
    expect(parsePriceInput("85L")).toBe(8_500_000);
    expect(parsePriceInput("85 lac")).toBe(8_500_000);
    expect(parsePriceInput("85 lakhs")).toBe(8_500_000);
    expect(parsePriceInput("1.25 cr")).toBe(12_500_000);
    expect(parsePriceInput("1.25crore")).toBe(12_500_000);
  });

  it("strips rupee symbols and Indian digit grouping", () => {
    expect(parsePriceInput("₹85,00,000")).toBe(8_500_000);
    expect(parsePriceInput("  ₹ 1.25 Cr ")).toBe(12_500_000);
  });

  it("treats a bare number as rupees, NOT as lakh", () => {
    // This is the dangerous direction. Silently promoting "85" to ₹85 lakh would misprice a
    // listing by 100,000x, and the result looks entirely plausible on the page.
    expect(parsePriceInput("85")).toBe(85);
    expect(parsePriceInput("8500000")).toBe(8_500_000);
  });

  it("round-trips its own compact output", () => {
    // formatPriceShort is what we render; parsePriceInput is what we read back from an edit
    // form. If these two ever disagree, editing a listing silently changes its price.
    for (const amount of [4_000_000, 8_500_000, 12_500_000, 120_000_000]) {
      expect(parsePriceInput(formatPriceShort(amount))).toBe(amount);
    }
  });

  it("returns null rather than guessing at input it cannot parse", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("   ")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("85 lakh or best offer")).toBeNull();
    expect(parsePriceInput("1.2.3 cr")).toBeNull();
  });
});

describe("PRICE_BUCKETS_SALE", () => {
  it("is strictly ascending", () => {
    // Search facets built from an unsorted bucket list produce overlapping ranges that quietly
    // return wrong result counts.
    for (let i = 1; i < PRICE_BUCKETS_SALE.length; i++) {
      expect(PRICE_BUCKETS_SALE[i]!).toBeGreaterThan(PRICE_BUCKETS_SALE[i - 1]!);
    }
  });

  it("is dense through the band where most tricity inventory actually sits", () => {
    // Evenly spaced buckets would put half the market in one bucket. Assert at least four
    // boundaries fall in the ₹30L–₹1.5Cr range where flats and builder floors cluster.
    const inBand = PRICE_BUCKETS_SALE.filter((p) => p >= 3_000_000 && p <= 15_000_000);
    expect(inBand.length).toBeGreaterThanOrEqual(4);
  });
});
