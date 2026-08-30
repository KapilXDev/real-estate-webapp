/**
 * Provider factory — the ONLY place the app decides where listing data comes from.
 *
 * Components and route handlers must import `getListingProvider()` from here, never a concrete
 * provider class. That indirection is what lets the real inventory source drop in with no UI
 * changes.
 *
 * TO GO LIVE WITH REAL INVENTORY: set `LISTING_PROVIDER=api` and `API_URL`. That is the whole
 * change — `ApiProvider` is built and every UI component already goes through this factory.
 *
 * ⚠️ DO NOT SET IT UNTIL THERE ARE REAL LISTINGS IN THE DATABASE. `ApiProvider.isLiveData` is
 * true, which un-suppresses RERA attribution and lets robots.ts allow indexing. Pointed at demo
 * rows, that publishes fabricated inventory under a real registration number — an advertising
 * problem, not a display bug.
 *
 * NOTE the env var was renamed from MLS_PROVIDER — there is no MLS in this market, and the old
 * name would send the next person looking for a feed integration that does not exist.
 */

import { ApiProvider } from "./api-provider";
import { MockProvider } from "./mock-provider";
import type { ListingProvider } from "./provider";

let provider: ListingProvider | null = null;

export function getListingProvider(): ListingProvider {
  if (provider) return provider;

  switch (process.env.LISTING_PROVIDER) {
    case "api":
      provider = new ApiProvider();
      return provider;

    case "mock":
    case undefined:
    case "":
      provider = new MockProvider();
      return provider;

    default:
      /*
       * ⚠️ An unrecognised value is a HARD FAILURE, never a fallback to mock.
       *
       * A typo like `LISTING_PROVIDER=API` silently serving fabricated listings on a site that
       * presents itself as real inventory is a RERA advertising problem rather than a
       * configuration annoyance — and it would look completely normal in production.
       */
      throw new Error(
        `Unknown LISTING_PROVIDER "${process.env.LISTING_PROVIDER}". Expected "api" or "mock".`,
      );
  }
}

export * from "./types";
export type { ListingProvider, MarketStats } from "./provider";
