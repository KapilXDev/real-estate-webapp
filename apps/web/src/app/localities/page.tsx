import type { Metadata } from "next";
import Link from "next/link";

import { getCity } from "@tricity/geo";

import { localitiesWithContent } from "@/config/localities";
import { site } from "@/config/site";
import { formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";

/**
 * Area index — the hub of the site's hyperlocal SEO structure.
 *
 * Structure follows the layered model that works for agent sites: this page is the region-level
 * hub, grouped by city, and each linked guide is a locality-level page. Internal links from here
 * (plus the footer) are how Google discovers and weights the individual guides.
 *
 * ⚠️ ONLY LOCALITIES WITH HAND-WRITTEN CONTENT APPEAR HERE. There are 102 seeded localities; a
 * templated page for each would be 102 near-identical thin pages, which reads as doorway spam and
 * would damage the domain rather than help it. Grow the content set in src/config/localities.ts
 * deliberately — the target is 20+ real guides, not 102 generated ones.
 */

export const metadata: Metadata = {
  title: `${site.market.name} Area Guides`,
  description:
    `Guides to the sectors, phases and colonies of ${site.market.name} — prices, character, ` +
    `and what it's actually like to live there.`,
};

export default async function LocalitiesPage() {
  const provider = getListingProvider();
  const localities = localitiesWithContent();

  // Live inventory counts make the index useful rather than just a directory.
  const withStats = await Promise.all(
    localities.map(async (locality) => ({
      locality,
      stats: await provider.getMarketStats({
        citySlug: locality.citySlug,
        localitySlug: locality.slug,
      }),
    })),
  );

  // Group by city so the hub reads as a place hierarchy rather than a flat list.
  const byCity = new Map<string, typeof withStats>();
  for (const entry of withStats) {
    const existing = byCity.get(entry.locality.citySlug) ?? [];
    existing.push(entry);
    byCity.set(entry.locality.citySlug, existing);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          {site.market.name} area guides
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Listing photos tell you about a property. They tell you nothing about the sector, the
          commute, or whether the road outside is actually finished. These guides cover the parts
          that decide whether you&rsquo;ll be happy there.
        </p>
      </header>

      {[...byCity.entries()].map(([citySlug, entries]) => {
        const city = getCity(citySlug);
        return (
          <section key={citySlug} className="mt-14">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              {city?.name ?? citySlug}
              <span className="ml-2 text-base font-normal text-sand-500">{city?.state}</span>
            </h2>

            <div className="mt-6 grid gap-8 md:grid-cols-2">
              {entries.map(({ locality, stats: marketStats }) => {
                const href = `/localities/${locality.citySlug}/${locality.slug}`;
                const content = locality.content!;

                return (
                  <article
                    key={href}
                    className="flex flex-col rounded-card border border-sand-200 bg-white p-6 transition-shadow hover:shadow-md"
                  >
                    <h3 className="font-display text-2xl font-semibold text-sand-950">
                      <Link href={href} className="hover:text-brand-700">
                        {locality.name}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm font-medium text-sand-600">{content.tagline}</p>
                    <p className="mt-4 leading-relaxed text-sand-700">{content.intro}</p>

                    <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-sand-100 pt-4 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-sand-500">
                          For sale
                        </dt>
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
                        <dt className="text-xs uppercase tracking-wide text-sand-500">
                          Typical range
                        </dt>
                        <dd className="mt-0.5 font-semibold text-sand-900">
                          {formatPriceCompact(content.priceRange.min)}–
                          {formatPriceCompact(content.priceRange.max)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <Link
                        href={href}
                        className="text-sm font-semibold text-brand-700 hover:underline"
                      >
                        Read the guide →
                      </Link>
                      <Link
                        href={`/search?area=${locality.citySlug}/${locality.slug}`}
                        className="text-sm font-medium text-sand-700 hover:text-brand-700"
                      >
                        See property for sale
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Honest placeholder rather than pretending the coverage is complete. */}
      <section className="mt-16 rounded-card border border-sand-200 bg-sand-100 p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          Looking at a sector not listed here?
        </h2>
        <p className="mx-auto mt-2 max-w-xl leading-relaxed text-sand-700">
          More guides are on the way — every sector and phase across the tricity is searchable
          even where a guide hasn&rsquo;t been written yet. In the meantime, ask directly.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/contact"
            className="rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Ask about an area
          </Link>
          <Link
            href="/search"
            className="rounded-md border border-sand-300 px-6 py-3 text-sm font-semibold text-sand-800 hover:border-sand-400"
          >
            Search all areas
          </Link>
        </div>
      </section>
    </div>
  );
}
