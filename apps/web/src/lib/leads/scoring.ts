import type { LeadInput } from "./types";

/**
 * Lead scoring, 0-100.
 *
 * WHY: a solo agent cannot give every enquiry equal attention, and "whatever is at the top of the
 * inbox" is a bad prioritisation rule. This makes the ranking explicit and tunable.
 *
 * The weights below are a defensible starting point drawn from how these lead types generally
 * behave — they are NOT empirically fitted to this agent's business. Revisit them once there is
 * real closed-deal data to check them against; treat the current numbers as a hypothesis.
 */

const TYPE_SCORES: Record<LeadInput["type"], number> = {
  /** Someone asking to physically visit a specific house is as close to buying as it gets. */
  "tour-request": 45,
  /** Sellers are worth more per transaction and the funnel is shorter. */
  "home-valuation": 40,
  contact: 25,
  /** Genuine interest, but usually early in a months-long search. */
  "saved-search": 15,
};

export function scoreLead(input: LeadInput): number {
  let score = TYPE_SCORES[input.type];

  /*
   * Phone number is the strongest single signal in the form itself. It is optional on every form,
   * so supplying one is a deliberate act — and it enables the fast text-back that drives most of
   * the conversion lift.
   */
  if (input.phone && input.phone.replace(/\D/g, "").length >= 10) score += 20;

  // A written message means they engaged rather than reflexively submitting a prefilled form.
  if (input.message && input.message.trim().length > 40) score += 10;

  // Naming a specific property or date means the search is concrete, not exploratory.
  if (input.listingKey) score += 10;
  if (input.preferredDate) score += 10;
  if (input.propertyAddress) score += 10;

  // Near-term sellers should be called today, not put in a nurture sequence.
  if (input.timeframe && /immediately|1-3 months|asap/i.test(input.timeframe)) score += 15;

  // Paid traffic costs money to acquire — surface it so the spend isn't wasted on slow follow-up.
  if (input.source?.utmMedium && /cpc|paid/i.test(input.source.utmMedium)) score += 5;

  return Math.min(100, score);
}

/** Bucket for UI display. Thresholds chosen so "hot" stays a small, actionable set. */
export function scoreLabel(score: number): "hot" | "warm" | "cool" {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cool";
}
