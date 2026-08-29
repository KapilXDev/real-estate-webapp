/**
 * INR money handling for the Indian property market.
 *
 * Indians read large numbers in the **lakh / crore** system, not thousands / millions:
 *   1 lakh (L)  = 100,000
 *   1 crore (Cr) = 10,000,000 = 100 lakh
 *
 * Digit grouping also differs — the Indian numbering system groups the last three digits, then
 * pairs: 1,25,00,000 rather than 12,500,000. `Intl.NumberFormat("en-IN")` handles this correctly,
 * so we lean on it rather than hand-rolling.
 *
 * STORAGE RULE: prices are stored as `numeric(16,2)` rupees. Never store a formatted string, and
 * never store "85" meaning 85 lakh — that ambiguity is how pricing bugs get into production.
 * Formatting is a presentation concern only.
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

/** "₹85,00,000" — full precision, Indian digit grouping. */
export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * "₹85 L" / "₹1.25 Cr" — the compact form used on cards, map pins, and search results.
 *
 * This is how property is actually discussed here, so it is the DEFAULT display for prices,
 * not an abbreviation fallback.
 */
export function formatPriceShort(amount: number): string {
  if (amount >= CRORE) {
    const cr = amount / CRORE;
    // 1.25 Cr, but 12 Cr rather than 12.00 Cr
    return `₹${trimZeros(cr >= 100 ? Math.round(cr) : round2(cr))} Cr`;
  }
  if (amount >= LAKH) {
    const lakh = amount / LAKH;
    return `₹${trimZeros(lakh >= 100 ? Math.round(lakh) : round2(lakh))} L`;
  }
  if (amount >= 1000) {
    return `₹${trimZeros(round2(amount / 1000))} K`;
  }
  return `₹${Math.round(amount)}`;
}

/** "₹85 Lakh" / "₹1.25 Crore" — spelled out, for headings and prose. */
export function formatPriceLong(amount: number): string {
  if (amount >= CRORE) {
    return `₹${trimZeros(round2(amount / CRORE))} Crore`;
  }
  if (amount >= LAKH) {
    const lakh = amount / LAKH;
    return `₹${trimZeros(round2(lakh))} Lakh`;
  }
  return formatRupees(amount);
}

/** "₹4,250/month" — rent and maintenance. */
export function formatMonthly(amount: number): string {
  return `${formatRupees(amount)}/month`;
}

/** "₹6,200/sq ft" — the comparison metric buyers here use most. */
export function formatPricePerSqft(price: number, sqft: number): string {
  if (!sqft || sqft <= 0) return "—";
  return `${formatRupees(Math.round(price / sqft))}/sq ft`;
}

/**
 * Parse user input that may use lakh/crore shorthand.
 *
 * Accepts: "8500000", "85 lakh", "85L", "1.25 cr", "1.25 crore", "₹85,00,000".
 * Returns rupees, or null when it cannot be parsed confidently.
 *
 * WHY: sellers and agents type "85 lakh" into a price field far more often than they type
 * 8500000, and silently misreading that by a factor of 100,000 would be a serious bug.
 */
export function parsePriceInput(input: string): number | null {
  const cleaned = input.trim().toLowerCase().replace(/[₹,\s]/g, "");
  if (!cleaned) return null;

  const match = /^(\d+(?:\.\d+)?)(cr|crore|crores|l|lac|lakh|lakhs|k)?$/.exec(cleaned);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  switch (match[2]) {
    case "cr":
    case "crore":
    case "crores":
      return value * CRORE;
    case "l":
    case "lac":
    case "lakh":
    case "lakhs":
      return value * LAKH;
    case "k":
      return value * 1000;
    default:
      return value;
  }
}

/**
 * Price buckets for search facets, in rupees.
 *
 * Chosen to match how the tricity market actually segments rather than being evenly spaced:
 * dense through the ₹30L–₹1.5Cr band where most flats and builder floors sit, then widening for
 * kothis and premium plots.
 */
export const PRICE_BUCKETS_SALE: number[] = [
  0, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_500_000, 8_000_000,
  1_00_00_000, 1_50_00_000, 2_00_00_000, 3_00_00_000, 5_00_00_000,
];

export const PRICE_BUCKETS_RENT: number[] = [
  0, 5_000, 10_000, 15_000, 20_000, 30_000, 50_000, 75_000, 1_00_000,
];

const round2 = (n: number): number => Math.round(n * 100) / 100;
const trimZeros = (n: number): string => String(Number(n.toFixed(2)));
