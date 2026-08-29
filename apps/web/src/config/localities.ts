/**
 * Locality editorial content — the highest-leverage SEO asset on this site.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE RELATES TO @tricity/geo
 *
 * `@tricity/geo` owns the FACTS about places: which localities exist, their slugs, kinds and
 * coordinates. It is shared with the API so the website and the database can never disagree
 * about whether "Sector 70, Mohali" is a real place.
 *
 * This file owns the EDITORIAL: prose, highlights, FAQs, price bands. It is an OVERLAY, keyed by
 * (citySlug, localitySlug), and it is deliberately sparse.
 *
 * WHY SPARSE: there are 102 seeded localities. Generating a landing page for each from a
 * template produces 102 near-identical thin pages, which Google treats as doorway spam and which
 * would actively damage the domain. Only localities with genuine hand-written content get an
 * indexed page (see `localitiesWithContent`); the rest exist as search filters and map areas.
 * Grow this file deliberately — 10 real pages beat 100 generated ones.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ ALL COPY AND EVERY PRICE BAND BELOW IS UNVERIFIED DRAFT CONTENT.
 *
 * It is written from general knowledge of the tricity and is plausible, not researched. Before
 * launch the agent must review every line, and the `priceRange` figures in particular must be
 * replaced with real numbers from their own transaction history. Publishing invented price data
 * on a property site is both a credibility problem and, under RERA's advertising rules, a
 * compliance risk. Nothing here should go live unread.
 */

import {
  getCity,
  getLocality as getLocalitySeed,
  localityKey,
  type LocalitySeed,
} from "@tricity/geo";

import type { PropertyType } from "@/lib/listings/types";

export interface LocalityContent {
  citySlug: string;
  localitySlug: string;
  /** One-line summary used in cards, meta descriptions, and map popups. */
  tagline: string;
  /** Opening paragraph of the landing page. Specific — roads, landmarks, character. */
  intro: string;
  /** What living there is actually like. The part portals cannot replicate. */
  lifestyle: string;
  /**
   * Typical asking band in rupees. ⚠️ DRAFT — replace with real figures.
   * Wide by design: a sector containing both 5-marla builder floors and 1-kanal kothis genuinely
   * spans an order of magnitude, and pretending otherwise misleads buyers.
   */
  priceRange: { min: number; max: number };
  /** Dominant stock — shapes copy and sample listing generation. */
  housingTypes: PropertyType[];
  /** Rendered as a feature list. Keep concrete: named schools, roads, markets. */
  highlights: string[];
  /**
   * Questions real buyers ask about this area, answered directly.
   * Rendered as an FAQ block with FAQPage schema — Google pulls answers straight from these.
   */
  faqs: { question: string; answer: string }[];
}

/**
 * A locality with both its geography facts and (where written) its editorial content.
 * This is what pages actually render.
 */
export interface Locality extends LocalitySeed {
  cityName: string;
  state: string;
  content?: LocalityContent;
}

const CONTENT: LocalityContent[] = [
  {
    citySlug: "chandigarh",
    localitySlug: "sector-9",
    tagline: "Large kanal kothis on the quiet northern edge",
    intro:
      "Sector 9 sits in Chandigarh's northern belt, where the original plan allocated the largest " +
      "residential plots. Streets are wide and heavily treed, plot sizes run to a kanal and above, " +
      "and the housing stock is predominantly independent kothis rather than floors or flats.",
    lifestyle:
      "This is established, low-density Chandigarh. Turnover is slow — families hold these houses " +
      "for decades — so inventory is thin and comes to market quietly. Proximity to the Sector 17 " +
      "centre and the Capitol Complex end of the city means short drives to almost everything, " +
      "without the traffic of the southern sectors.",
    priceRange: { min: 55_000_000, max: 180_000_000 },
    housingTypes: ["kothi", "plot"],
    highlights: [
      "Predominantly 1-kanal and larger plots",
      "Wide, mature tree-lined streets typical of the northern sectors",
      "Short drive to Sector 17 city centre and the PGI/Panjab University belt",
      "Very low inventory turnover — most sales are off-market or word of mouth",
    ],
    faqs: [
      {
        question: "What size plots are available in Sector 9, Chandigarh?",
        answer:
          "The sector is dominated by 1-kanal (5,445 sq ft) and larger plots, with some 2-kanal " +
          "properties. Smaller 10-marla plots are uncommon here compared with the southern sectors.",
      },
      {
        question: "Can I buy a builder floor in Sector 9?",
        answer:
          "Rarely. The northern sectors are almost entirely independent houses on single plots. " +
          "If you are specifically looking for floors, the sectors in the 40s and above offer far " +
          "more choice.",
      },
    ],
  },
  {
    citySlug: "chandigarh",
    localitySlug: "sector-35",
    tagline: "Central, walkable, and a genuine mix of stock",
    intro:
      "Sector 35 is one of Chandigarh's most liveable central sectors — close enough to Sector 17 " +
      "and Sector 34's commercial belt to walk, with a well-used market of its own. Housing runs " +
      "from 10-marla kothis through builder floors, which is unusual for a sector this central.",
    lifestyle:
      "The draw is convenience without being on top of the commercial core. The sector market " +
      "covers daily needs, schools and clinics are within the sector, and the road grid makes " +
      "getting to Mohali or the airport road straightforward.",
    priceRange: { min: 18_000_000, max: 70_000_000 },
    housingTypes: ["kothi", "builder-floor", "flat"],
    highlights: [
      "Central location with its own established sector market",
      "Mix of 10-marla kothis and independent builder floors",
      "Walking distance to the Sector 34/35 commercial belt",
      "Straightforward access towards Mohali and the airport road",
    ],
    faqs: [
      {
        question: "Is Sector 35 a good area for families in Chandigarh?",
        answer:
          "It is one of the more practical central choices. You get schools, a working sector " +
          "market and green space within walking distance, while staying close to the city's main " +
          "commercial areas.",
      },
      {
        question: "What is the difference between a kothi and a builder floor here?",
        answer:
          "A kothi is the whole independent house on its plot. A builder floor is a single floor " +
          "of that house sold separately, with its own entrance. Floors cost substantially less " +
          "and are the usual entry point into a sector like this.",
      },
    ],
  },
  {
    citySlug: "mohali",
    localitySlug: "phase-7",
    tagline: "Established Mohali with everything already built",
    intro:
      "Phase 7 is part of older, settled Mohali — laid out and occupied long before the GMADA " +
      "sector expansion to the south. Infrastructure is complete, the markets are established, " +
      "and there is no waiting on promised amenities.",
    lifestyle:
      "The appeal here is that nothing is pending. Schools, hospitals, markets and transport are " +
      "already in place and have been for years. It trades newness for certainty, which suits " +
      "buyers who have been burned by under-construction timelines.",
    priceRange: { min: 9_000_000, max: 35_000_000 },
    housingTypes: ["kothi", "builder-floor", "flat"],
    highlights: [
      "Fully developed — no pending infrastructure or promised amenities",
      "Established local markets and schools",
      "Good connectivity to Chandigarh's southern sectors",
      "Mix of independent houses and floors across a range of budgets",
    ],
    faqs: [
      {
        question: "How do Mohali's Phases differ from its Sectors?",
        answer:
          "The Phases (1-11) are older, established Mohali and are fully built out. The Sectors " +
          "(66-91) are the newer GMADA-planned expansion, with more new construction but " +
          "infrastructure still maturing in places. Buyers use both names, so search both.",
      },
      {
        question: "Is Phase 7 well connected to Chandigarh?",
        answer:
          "Yes — it sits close to the Chandigarh boundary, and the southern Chandigarh sectors are " +
          "a short drive. This is one of the reasons the older phases hold their value.",
      },
    ],
  },
  {
    citySlug: "mohali",
    localitySlug: "sector-70",
    tagline: "GMADA-planned sector with newer construction",
    intro:
      "Sector 70 is part of Mohali's planned expansion, laid out by GMADA with wider roads and " +
      "more consistent plot sizing than the older phases. Construction here is substantially " +
      "newer, and a good share of the stock has never been lived in.",
    lifestyle:
      "Suits buyers who want modern layouts and newer building services without moving as far out " +
      "as Kharar. The sector grid makes navigation easy, and the surrounding sectors continue to " +
      "fill in, which supports values but also means ongoing construction nearby.",
    priceRange: { min: 8_000_000, max: 30_000_000 },
    housingTypes: ["kothi", "builder-floor", "plot", "flat"],
    highlights: [
      "GMADA-planned layout with wide internal roads",
      "Newer construction than the Mohali phases",
      "Consistent plot sizing — easier to compare like with like",
      "Ongoing development in adjacent sectors",
    ],
    faqs: [
      {
        question: "Is Sector 70 in Mohali or Chandigarh?",
        answer:
          "Mohali. This matters more than it sounds: Chandigarh, Mohali and Panchkula all number " +
          "their sectors, so always confirm the city. A Chandigarh Sector 70 does not exist — " +
          "Chandigarh's sectors run 1 to 56.",
      },
      {
        question: "Should I expect construction noise in Sector 70?",
        answer:
          "In places, yes. The surrounding GMADA sectors are still filling in. Visit at different " +
          "times of day and check what is planned on adjoining plots before committing.",
      },
    ],
  },
  {
    citySlug: "mohali",
    localitySlug: "sector-82",
    tagline: "Close to the airport road and the IT corridor",
    intro:
      "Sector 82 sits in the belt that has benefited most from the airport road and the growth of " +
      "Mohali's IT and institutional employers. It is newer stock, laid out on the GMADA grid, and " +
      "draws a noticeably younger buyer than the older phases.",
    lifestyle:
      "Practical for anyone whose commute is the airport road or the IT corridor rather than " +
      "central Chandigarh. Amenities are still filling in compared with established Mohali, so " +
      "check what is actually open rather than what is planned.",
    priceRange: { min: 7_000_000, max: 26_000_000 },
    housingTypes: ["flat", "builder-floor", "plot", "kothi"],
    highlights: [
      "Strong access to the airport road",
      "Close to Mohali's IT and institutional employment",
      "Newer apartment and floor stock",
      "Popular with first-time buyers and younger families",
    ],
    faqs: [
      {
        question: "How far is Sector 82 from Chandigarh airport?",
        answer:
          "It is one of the closer residential sectors to the airport road corridor, which is a " +
          "large part of its appeal for frequent travellers and for people working along that route.",
      },
      {
        question: "Are amenities fully developed in Sector 82?",
        answer:
          "Partly. This is a newer sector and some facilities are still arriving. Distinguish " +
          "carefully between amenities that exist today and ones a seller describes as coming.",
      },
    ],
  },
  {
    citySlug: "kharar",
    localitySlug: "sunny-enclave",
    tagline: "The tricity's highest-volume affordable belt",
    intro:
      "Sunny Enclave is the best-known development in Kharar and one of the highest-volume " +
      "residential areas in the wider tricity. It offers plots, floors and flats at price points " +
      "well below Chandigarh and Mohali, which is precisely why so much first-time buying happens " +
      "here.",
    lifestyle:
      "The trade is price against commute and maturity. You get materially more space for the " +
      "money than in Mohali, at the cost of a longer run into Chandigarh and infrastructure that " +
      "is still catching up with how fast the area has grown.",
    priceRange: { min: 3_500_000, max: 15_000_000 },
    housingTypes: ["plot", "builder-floor", "flat", "kothi"],
    highlights: [
      "Among the most affordable entry points in the tricity",
      "High transaction volume — genuinely liquid, unlike thinner markets",
      "Plots, floors and flats all available in the same area",
      "Popular with first-time buyers priced out of Mohali",
    ],
    faqs: [
      {
        question: "Is Kharar a good investment compared with Mohali?",
        answer:
          "It is the volume end of the market: lower entry prices and more stock, but slower " +
          "appreciation than well-located Mohali sectors and a longer commute. Which is better " +
          "depends entirely on whether you are buying to live in or to hold.",
      },
      {
        question: "What should I check before buying in Sunny Enclave?",
        answer:
          "Confirm the project's RERA registration and the approving authority, check that the " +
          "specific plot or unit is covered by it, and verify road and drainage status on the " +
          "actual street rather than the masterplan.",
      },
    ],
  },
  {
    citySlug: "zirakpur",
    localitySlug: "vip-road",
    tagline: "High-density flats with the shortest hop to Chandigarh",
    intro:
      "VIP Road is Zirakpur's main apartment corridor — dense, well-connected, and dominated by " +
      "flats in gated societies rather than independent houses. It sits on the Chandigarh-Ambala " +
      "side, which makes it one of the quickest approaches into the city.",
    lifestyle:
      "Convenient and busy in equal measure. Retail, restaurants and everyday services are all " +
      "along the road, and the flat stock suits buyers who want a society with security and " +
      "amenities rather than a plot to build on. Traffic is the standing complaint.",
    priceRange: { min: 3_000_000, max: 14_000_000 },
    housingTypes: ["flat", "builder-floor"],
    highlights: [
      "Predominantly gated-society apartment stock",
      "Quick access into Chandigarh and towards Panchkula",
      "Dense retail and dining along the corridor",
      "Entry prices well below comparable Chandigarh flats",
    ],
    faqs: [
      {
        question: "Is Zirakpur part of Chandigarh?",
        answer:
          "No. Zirakpur is in Punjab, in SAS Nagar district. That distinction matters beyond " +
          "postal addresses — Punjab RERA applies here, whereas Chandigarh has its own separate " +
          "authority as a Union Territory.",
      },
      {
        question: "What are maintenance charges like in VIP Road societies?",
        answer:
          "They vary widely with the society and its amenities. Ask for the current monthly figure " +
          "in writing along with what it covers, and check whether the sinking fund is healthy " +
          "before committing.",
      },
    ],
  },
  {
    citySlug: "new-chandigarh",
    localitySlug: "mullanpur",
    tagline: "Planned growth on the Shivalik foothills side",
    intro:
      "Mullanpur is the core of New Chandigarh — a planned expansion on the north-west side, " +
      "towards the Shivalik foothills. It is the tricity's principal greenfield residential " +
      "development, with wide arterial roads and large planned projects rather than organic growth.",
    lifestyle:
      "Cleaner air and open outlook towards the hills, at the cost of being early. Much of the " +
      "area is still being built, so buying here is substantially a bet on the masterplan being " +
      "delivered. For buyers with a long horizon that bet has generally paid; for anyone needing " +
      "amenities today it is premature.",
    priceRange: { min: 5_000_000, max: 40_000_000 },
    housingTypes: ["plot", "flat", "villa", "kothi"],
    highlights: [
      "Planned development with wide arterial roads",
      "Outlook towards the Shivalik foothills",
      "Large institutional and healthcare projects in the area",
      "Longer horizon — significant construction still underway",
    ],
    faqs: [
      {
        question: "Is New Chandigarh a good place to buy now?",
        answer:
          "It depends on your timeline. The planning and road infrastructure are genuinely better " +
          "than most of the tricity's organic growth areas, but a lot of the value is still " +
          "prospective. If you need schools, markets and hospitals working on day one, look at " +
          "established Mohali instead.",
      },
      {
        question: "Which RERA authority covers New Chandigarh?",
        answer:
          "Punjab RERA. Despite the name, New Chandigarh is in Punjab, not the Chandigarh Union " +
          "Territory — so projects here register with the Punjab authority.",
      },
    ],
  },
];

const CONTENT_BY_KEY = new Map(
  CONTENT.map((c) => [localityKey(c.citySlug, c.localitySlug), c]),
);

/** Editorial copy for a locality, if any has been written. */
export function getLocalityContent(
  citySlug: string,
  localitySlug: string,
): LocalityContent | undefined {
  return CONTENT_BY_KEY.get(localityKey(citySlug, localitySlug));
}

/**
 * Merge geography facts with editorial content.
 * Returns undefined when the locality does not exist in @tricity/geo at all — never invent one.
 */
export function getLocality(
  citySlug: string,
  localitySlug: string,
): Locality | undefined {
  const seed = getLocalitySeed(citySlug, localitySlug);
  if (!seed) return undefined;

  const city = getCity(citySlug);
  if (!city) return undefined;

  return {
    ...seed,
    cityName: city.name,
    state: city.state,
    content: getLocalityContent(citySlug, localitySlug),
  };
}

/**
 * Localities that have hand-written content and therefore get an indexed landing page.
 *
 * This — not the full 102 — is what `generateStaticParams` and the sitemap should iterate.
 */
export function localitiesWithContent(): Locality[] {
  return CONTENT.map((c) => getLocality(c.citySlug, c.localitySlug)).filter(
    (l): l is Locality => l !== undefined,
  );
}

/** Cities that have at least one locality with editorial content. */
export function citiesWithContent(): string[] {
  return [...new Set(CONTENT.map((c) => c.citySlug))];
}
