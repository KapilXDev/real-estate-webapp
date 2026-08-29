/**
 * Provider factory — the ONLY place the app decides where listing data comes from.
 *
 * Components and route handlers must import `getListingProvider()` from here, never a concrete
 * provider class. That indirection is what lets the real inventory source drop in with no UI
 * changes.
 *
 * TO GO LIVE WITH REAL INVENTORY:
 *   1. Build the catalog module in apps/api (listings CRUD + partner inventory).
 *   2. Implement ApiProvider in ./api-provider.ts against the same ListingProvider interface.
 *   3. Set LISTING_PROVIDER=api plus NEXT_PUBLIC_API_URL.
 *   4. Nothing else changes.
 *
 * NOTE the env var was renamed from MLS_PROVIDER — there is no MLS in this market, and the old
 * name would send the next person looking for a feed integration that does not exist.
 */

import { MockProvider } from "./mock-provider";
import type { ListingProvider } from "./provider";

let provider: ListingProvider | null = null;

export function getListingProvider(): ListingProvider {
  if (provider) return provider;

  switch (process.env.LISTING_PROVIDER) {
    case "api":
      // Deliberately a hard failure rather than a silent fallback. Quietly serving fabricated
      // listings on a site that presents itself as real inventory is a RERA advertising problem,
      // not just a bug.
      throw new Error(
        "LISTING_PROVIDER=api but ApiProvider is not implemented yet. " +
          "Implement src/lib/listings/api-provider.ts once the catalog module is built.",
      );
    default:
      provider = new MockProvider();
      return provider;
  }
}

export * from "./types";
export type { ListingProvider, MarketStats } from "./provider";
