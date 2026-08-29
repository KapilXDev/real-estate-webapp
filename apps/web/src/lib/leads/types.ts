/**
 * Lead domain model.
 *
 * A lead is not just a contact form submission — it carries the behavioural context that makes
 * follow-up effective. Knowing someone enquired about a specific $540k 4-bed in Washington Park
 * is worth far more than knowing "someone filled in the contact form", and it's the difference
 * between a generic drip email and a relevant one.
 */

export type LeadType =
  /** Showing request from a listing detail page. Highest intent on the site. */
  | "tour-request"
  /** Seller valuation request. Highest value per lead. */
  | "home-valuation"
  /** General contact form. */
  | "contact"
  /** Saved-search signup. Lower immediate intent, but the best long-term nurture list. */
  | "saved-search";

export interface Lead {
  id: string;
  type: LeadType;
  createdAt: string;

  name: string;
  email: string;
  phone?: string;
  message?: string;

  /** Property context, when the lead originated from a specific listing. */
  listingKey?: string;
  listingAddress?: string;
  listingPrice?: number;
  preferredDate?: string;

  /** Seller context, for valuation requests. */
  propertyAddress?: string;
  timeframe?: string;

  /**
   * Where the lead came from. Preserved so marketing spend can be attributed rather than
   * guessed at.
   */
  source?: {
    page?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  };

  /**
   * Priority score, 0-100. Drives follow-up ordering — a solo agent cannot treat every lead
   * identically, so the ranking has to be explicit rather than left to whoever checks email first.
   */
  score: number;

  status: "new" | "contacted" | "qualified" | "archived";
}

export type LeadInput = Omit<Lead, "id" | "createdAt" | "score" | "status">;
