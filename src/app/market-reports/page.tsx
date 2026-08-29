import type { Metadata } from "next";
import Link from "next/link";

import { SavedSearchPrompt } from "@/components/leads/SavedSearchPrompt";
import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { formatPrice, formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";

/**
 * Neighborhood market reports.
 *
 * Two jobs. For search engines, it's a recurring-freshness page targeting "{neighborhood} home
 * prices" and "{city} market report". For the business, it's the hook for a monthly email — the
 * cheapest way to stay in front of past clients and future sellers without ever writing "just
 * checking in".
 *
 * Stats are derived from live inventory, so the page updates itself as the market moves.
 * Revalidated hourly.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `${site.market.city} Market Reports`,
  description: `Current home prices, inventory, and days on market for every neighborhood in ${site.market.city}, ${site.market.stateFull}.`,
};

export default async function MarketReportsPage() {
  const provider = getListingProvider();

  const reports = await Promise.all(
    neighborhoods.map(async (n) => ({
      neighborhood: n,
      stats: await provider.getMarketStats(n.slug),
    })),
  );

  const withStats = reports.filter((r) => r.stats !== null);

  const totalActive = withStats.reduce((sum, r) => sum + (r.stats?.activeCount ?? 0), 0);
  const overallMedian = withStats.length
    ? Math.round(
        withStats.reduce((sum, r) => sum + (r.stats?.medianListPrice ?? 0), 0) /
          withStats.length,
      )
    : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          {site.market.city} market reports
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Where prices actually are right now, neighborhood by neighborhood. Updated continuously
          from current inventory — not last quarter&rsquo;s summary.
        </p>
      </header>

      <section className="mt-10 rounded-card bg-brand-800 p-8">
        <h2 className="font-display text-2xl font-semibold text-white">
          {site.market.city} at a glance
        </h2>
        <dl className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-brand-200">Homes for sale</dt>
            <dd className="mt-1 font-display text-3xl font-semibold text-white">
              {totalActive}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-brand-200">Median list price</dt>
            <dd className="mt-1 font-display text-3xl font-semibold text-white">
              {overallMedian ? formatPriceCompact(overallMedian) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-brand-200">Neighborhoods tracked</dt>
            <dd className="mt-1 font-display text-3xl font-semibold text-white">
              {withStats.length}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          By neighborhood
        </h2>

        {/* Horizontal scroll rather than a cramped stack — comparison is the point of this table. */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-sand-300 text-left">
                <th scope="col" className="pb-3 pr-4 font-semibold text-sand-900">Neighborhood</th>
                <th scope="col" className="pb-3 pr-4 font-semibold text-sand-900">For sale</th>
                <th scope="col" className="pb-3 pr-4 font-semibold text-sand-900">Median price</th>
                <th scope="col" className="pb-3 pr-4 font-semibold text-sand-900">$ / sq ft</th>
                <th scope="col" className="pb-3 font-semibold text-sand-900">Days on market</th>
              </tr>
            </thead>
            <tbody>
              {withStats.map(({ neighborhood, stats }) => (
                <tr key={neighborhood.slug} className="border-b border-sand-100">
                  <th scope="row" className="py-3 pr-4 text-left font-medium">
                    <Link
                      href={`/neighborhoods/${neighborhood.slug}`}
                      className="text-brand-700 hover:underline"
                    >
                      {neighborhood.name}
                    </Link>
                  </th>
                  <td className="py-3 pr-4 tabular-nums text-sand-800">{stats!.activeCount}</td>
                  <td className="py-3 pr-4 tabular-nums text-sand-800">
                    {formatPrice(stats!.medianListPrice)}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-sand-800">
                    ${stats!.medianPricePerSqft}
                  </td>
                  <td className="py-3 tabular-nums text-sand-800">
                    {stats!.medianDaysOnMarket}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-sand-500">
          Figures reflect currently listed inventory and are a snapshot, not a formal appraisal.
          Small neighborhoods can swing sharply month to month on a handful of sales — treat
          single-month movement with caution.
        </p>
      </section>

      <div className="mt-14">
        <SavedSearchPrompt
          searchDescription={`${site.market.city} market updates`}
          queryString=""
        />
      </div>

      <section className="mt-12 rounded-card border border-sand-200 bg-sand-100 p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          Want to know what your home is worth in this market?
        </h2>
        <p className="mx-auto mt-2 max-w-xl leading-relaxed text-sand-700">
          Neighborhood medians are a starting point. Your house is not a median.
        </p>
        <Link
          href="/home-value"
          className="mt-6 inline-block rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Get a real valuation
        </Link>
      </section>
    </div>
  );
}
