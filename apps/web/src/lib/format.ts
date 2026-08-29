/**
 * Display formatting for the website.
 *
 * This module is deliberately THIN. Every rule that could be wrong in a way that costs money —
 * lakh/crore thresholds, Indian digit grouping, marla/kanal conversion — lives in
 * `@tricity/domain` so the backend, the website, and any future service all format identically.
 * What stays here is presentation-only: relative timestamps, bath counts, days-on-market phrasing.
 *
 * If you are about to add a currency or area rule here, it belongs in @tricity/domain instead.
 */

import {
  Area,
  type AreaUnit,
  formatPriceShort,
  formatPricePerSqft as formatPricePerSqftInr,
  formatRupees,
  formatSqft as formatSqftIn,
  formatMonthly as formatMonthlyInr,
} from "@tricity/domain";

/**
 * "₹1.25 Cr" — the DEFAULT price display everywhere on this site.
 *
 * Not an abbreviation or a fallback: lakh/crore is simply how property prices are spoken and
 * written in this market. Showing "₹1,25,00,000" as the headline figure reads as a foreign site
 * that does not understand its own audience.
 */
export function formatPrice(value: number): string {
  return formatPriceShort(value);
}

/** "₹1,25,00,000" — full precision. For contracts, breakdowns, and anywhere exactness matters. */
export function formatPriceExact(value: number): string {
  return formatRupees(value);
}

/** Map pins and other tight spaces use the same compact form — consistency over cleverness. */
export function formatPriceCompact(value: number): string {
  return formatPriceShort(value);
}

/** "12,50,000" — Indian digit grouping (last three, then pairs). */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

/** "1,700 sq ft" */
export function formatSqft(value: number): string {
  return formatSqftIn(value);
}

/**
 * "10 marla (2,723 sq ft)" — plot and covered area as they are actually quoted here.
 *
 * Replaces the old acre-based US lot-size logic. A tricity plot is described in marla, kanal or
 * gaj; quoting "0.06 acres" would be technically correct and useless to every buyer who reads it.
 */
export function formatArea(value: number, unit: AreaUnit): string {
  return Area.of(value, unit).formatWithSqft();
}

/**
 * Render a stored area using the factor it was written with.
 *
 * Use this for anything coming out of the database — see the `fromStored` rationale in
 * @tricity/domain. Falls back to plain square feet when the input unit was not captured, which is
 * the case for legacy or partner-supplied rows.
 */
export function formatStoredArea(
  sqft: number,
  inputValue?: number | null,
  inputUnit?: AreaUnit | null,
  conversionFactor?: number | null,
): string {
  if (inputValue == null || inputUnit == null || conversionFactor == null) {
    return formatSqftIn(sqft);
  }
  return Area.fromStored(inputValue, inputUnit, sqft, conversionFactor).formatWithSqft();
}

/** "₹6,200/sq ft" — the comparison metric experienced buyers here use most. */
export function formatPricePerSqft(price: number, sqft: number): string {
  return formatPricePerSqftInr(price, sqft);
}

/** "₹25,000/month" — rent and maintenance. */
export function formatMonthly(value: number): string {
  return formatMonthlyInr(Math.round(value));
}

/**
 * "2.5" from 2.5, "2" from 2 — bathrooms use half-counts, and "2.0 baths" looks wrong to
 * anyone in the industry.
 */
export function formatBaths(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

/** "Updated 3 hours ago" — the freshness stamp shown alongside listing data. */
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
  return new Date(isoDate).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}
