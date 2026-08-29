/**
 * Single source of truth for agent, firm, and compliance details.
 *
 * Everything here is placeholder until the agent provides real details. Nothing in the app should
 * hardcode a name, phone number, or registration number — read it from here so one edit updates
 * the whole site.
 *
 * ⚠️ THE RERA FIELDS ARE NOT DECORATIVE. Under the Real Estate (Regulation and Development) Act,
 * a registered agent's registration number must appear in ALL advertising, and a website is
 * advertising. Penalties run to ₹10 lakh. The footer and every listing card render these
 * unconditionally — see ListingAttribution and SiteFooter.
 */

export const site = {
  /** Agent identity. */
  agent: {
    name: "Your Name",
    title: "Property Consultant",
    phone: "+91 98765 43210",
    /**
     * WhatsApp number in international format without '+' or spaces, for wa.me links.
     *
     * WhatsApp — not email — is the dominant lead channel in this market. Treat it as the primary
     * contact route, not a secondary nicety.
     */
    whatsapp: "919876543210",
    email: "hello@example.com",
    /** Drop a headshot at /public/agent/headshot.jpg to replace the placeholder. */
    headshot: "/agent/headshot.jpg",
    tagline: "Helping buyers find the right property across Chandigarh, Mohali and Kharar.",
    bio:
      "Placeholder bio. Replace with the agent's real story — years in the tricity market, " +
      "the sectors and phases they know best, and what makes working with them different.",
  },

  /** The firm the agent operates through. */
  firm: {
    name: "Your Firm",
    address: "SCO 000, Sector 00, Chandigarh",
  },

  /**
   * RERA registration.
   *
   * ⚠️ TWO JURISDICTIONS. An agent working the tricity spans them:
   *   - Punjab RERA  — covers Mohali, Kharar, Zirakpur and New Chandigarh
   *   - Chandigarh   — a Union Territory with its OWN separate authority
   * A single registration does not cover both. Haryana (Panchkula) is a third if the agent
   * works there. `byState` is keyed on the `state` field from @tricity/geo so the correct
   * number can be surfaced against the correct listing.
   */
  rera: {
    byState: {
      Punjab: {
        authority: "Punjab Real Estate Regulatory Authority",
        shortName: "PbRERA",
        registration: "PBRERA-XXXXXX-XXXX",
        website: "https://rera.punjab.gov.in",
      },
      Chandigarh: {
        authority: "Real Estate Regulatory Authority, UT Chandigarh",
        shortName: "Chandigarh RERA",
        registration: "CHDRERA-XXXXXX-XXXX",
        website: "https://rera.chd.gov.in",
      },
      Haryana: {
        authority: "Haryana Real Estate Regulatory Authority, Panchkula",
        shortName: "HRERA Panchkula",
        registration: "HRERA-PKL-XXXXXX",
        website: "https://haryanarera.gov.in",
      },
    },
    /** Shown where no single jurisdiction applies — the footer, the about page. */
    defaultState: "Punjab" as const,
  },

  /** Market served. Drives copy, schema.org markup, and the map's default view. */
  market: {
    /** Display name for the region as a whole. */
    name: "Chandigarh Tricity",
    /** Cities covered, as @tricity/geo slugs. Order drives nav and hub-page ordering. */
    citySlugs: ["chandigarh", "mohali", "kharar", "zirakpur", "new-chandigarh", "panchkula"],
    /** Map centres here on first load — roughly the centroid of the tricity. */
    center: { lat: 30.7194, lng: 76.7411 },
    defaultZoom: 11,
    currency: "INR",
    locale: "en-IN",
  },

  social: {
    instagram: "",
    facebook: "",
    linkedin: "",
    youtube: "",
  },

  /**
   * Compliance strings.
   *
   * Replaces the US MLS/IDX/Fair-Housing block from the original build. There is no MLS in India,
   * so there is no board disclaimer and no IDX copyright line. What RERA requires instead is the
   * agent's registration number in advertising, and honesty about what the listing data is.
   */
  compliance: {
    /**
     * Shown wherever listing data appears. Deliberately plain: unlike an MLS disclaimer this is
     * not prescribed verbatim by a board, so it should say something true rather than mimic
     * American legalese.
     */
    dataDisclaimer:
      "Listing details are provided by the seller or listing partner and are believed accurate " +
      "but are not independently verified. Areas, prices and approvals should be confirmed " +
      "directly and independently before any commitment.",
    /** Rendered as "© {year} {firm}. All rights reserved." */
    copyrightHolder: "Your Firm",
    /**
     * Set true ONLY when real inventory is being served. While false, robots.ts blocks indexing
     * and ListingAttribution suppresses claims about data provenance — a sample-data build must
     * never present itself as a real property portal.
     */
    isLiveData: false,
  },
} as const;

export type Site = typeof site;

/** The RERA jurisdiction that applies to a given state, as returned by @tricity/geo. */
export function reraForState(state: string) {
  const byState = site.rera.byState as Record<
    string,
    { authority: string; shortName: string; registration: string; website: string } | undefined
  >;
  return byState[state] ?? byState[site.rera.defaultState]!;
}
