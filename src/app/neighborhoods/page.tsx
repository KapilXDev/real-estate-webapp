import type { Metadata } from "next";
import Link from "next/link";

import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { formatPrice, formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";

/**
 * Neighborhood index — the hub of the site's hyperlocal SEO structure.
 *
 * Structure follows the layered model that works for agent sites: this page is the city-level
 * hub, and each linked guide is a neighborhood-level page. Internal links from here (plus the
 * footer) are how Google discovers and weights the individual guides.
 *
 * Target is 20+ guides growing to 40+. Competing for city-level terms against the portals is a
 * losing game; neighborhood-level terms are winnable and carry higher buyer intent.
 */

export const metadata: Metadata = {
  title: `${site.market.city} Neighborhood Guides`,
  description: `Detailed guides to every neighborhood in ${site.market.city}, ${site.market.stateFull} — prices, character, schools, and what it's actually like to live there.`,
};

export default async function NeighborhoodsPage() {
  const provider = getListingProvider();

  // Live inventory counts make the index useful rather than just a directory.
  const stats = await Promise.all(
    neighborhoods.map(async (n) => ({
      neighborhood: n,
      stats: await provider.getMarketStats(n.slug),
    })),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          {site.market.city} neighborhood guides
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Listing photos tell you about a house. They tell you nothing about the street, the
          commute, or whether the basement floods. These guides cover the parts that decide
          whether you&rsquo;ll actually be happy there.
        </p>
      </header>

      <div className="mt-12 grid gap-8 md:grid-cols-2">
        {stats.map(({ neighborhood, stats: marketStats }) => (
          <article
            key={neighborhood.slug}
            className="flex flex-col rounded-card border border-sand-200 bg-white p-6 transition-shadow hover:shadow-md"
          >
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              <Link
                href={`/neighborhoods/${neighborhood.slug}`}
                className="hover:text-brand-700"
              >
                {neighborhood.name}
              </Link>
            </h2>
            <p className="mt-1 text-sm font-medium text-sand-600">{neighborhood.tagline}</p>
            <p className="mt-4 leading-relaxed text-sand-700">{neighborhood.intro}</p>

            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-sand-100 pt-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-sand-500">For sale</dt>
                <dd className="mt-0.5 font-semibold text-sand-900">
                  {marketStats?.activeCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-sand-500">Median</dt>
                <dd className="mt-0.5 font-semibold text-sand-900">
                  {marketStats?.medianListPrice
                    ? formatPriceCompact(marketStats.medianListPrice)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-sand-500">Typical range</dt>
                <dd className="mt-0.5 font-semibold text-sand-900">
                  {formatPriceCompact(neighborhood.priceRange.min)}–
                  {formatPriceCompact(neighborhood.priceRange.max)}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/neighborhoods/${neighborhood.slug}`}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                Read the guide →
              </Link>
              <Link
                href={`/search?area=${neighborhood.slug}`}
                className="text-sm font-medium text-sand-700 hover:text-brand-700"
              >
                See homes for sale
              </Link>
            </div>
          </article>
        ))}
      </div>

      {/* Honest placeholder rather than pretending the coverage is complete. */}
      <section className="mt-16 rounded-card border border-sand-200 bg-sand-100 p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          Looking at an area not listed here?
        </h2>
        <p className="mx-auto mt-2 max-w-xl leading-relaxed text-sand-700">
          More guides are on the way. In the meantime, ask me directly — I&rsquo;ll tell you what
          I know about any street in {site.market.city}, including the things that don&rsquo;t go
          in writing.
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-block rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Ask about a neighborhood
        </Link>
      </section>
    </div>
  );
}
