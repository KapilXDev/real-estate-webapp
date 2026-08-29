"use client";

import dynamic from "next/dynamic";

import type { Listing, Polygon } from "@/lib/listings/types";

/**
 * Client-side wrapper that loads the map only in the browser.
 *
 * MapLibre touches `window` at module scope, so it cannot be server-rendered. `ssr: false` is
 * only permitted inside a client component, which is the entire reason this thin wrapper exists
 * rather than importing ListingMap directly from the server-rendered search page.
 *
 * Bonus: it keeps MapLibre (a large dependency) out of the initial bundle for buyers who never
 * open the map view.
 */
const ListingMap = dynamic(
  () => import("./ListingMap").then((mod) => mod.ListingMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-sand-100">
        <p className="text-sm text-sand-600">Loading map…</p>
      </div>
    ),
  },
);

export function MapPanel({
  listings,
  polygons,
}: {
  listings: Listing[];
  polygons: Polygon[];
}) {
  return <ListingMap listings={listings} polygons={polygons} />;
}
