import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SavedSearchPrompt } from "@/components/leads/SavedSearchPrompt";
import { ListingCard } from "@/components/listings/ListingCard";
import { MapPanel } from "@/components/search/MapPanel";
import { SearchFilters } from "@/components/search/SearchFilters";
import { site } from "@/config/site";
import { getListingProvider } from "@/lib/listings";
import {
  describeQuery,
  parseSearchParams,
  toSearchParams,
  type RawSearchParams,
} from "@/lib/listings/query-params";

/**
 * Property search — the page that gives buyers a reason to visit and, more importantly, return.
 *
 * Server-rendered so results are crawlable and the first paint is fast. All state lives in the
 * URL, so any search is shareable and the back button behaves. The map is loaded only when the
 * user asks for it, keeping MapLibre out of the default bundle.
 */

export const metadata: Metadata = {
  title: `Search Property in the ${site.market.name}`,
  description:
    `Browse property for sale across Chandigarh, Mohali, Kharar and Zirakpur. Filter by price, ` +
    `size, sector, possession status — or draw your own search area on the map.`,
};

type Props = { searchParams: Promise<RawSearchParams> };

export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = parseSearchParams(raw);
  const isMapView = raw.view === "map";

  const provider = getListingProvider();
  const result = await provider.search(query);

  /*
   * The map needs every match, not just the current page — a map showing 24 of 300 homes is
   * actively misleading. Capped at 300 to bound the marker count and payload.
   */
  const mapResult = isMapView
    ? await provider.search({ ...query, page: 1, pageSize: 300 })
    : null;

  const totalPages = Math.ceil(result.total / result.pageSize);

  return (
    <div>
      <Suspense fallback={<div className="h-24 border-b border-sand-200 bg-white" />}>
        <SearchFilters resultCount={result.total} />
      </Suspense>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-sand-950">
              {query.q
                ? `Results for “${query.q}”`
                : `${describeQuery(query)} in the ${site.market.name}`}
            </h1>
            {query.polygons?.length ? (
              <p className="mt-1 text-sm text-sand-600">
                Filtered to {query.polygons.length} area
                {query.polygons.length > 1 ? "s" : ""} you drew on the map.
              </p>
            ) : null}
          </div>

          <ViewToggle isMapView={isMapView} raw={raw} />
        </div>
      </div>

      {isMapView && mapResult ? (
        /* Split view: map holds position while the list scrolls beside it. */
        <div className="grid gap-0 border-t border-sand-200 lg:h-[calc(100vh-8rem)] lg:grid-cols-2">
          <div className="h-[55vh] lg:h-full">
            <Suspense fallback={<div className="h-full bg-sand-100" />}>
              <MapPanel listings={mapResult.listings} polygons={query.polygons ?? []} />
            </Suspense>
          </div>
          <div className="overflow-y-auto p-4 sm:p-6">
            <ResultsGrid listings={result.listings} columns={2} />
            <Pagination page={result.page} totalPages={totalPages} raw={raw} />
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <ResultsGrid listings={result.listings} columns={3} />
          <Pagination page={result.page} totalPages={totalPages} raw={raw} />

          {result.listings.length > 0 && (
            <div className="mt-12">
              <SavedSearchPrompt
                searchDescription={describeQuery(query)}
                queryString={toSearchParams(query).toString()}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ResultsGrid({
  listings,
  columns,
}: {
  listings: Awaited<ReturnType<ReturnType<typeof getListingProvider>["search"]>>["listings"];
  columns: 2 | 3;
}) {
  if (listings.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-sand-300 bg-white px-6 py-16 text-center">
        <h2 className="font-display text-xl font-semibold text-sand-900">
          No property matches those filters
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-sand-600">
          Try widening the price range or clearing a filter. If you tell me what you&rsquo;re
          after, I can watch for it and reach out the moment something fits.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/search"
            className="rounded-md border border-sand-300 bg-white px-5 py-2.5 text-sm font-medium text-sand-800 hover:border-sand-400"
          >
            Clear all filters
          </Link>
          <Link
            href="/contact"
            className="rounded-md bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Tell me what you&rsquo;re looking for
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        columns === 2
          ? "grid gap-5 sm:grid-cols-2"
          : "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      }
    >
      {listings.map((listing, index) => (
        <ListingCard key={listing.listingKey} listing={listing} priority={index < columns} />
      ))}
    </div>
  );
}

function ViewToggle({ isMapView, raw }: { isMapView: boolean; raw: RawSearchParams }) {
  const build = (view: "grid" | "map") => {
    const params = new URLSearchParams();
    Object.entries(raw).forEach(([key, value]) => {
      if (key !== "view" && typeof value === "string") params.set(key, value);
    });
    if (view === "map") params.set("view", "map");
    return `/search?${params.toString()}`;
  };

  return (
    <div className="inline-flex rounded-md border border-sand-300 bg-white p-1">
      <Link
        href={build("grid")}
        aria-current={!isMapView ? "page" : undefined}
        className={
          !isMapView
            ? "rounded px-4 py-1.5 text-sm font-semibold bg-brand-700 text-white"
            : "rounded px-4 py-1.5 text-sm font-medium text-sand-700"
        }
      >
        List
      </Link>
      <Link
        href={build("map")}
        aria-current={isMapView ? "page" : undefined}
        className={
          isMapView
            ? "rounded px-4 py-1.5 text-sm font-semibold bg-brand-700 text-white"
            : "rounded px-4 py-1.5 text-sm font-medium text-sand-700"
        }
      >
        Map
      </Link>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  raw,
}: {
  page: number;
  totalPages: number;
  raw: RawSearchParams;
}) {
  if (totalPages <= 1) return null;

  const build = (target: number) => {
    const params = new URLSearchParams();
    Object.entries(raw).forEach(([key, value]) => {
      if (key !== "page" && typeof value === "string") params.set(key, value);
    });
    if (target > 1) params.set("page", String(target));
    return `/search?${params.toString()}`;
  };

  return (
    <nav
      aria-label="Search results pages"
      className="mt-10 flex items-center justify-between gap-4 border-t border-sand-200 pt-6"
    >
      {page > 1 ? (
        <Link
          href={build(page - 1)}
          className="rounded-md border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-800 hover:border-sand-400"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}

      <p className="text-sm text-sand-600">
        Page {page} of {totalPages}
      </p>

      {page < totalPages ? (
        <Link
          href={build(page + 1)}
          className="rounded-md border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-800 hover:border-sand-400"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
