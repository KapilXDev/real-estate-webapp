import type { Metadata } from "next";
import Link from "next/link";

import { ListingCard } from "@/components/listings/ListingCard";
import { site } from "@/config/site";
import { getListingProvider } from "@/lib/listings";

/**
 * The agent's own listings and sold history.
 *
 * This is the credibility page. Buyers and — more importantly — prospective sellers come here to
 * answer one question: "does this person actually sell houses?" Sold listings answer it better
 * than any testimonial, which is why they get equal billing rather than being hidden away.
 */

export const metadata: Metadata = {
  title: `Our Listings in the ${site.market.name}`,
  description: `Current listings and recent sales from ${site.agent.name}, ${site.agent.title}, across Chandigarh, Mohali and Kharar.`,
};

export default async function ListingsPage() {
  const all = await getListingProvider().getOwnListings({ includeSold: true });

  const active = all.filter((l) => l.status !== "Sold");
  const sold = all.filter((l) => l.status === "Sold");

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          Our listings
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Property currently represented by {site.agent.name}, plus recent sales across the
          tricity.
        </p>
      </header>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          Currently for sale
        </h2>
        {active.length > 0 ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((listing, index) => (
              <ListingCard key={listing.listingKey} listing={listing} priority={index < 3} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-card border border-dashed border-sand-300 bg-white px-6 py-12 text-center">
            <p className="text-sand-700">
              No active listings right now — which usually means the last few sold quickly.
            </p>
            <Link
              href="/search"
              className="mt-4 inline-block rounded-md bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Browse all tricity property
            </Link>
          </div>
        )}
      </section>

      {sold.length > 0 && (
        <section className="mt-16 border-t border-sand-200 pt-10">
          <h2 className="font-display text-2xl font-semibold text-sand-950">Recently sold</h2>
          <p className="mt-2 max-w-2xl text-sand-700">
            Completed transactions — the clearest evidence of what I can do for you.
          </p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {sold.map((listing) => (
              <ListingCard key={listing.listingKey} listing={listing} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-16 rounded-card bg-brand-800 p-8 text-center sm:p-12">
        <h2 className="font-display text-3xl font-semibold text-white">
          Thinking about listing yours?
        </h2>
        <p className="mx-auto mt-3 max-w-xl leading-relaxed text-brand-100">
          Start with what it&rsquo;s worth. No obligation, and no automated guess.
        </p>
        <Link
          href="/home-value"
          className="mt-6 inline-block rounded-md bg-white px-8 py-3.5 text-base font-semibold text-brand-800 hover:bg-brand-50"
        >
          Get my property&rsquo;s value
        </Link>
      </section>
    </div>
  );
}
