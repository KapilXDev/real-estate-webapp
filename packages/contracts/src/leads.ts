/**
 * Lead intake wire contract.
 *
 * Every form on the website ends up here. A lead is the revenue event of this whole product, so
 * the shape carries behavioural context rather than just contact details — knowing someone
 * enquired about a specific ₹1.4 Cr kothi in Mohali Phase 7 is worth far more than knowing
 * "someone filled in the contact form", and it is the difference between a generic follow-up and
 * a relevant one.
 */

export type LeadKindDto = "tour-request" | "home-valuation" | "contact" | "saved-search";

export type LeadChannelDto = "web" | "whatsapp" | "call" | "walk-in" | "referral";

/**
 * Marketing attribution, preserved so spend can be attributed rather than guessed at.
 *
 * Captured at submit time because the referrer and UTM parameters are gone by the time anyone
 * looks at the lead.
 */
export interface LeadSourceDto {
  page?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface CreateLeadRequestDto {
  kind: LeadKindDto;

  name: string;
  email: string;
  /**
   * ⚠️ Optional in the type, but it is the field that actually matters here.
   *
   * WhatsApp is the dominant lead channel in this market, not email. A lead with a phone number
   * can be answered in ninety seconds; a lead with only an email often cannot be answered at all.
   * Forms should nudge for it hard while still accepting a submission without it — a lead
   * rejected over a missing optional field is simply a lost customer.
   */
  phone?: string;
  message?: string;

  /** Consent, captured explicitly at the point of collection. Never assumed. */
  whatsappOptIn?: boolean;

  /** Property context, when the lead came from a specific listing. */
  listingKey?: string;
  preferredDate?: string;

  /** Seller context, for valuation requests. */
  propertyAddress?: string;
  timeframe?: string;

  /** Buyer requirement, for saved searches and general enquiries. */
  requirement?: {
    citySlug?: string;
    localitySlug?: string;
    propertyType?: string;
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
  };

  source?: LeadSourceDto;
}

/**
 * ⚠️ Deliberately thin.
 *
 * The response to an unauthenticated public form tells the submitter their message was received
 * and nothing else. It does NOT echo the priority score, the assigned agent, or anything about
 * the organisation — that is internal sales intelligence, and putting it in a public response
 * hands a competitor a free look at how leads are triaged.
 */
export interface CreateLeadResponseDto {
  id: string;
  /** Always true on a 201. Present so the client has something unambiguous to branch on. */
  received: true;
}
