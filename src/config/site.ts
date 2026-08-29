/**
 * Single source of truth for agent, brokerage, and compliance details.
 *
 * Everything here is placeholder until the realtor provides real details. Nothing in the app
 * should hardcode an agent name, phone number, or license number — read it from here so one edit
 * updates the whole site.
 */

export const site = {
  /** Agent identity. */
  agent: {
    name: "Your Name",
    title: "REALTOR®",
    /** State license number. Legally required in most jurisdictions on marketing material. */
    licenseNumber: "DRE #00000000",
    phone: "(555) 555-0100",
    email: "hello@example.com",
    /** Drop a headshot at /public/agent/headshot.jpg to replace the placeholder. */
    headshot: "/agent/headshot.jpg",
    tagline: "Helping buyers find the right home in the right neighborhood.",
    bio: "Placeholder bio. Replace with the agent's real story — years in the market, " +
      "neighborhoods served, and what makes working with them different.",
  },

  /** Brokerage the agent hangs their license with. */
  brokerage: {
    name: "Your Brokerage",
    address: "123 Main Street, Suite 100",
    licenseNumber: "DRE #00000001",
  },

  /** Market the agent serves. Drives copy, schema.org markup, and map default view. */
  market: {
    city: "Springfield",
    state: "IL",
    stateFull: "Illinois",
    /** Map centers here on first load. */
    center: { lat: 39.7817, lng: -89.6501 },
    defaultZoom: 12,
  },

  social: {
    instagram: "",
    facebook: "",
    linkedin: "",
    youtube: "",
  },

  /**
   * MLS / IDX compliance strings.
   *
   * IMPORTANT: these are placeholders. Every MLS board mandates its own *verbatim* disclaimer
   * text — copy the exact wording from the board's IDX rules once the feed is approved. Do not
   * paraphrase; boards enforce this literally.
   */
  compliance: {
    /** The board's required disclaimer, word for word. */
    mlsDisclaimer:
      "Listing information is deemed reliable but is not guaranteed accurate by the MLS. " +
      "Information is provided exclusively for consumers' personal, non-commercial use and may " +
      "not be used for any purpose other than to identify prospective properties consumers may " +
      "be interested in purchasing.",
    /** Copyright line, typically "© {year} {Board Name}. All rights reserved." */
    mlsCopyright: "© {year} [MLS Board Name]. All rights reserved.",
    /** Name of the MLS board supplying the feed. */
    mlsName: "[MLS Board Name]",
    /** Fair housing notice is required on real estate marketing sites in the US. */
    equalHousing: true,
  },
} as const;

export type Site = typeof site;
