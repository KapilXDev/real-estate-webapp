import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/cn";
import {
  formatBaths,
  formatDaysOnMarket,
  formatPrice,
  formatSqft,
} from "@/lib/format";
import type { Listing } from "@/lib/listings/types";
import { ListingAttribution } from "./ListingAttribution";
import { StatusBadge } from "./StatusBadge";

/**
 * The listing card. Used in search results, neighborhood pages, and the agent's own listings —
 * one component so presentation and compliance stay consistent everywhere.
 *
 * Information hierarchy is deliberate and follows how buyers actually scan:
 *   photo -> price -> beds/baths/sqft -> address -> everything else
 * Price is the anchor, so it is the largest text after the photo. Address is secondary because
 * buyers filter on price and size first and only then check where it is.
 *
 * Attribution is rendered unconditionally — see ListingAttribution for why that is not optional.
 */
export function ListingCard({
  listing,
  priority = false,
  className,
}: {
  listing: Listing;
  /** Set on above-the-fold cards so Next preloads the image — protects LCP. */
  priority?: boolean;
  className?: string;
}) {
  const hero = listing.media[0];
  const isSold = listing.status === "Closed";
  const displayPrice = isSold && listing.closePrice ? listing.closePrice : listing.listPrice;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border border-sand-200 bg-white",
        "transition-shadow duration-200 hover:shadow-lg focus-within:shadow-lg",
        className,
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-sand-100">
        {hero ? (
          <Image
            src={hero.url}
            alt={hero.caption}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            priority={priority}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-sand-500">
            No photo available
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <StatusBadge status={listing.status} />
          {listing.isOwnListing && (
            /* The agent's own listings are the credibility proof — flag them clearly. */
            <span className="inline-flex items-center rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              Our Listing
            </span>
          )}
        </div>

        {listing.daysOnMarket <= 3 && listing.status === "Active" && (
          <span className="absolute right-3 top-3 rounded-full bg-clay-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            New
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-semibold text-sand-950">
            {formatPrice(displayPrice)}
          </p>
          {isSold && (
            <span className="text-xs font-medium uppercase tracking-wide text-sand-500">
              Sold
            </span>
          )}
        </div>

        {/* Separators are decorative, so they're hidden from screen readers. */}
        <p className="text-sm font-medium text-sand-800">
          {listing.bedroomsTotal} bd
          <span aria-hidden="true" className="mx-1.5 text-sand-300">
            ·
          </span>
          {formatBaths(listing.bathroomsTotal)} ba
          <span aria-hidden="true" className="mx-1.5 text-sand-300">
            ·
          </span>
          {formatSqft(listing.livingArea)}
        </p>

        <p className="text-sm text-sand-600">{listing.address.unparsed}</p>

        <p className="mt-auto pt-2 text-xs text-sand-500">
          {formatDaysOnMarket(listing.daysOnMarket)}
        </p>

        <ListingAttribution listing={listing} className="border-t border-sand-100 pt-2" />
      </div>

      {/*
       * Stretched link: the whole card is clickable, but only one link exists in the
       * accessibility tree — avoids the "same link three times" screen-reader problem you get
       * from wrapping photo, price, and address separately.
       */}
      <Link
        href={`/listings/${listing.listingKey}`}
        className="absolute inset-0 z-10"
        aria-label={`View ${listing.address.unparsed} — ${formatPrice(displayPrice)}`}
      >
        <span className="sr-only">View listing details</span>
      </Link>
    </article>
  );
}
