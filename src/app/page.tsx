import Link from "next/link";

import { ListingCard } from "@/components/listings/ListingCard";
import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";
import type { Listing } from "@/lib/listings/types";

/**
 * Home page.
 *
 * Structured around the realtor's stated 70/30 buyer/seller split, and around what the research
 * says actually converts:
 *   1. Hero search  — property search is the reason anyone visits or returns
 *   2. New listings — gives repeat visitors a reason to come back
 *   3. Neighborhoods— the hyperlocal SEO surface (~72% of buyer searches name a neighborhood)
 *   4. Valuation CTA— the seller funnel; 5-15% conversion vs ~1% for standard pages
 *   5. Agent proof  — trust signals last, once intent is established
 *
 * Server-rendered throughout so it is fast and fully crawlable.
 */
export default async function HomePage() {
  const provider = getListingProvider();

  const [{ listings: newest }, ownListings] = await Promise.all([
    provider.search({ sort: "newest", pageSize: 6, status: ["Active", "Coming Soon"] }),
    provider.getOwnListings(),
  ]);

  return (
    <>
      <HeroSearch />
      <NewListings listings={newest} />
      <NeighborhoodGrid />
      <ValuationCta />
      <AgentIntro ownListingCount={ownListings.length} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function HeroSearch() {
  return (
    <section className="relative overflow-hidden bg-brand-900">
      {/* Subtle depth without an image dependency — swap for a hero photo of the market later. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-brand-700),transparent_60%)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-300">
            {site.market.city}, {site.market.state}
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            Find the right home in the right neighborhood.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-brand-100">
            Search every active listing in {site.market.city} — with the local context that
            listing sites leave out.
          </p>

          {/*
           * Plain GET form so search works without JavaScript and produces a shareable,
           * crawlable URL. The rich filter UI on /search enhances this rather than replacing it.
           */}
          <form
            action="/search"
            method="get"
            className="mt-8 flex flex-col gap-3 sm:flex-row"
            role="search"
          >
            <label htmlFor="hero-search" className="sr-only">
              Search by address, neighborhood, or MLS number
            </label>
            <input
              id="hero-search"
              name="q"
              type="search"
              placeholder="Address, neighborhood, or MLS number"
              className="w-full rounded-md border-0 bg-white/95 px-4 py-3.5 text-base text-sand-950 placeholder:text-sand-500 focus:bg-white sm:flex-1"
            />
            <button
              type="submit"
              className="rounded-md bg-clay-600 px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-clay-700"
            >
              Search
            </button>
          </form>

          <p className="mt-4 text-sm text-brand-200">
            Or{" "}
            <Link href="/search?view=map" className="font-medium text-white underline underline-offset-4">
              draw your own search area on the map
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function NewListings({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-semibold text-sand-950">
            Just listed
          </h2>
          <p className="mt-2 text-sand-600">
            The newest homes on the market in {site.market.city}.
          </p>
        </div>
        <Link
          href="/search?sort=newest"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          View all listings →
        </Link>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing, index) => (
          <ListingCard
            key={listing.listingKey}
            listing={listing}
            /* First row is above the fold on most viewports — preload for LCP. */
            priority={index < 3}
          />
        ))}
      </div>
    </section>
  );
}

function NeighborhoodGrid() {
  return (
    <section className="border-y border-sand-200 bg-sand-100">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold text-sand-950">
            Know the neighborhood before you tour
          </h2>
          <p className="mt-3 leading-relaxed text-sand-700">
            Every area has its own character, price bracket, and quirks. These guides cover what
            the listing photos can&rsquo;t — written from working these streets, not scraped.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {neighborhoods.map((n) => (
            <Link
              key={n.slug}
              href={`/neighborhoods/${n.slug}`}
              className="group flex flex-col rounded-card border border-sand-200 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <h3 className="font-display text-xl font-semibold text-sand-950 group-hover:text-brand-700">
                {n.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-sand-600">{n.tagline}</p>
              <p className="mt-4 pt-4 text-sm font-medium text-sand-800 border-t border-sand-100">
                {formatPriceCompact(n.priceRange.min)} – {formatPriceCompact(n.priceRange.max)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ValuationCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-2xl bg-brand-800">
        <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">
              Thinking of selling?
            </h2>
            <p className="mt-4 leading-relaxed text-brand-100">
              Automated estimates miss the things that actually move your price — the condition of
              your kitchen, what the house two doors down really sold for, how fast this street is
              moving right now. Get a real valuation from someone who has walked these homes.
            </p>
          </div>
          <div className="lg:justify-self-end">
            <Link
              href="/home-value"
              className="inline-block rounded-md bg-white px-8 py-4 text-base font-semibold text-brand-800 transition-colors hover:bg-brand-50"
            >
              Get my home&rsquo;s value
            </Link>
            <p className="mt-3 text-sm text-brand-200">
              Free, no obligation, and no automated guess.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentIntro({ ownListingCount }: { ownListingCount: number }) {
  return (
    <section className="border-t border-sand-200 bg-sand-100">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="font-display text-3xl font-semibold text-sand-950">
              Work with {site.agent.name}
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-sand-700">{site.agent.bio}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
              >
                Get in touch
              </Link>
              <Link
                href="/about"
                className="rounded-md border border-sand-300 bg-white px-6 py-3 text-sm font-semibold text-sand-800 transition-colors hover:border-sand-400"
              >
                More about me
              </Link>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-6 self-start lg:grid-cols-1">
            <div className="rounded-card border border-sand-200 bg-white p-5">
              <dt className="text-sm text-sand-600">Active listings</dt>
              <dd className="mt-1 font-display text-3xl font-semibold text-brand-800">
                {ownListingCount}
              </dd>
            </div>
            <div className="rounded-card border border-sand-200 bg-white p-5">
              <dt className="text-sm text-sand-600">Neighborhood guides</dt>
              <dd className="mt-1 font-display text-3xl font-semibold text-brand-800">
                {neighborhoods.length}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
