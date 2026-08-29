/**
 * Neighborhood definitions — the highest-leverage SEO asset on this site.
 *
 * WHY THIS FILE MATTERS: ~72% of buyer searches name a specific neighborhood, and the big portals
 * rank poorly for those. A solo agent can realistically own "homes for sale in {neighborhood}"
 * where they can never own "homes for sale in {city}". Target is 20+ entries here, growing to 40+.
 *
 * This config drives THREE things at once:
 *   1. The generated /neighborhoods/[slug] landing pages
 *   2. The map's area boundaries and default framing
 *   3. Sample listing generation (see src/lib/listings/mock-provider.ts)
 *
 * So replacing the placeholders below with the realtor's actual market relocates the entire site.
 *
 * TO CUSTOMIZE: replace every entry. Keep `slug` URL-safe and stable (changing it breaks
 * already-indexed URLs). Prose in `intro`/`lifestyle` should be genuinely local and specific —
 * generic filler will not rank and reads as spam to both Google and buyers.
 */

export interface Neighborhood {
  /** URL segment: /neighborhoods/{slug}. Stable once published — changing it loses rankings. */
  slug: string;
  /** Display name. */
  name: string;
  /** One-line summary used in cards, meta descriptions, and map popups. */
  tagline: string;
  /** Opening paragraph of the landing page. Make it specific — streets, landmarks, character. */
  intro: string;
  /** What living there is actually like. The part portals cannot replicate. */
  lifestyle: string;
  /** Map center for this area. */
  center: { lat: number; lng: number };
  /** Rough radius in km, used to frame the map and scatter sample listings. */
  radiusKm: number;
  /** Typical price band, for at-a-glance orientation. Refresh from real market data periodically. */
  priceRange: { min: number; max: number };
  /** Dominant housing stock — shapes both copy and generated sample listings. */
  housingTypes: PropertyType[];
  /** Highlights rendered as a feature list. Keep concrete: named schools, parks, transit. */
  highlights: string[];
  /**
   * Questions real buyers ask about this area, answered directly.
   * Rendered as an FAQ block with FAQPage schema — Google pulls answers straight from these.
   */
  faqs: { question: string; answer: string }[];
}

export type PropertyType =
  | "single-family"
  | "condo"
  | "townhouse"
  | "multi-family"
  | "land";

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  "single-family": "Single Family",
  condo: "Condo",
  townhouse: "Townhouse",
  "multi-family": "Multi-Family",
  land: "Land",
};

/**
 * PLACEHOLDER DATA — awaiting the realtor's actual market area.
 * Coordinates are scattered around the `site.market.center` default so the map and sample
 * listings render sensibly in the meantime.
 */
export const neighborhoods: Neighborhood[] = [
  {
    slug: "washington-park",
    name: "Washington Park",
    tagline: "Historic homes around the city's signature park",
    intro:
      "Washington Park is defined by the 100-acre park at its center and the early-20th-century " +
      "homes that ring it. Tree-lined streets, deep lots, and original detail — leaded glass, " +
      "built-ins, wide front porches — draw buyers who want character over new construction.",
    lifestyle:
      "Weekends revolve around the park: the botanical garden, the carillon concerts in summer, " +
      "and the walking loop that locals treat as the neighborhood's front yard. It skews " +
      "established rather than nightlife-driven, and turnover is low — homes here are held.",
    center: { lat: 39.7935, lng: -89.6712 },
    radiusKm: 1.8,
    priceRange: { min: 285000, max: 675000 },
    housingTypes: ["single-family", "condo"],
    highlights: [
      "Direct access to the 100-acre Washington Park and botanical garden",
      "Predominantly 1910s–1940s housing stock with original detail",
      "Walkable to the Iles Park commercial strip",
      "Low inventory turnover — listings move quickly",
    ],
    faqs: [
      {
        question: "What do homes in Washington Park typically sell for?",
        answer:
          "Most sales land between $285,000 and $675,000, with the wide range driven by lot size " +
          "and how much original detail survives. Fully restored homes facing the park sit at the " +
          "top of that band.",
      },
      {
        question: "Are Washington Park homes older? What should I watch for?",
        answer:
          "Yes — most were built between 1910 and 1940. Budget attention for knob-and-tube wiring, " +
          "original galvanized plumbing, and window restoration. A thorough inspection matters more " +
          "here than in newer areas.",
      },
    ],
  },
  {
    slug: "downtown",
    name: "Downtown",
    tagline: "Loft living, walkable, and the shortest commute in the city",
    intro:
      "Downtown has shifted from strictly commercial to genuinely residential over the past decade, " +
      "with warehouse conversions and new mid-rise condos adding inventory. The draw is " +
      "walkability — restaurants, offices, and transit within a few blocks.",
    lifestyle:
      "Suits buyers who want to walk to work and eat out often. Expect street noise on weekend " +
      "evenings near the entertainment blocks, and check parking arrangements carefully — deeded " +
      "spaces trade at a real premium.",
    center: { lat: 39.7995, lng: -89.6462 },
    radiusKm: 1.2,
    priceRange: { min: 165000, max: 480000 },
    housingTypes: ["condo", "townhouse", "multi-family"],
    highlights: [
      "Warehouse loft conversions with original timber and brick",
      "Highest walk score in the metro",
      "Walk to the business district — commute measured in minutes",
      "Deeded parking available in most newer buildings",
    ],
    faqs: [
      {
        question: "Is parking included with downtown condos?",
        answer:
          "Not always. Newer buildings usually include a deeded space; converted warehouses often " +
          "sell parking separately or lease it monthly. Confirm this before writing an offer — it " +
          "materially affects both cost and resale.",
      },
      {
        question: "What are HOA fees like downtown?",
        answer:
          "Typically $250–$600 per month depending on the building and amenities. Ask what the fee " +
          "covers and request the reserve study — conversions can carry deferred maintenance on " +
          "roofs and elevators.",
      },
    ],
  },
  {
    slug: "west-side",
    name: "West Side",
    tagline: "Newer construction, larger lots, family-oriented",
    intro:
      "The West Side is where most of the city's newer single-family construction has gone. " +
      "Subdivisions from the 1990s onward, larger lots, attached garages, and the modern layouts " +
      "that older parts of town can't offer without a renovation.",
    lifestyle:
      "Car-dependent but easy — wide roads, big-box retail and grocery close by, and quiet " +
      "residential streets. The main trade-off versus the historic neighborhoods is character for " +
      "convenience, and for many buyers with kids that trade is worth making.",
    center: { lat: 39.7723, lng: -89.7048 },
    radiusKm: 2.6,
    priceRange: { min: 245000, max: 590000 },
    housingTypes: ["single-family", "townhouse"],
    highlights: [
      "Newer construction — 1990s through current builds",
      "Larger lots with attached two-car garages",
      "Grocery, retail, and services within a short drive",
      "Modern open layouts without renovation cost",
    ],
    faqs: [
      {
        question: "How does the West Side compare to the historic neighborhoods on price?",
        answer:
          "Price per square foot is often lower, and you get newer systems and a garage. What you " +
          "give up is walkability and architectural character. Buyers usually decide on that " +
          "trade-off rather than on price alone.",
      },
      {
        question: "Are there HOAs on the West Side?",
        answer:
          "Many of the post-2000 subdivisions have one, typically modest and covering common areas " +
          "and entry landscaping. Older 1990s streets frequently have none.",
      },
    ],
  },
];

/** Look up a neighborhood by its URL slug. */
export function getNeighborhood(slug: string): Neighborhood | undefined {
  return neighborhoods.find((n) => n.slug === slug);
}
