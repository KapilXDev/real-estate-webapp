import { getListingProvider } from "@/lib/listings";
import { cn } from "@/lib/cn";
import type { Listing } from "@/lib/listings/types";

/**
 * MLS broker attribution — LEGALLY REQUIRED on every rendered view of an IDX listing.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE:
 *
 * MLS boards require "Courtesy of {listing brokerage}" to appear on *every* display of a listing —
 * search result cards and map thumbnails included, not just the detail page. This is the single
 * most commonly violated IDX rule, because developers naturally attach attribution to the detail
 * page and forget the card grid.
 *
 * The defence here is structural: `ListingCard` renders this component unconditionally, so a card
 * cannot exist without attribution. Do not add a prop to hide it. If a layout is too tight to fit
 * attribution, the layout is wrong.
 *
 * NAR's 2026 handbook overhaul removed the model $15,000 penalty cap, so boards now have wide
 * latitude on enforcement.
 *
 * While `isLiveMlsData` is false (sample data), we correctly do NOT print a real board's
 * disclaimer — claiming MLS provenance over fabricated listings would be its own problem.
 */
export function ListingAttribution({
  listing,
  className,
}: {
  listing: Listing;
  className?: string;
}) {
  const isLive = getListingProvider().isLiveMlsData;

  // Own listings still get attributed — the brokerage holds the listing, not the agent.
  const courtesy = `Courtesy of ${listing.listOfficeName}`;

  return (
    <p className={cn("text-[11px] leading-snug text-sand-500", className)}>
      {isLive ? courtesy : `${courtesy} (sample data)`}
    </p>
  );
}
