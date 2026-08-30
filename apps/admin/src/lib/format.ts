import { formatPriceShort } from "@tricity/domain";

/**
 * ⚠️ Money is rendered through `formatPriceShort` from @tricity/domain — never with
 * `toLocaleString` and never hand-rolled.
 *
 * Indian digit grouping is 85,00,000 rather than 8,500,000, and the unit that people actually
 * read is lakh/crore. A price shown as "₹14,500,000" is not merely styled differently, it is
 * harder for the agent to check at a glance — and the whole reason the domain package exists is
 * that this must be identical on the public site and here.
 */
export const money = (rupees: number): string => formatPriceShort(rupees);

/** "3 days ago" — relative time is what matters on a queue, not a calendar date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
