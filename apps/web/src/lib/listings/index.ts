/**
 * Provider factory — the ONLY place the app decides where listing data comes from.
 *
 * Components and route handlers must import `getListingProvider()` from here, never a concrete
 * provider class. That indirection is what lets the IDX feed drop in with no UI changes.
 *
 * TO GO LIVE WITH REAL MLS DATA:
 *   1. Sign the IDX agreement with the MLS board (through the broker) and get RESO Web API creds.
 *   2. Implement ResoProvider in ./reso-provider.ts against the same ListingProvider interface.
 *   3. Set MLS_PROVIDER=reso plus the credential env vars.
 *   4. Nothing else changes.
 */

import { MockProvider } from "./mock-provider";
import type { ListingProvider } from "./provider";

let provider: ListingProvider | null = null;

export function getListingProvider(): ListingProvider {
  if (provider) return provider;

  switch (process.env.MLS_PROVIDER) {
    case "reso":
      // Deliberately a hard failure rather than a silent fallback: quietly serving sample data
      // on a production site that claims live MLS listings is a compliance problem, not a bug.
      throw new Error(
        "MLS_PROVIDER=reso but ResoProvider is not implemented yet. " +
          "Implement src/lib/listings/reso-provider.ts once the IDX agreement is signed.",
      );
    default:
      provider = new MockProvider();
      return provider;
  }
}

export * from "./types";
export type { ListingProvider, MarketStats } from "./provider";
