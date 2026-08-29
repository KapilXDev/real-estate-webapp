import { getListingProvider } from "@/lib/listings";
import { cn } from "@/lib/cn";
import type { Listing } from "@/lib/listings/types";

/**
 * Listing attribution + RERA registration — REQUIRED on every rendered view of a listing.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE:
 *
 * This component replaced the MLS/IDX broker-attribution block from the original US build. The
 * legal driver changed but the structural requirement did not:
 *
 *   Under the Real Estate (Regulation and Development) Act, a registered agent's RERA
 *   registration number must appear in ALL advertising. A property listing on a website is
 *   advertising. The penalty for an agent runs to ₹10 lakh.
 *
 * The defence is structural, exactly as before: `ListingCard` renders this component
 * unconditionally, so a card cannot exist without attribution. Do not add a prop to hide it. If a
 * layout is too tight to fit attribution, the layout is wrong.
 *
 * ⚠️ TWO JURISDICTIONS. Chandigarh is a Union Territory with its own authority; Mohali, Kharar,
 * Zirakpur and New Chandigarh fall under Punjab RERA. The registration shown is the one that
 * applies to the property's own state, carried on the listing — not a single site-wide number.
 *
 * While the provider is not serving live data, we label listings as sample data rather than
 * printing a registration over fabricated inventory, which would be its own advertising problem.
 */
export function ListingAttribution({
  listing,
  className,
}: {
  listing: Listing;
  className?: string;
}) {
  const isLive = getListingProvider().isLiveData;

  // Own listings still get attributed — the firm holds the listing, not the individual agent.
  const courtesy = `Listed by ${listing.listedByFirm}`;

  if (!isLive) {
    return (
      <p className={cn("text-[11px] leading-snug text-sand-500", className)}>
        {courtesy} (sample data)
      </p>
    );
  }

  return (
    <p className={cn("text-[11px] leading-snug text-sand-500", className)}>
      {courtesy}
      <span className="block">RERA Reg. {listing.reraAgentRegistration}</span>
      {listing.reraProjectRegistration && (
        <span className="block">
          Project RERA {listing.reraProjectRegistration}
        </span>
      )}
    </p>
  );
}
