import { Injectable } from "@nestjs/common";
import type { CreateLeadRequestDto } from "@tricity/contracts";

/**
 * Lead priority, 0-100.
 *
 * WHY SCORE AT ALL: a solo agent cannot treat every lead identically, and the alternative to an
 * explicit ranking is an implicit one — whoever's message happens to be at the top of the inbox.
 * Making it explicit at least makes it arguable.
 *
 * ⚠️⚠️ THESE WEIGHTS ARE A HYPOTHESIS, NOT A MODEL. Nothing here is fitted to data, because there
 * is no closed-deal data yet. They encode reasonable priors about the Indian market and they are
 * certainly wrong in their particulars. Revisit them once there are ~50 closed leads to check
 * against, and treat any confident claim about their accuracy before then with suspicion.
 *
 * Kept as a separate service rather than a helper inside LeadService precisely so it can be
 * swapped for something fitted later without touching intake.
 */
@Injectable()
export class LeadScoringService {
  score(input: CreateLeadRequestDto): number {
    let score = 0;

    /*
     * Intent by lead kind. A tour request is someone asking to stand inside a specific property —
     * the highest-intent action available on the site. A saved search is a person who may buy in
     * eighteen months.
     */
    switch (input.kind) {
      case "tour-request":
        score += 40;
        break;
      case "home-valuation":
        // Highest VALUE rather than highest intent: a seller lead is a listing, and a listing is
        // worth more to the business than a buyer enquiry.
        score += 35;
        break;
      case "contact":
        score += 20;
        break;
      case "saved-search":
        score += 10;
        break;
    }

    /*
     * ⚠️ A PHONE NUMBER IS THE SINGLE STRONGEST SIGNAL HERE, and it is worth more than any
     * property attribute. WhatsApp is the dominant channel in this market: a lead with a number
     * can be answered in ninety seconds, and a lead without one often cannot be answered at all.
     * Weighted accordingly — this is not a generic "completeness" bonus.
     */
    if (input.phone) score += 25;
    if (input.whatsappOptIn) score += 10;

    // A specific property beats a general enquiry: the person has already self-selected.
    if (input.listingKey) score += 10;
    // Asking for a date is the closest thing to a commitment a web form can capture.
    if (input.preferredDate) score += 8;

    // Someone who wrote a real sentence is not a bot and is not idly browsing. Length is a crude
    // proxy, so it is capped low — a long message is not proportionally better than a short one.
    if (input.message && input.message.trim().length > 40) score += 5;

    // A stated budget means they have thought about affordability, which is most of the way to
    // being qualified.
    if (input.requirement?.maxPrice) score += 7;

    return Math.max(0, Math.min(100, score));
  }
}
