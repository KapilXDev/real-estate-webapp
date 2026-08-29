/**
 * Display formatting.
 *
 * Centralised because listing figures appear in cards, map pins, detail pages, emails, and
 * schema.org markup — inconsistent formatting across those reads as sloppiness on a site whose
 * entire job is projecting competence with money.
 */

/** "$425,000" — no cents. Real estate prices are never shown to the cent. */
export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** "$425K" / "$1.2M" — for map pins and other tight spaces. */
export function formatPriceCompact(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    // 1.2M, but 12M rather than 12.0M.
    return `$${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

/** "1,850" — square footage with thousands separators. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** "1,850 sq ft" */
export function formatSqft(value: number): string {
  return `${formatNumber(value)} sq ft`;
}

/**
 * "2.5" from 2.5, "2" from 2 — bathrooms use half-counts, and "2.0 baths" looks wrong to
 * anyone in the industry.
 */
export function formatBaths(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "0.28 acres" from square feet. Lot sizes above ~10k sqft read better in acres. */
export function formatLotSize(squareFeet: number): string {
  const ACRE_SQFT = 43_560;
  if (squareFeet >= 10_000) return `${(squareFeet / ACRE_SQFT).toFixed(2)} acres`;
  return formatSqft(squareFeet);
}

/** "$248/sq ft" — the comparison metric experienced buyers actually use. */
export function formatPricePerSqft(price: number, sqft: number): string {
  if (!sqft) return "—";
  return `$${Math.round(price / sqft)}/sq ft`;
}

/** "$1,240/mo" */
export function formatMonthly(value: number): string {
  return `${formatPrice(Math.round(value))}/mo`;
}

/**
 * "New today" / "3 days on market" / "2 months on market".
 * Days-on-market is a signal buyers read closely, so phrase it plainly rather than as a raw number.
 */
export function formatDaysOnMarket(days: number): string {
  if (days <= 0) return "New today";
  if (days === 1) return "1 day on market";
  if (days < 30) return `${days} days on market`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month on market" : `${months} months on market`;
}

/** "Updated 3 hours ago" — the compliance-required feed freshness stamp. */
export function formatRelativeTime(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return "unknown";

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "March 2024" */
export function formatMonthYear(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
