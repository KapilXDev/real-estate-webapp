/**
 * The seam between the UI and wherever listing data actually comes from.
 *
 * WHY THIS EXISTS: live MLS listings require a signed IDX agreement with the MLS board, obtained
 * through the broker. That is a licensing gate, not a technical one, and it is not yet cleared.
 * Rather than block the entire buyer-side build on it, every component talks to this interface.
 *
 *   Today:  MockProvider  — realistic generated sample data
 *   Later:  ResoProvider  — RESO Web API (REST/JSON, replaced RETS ~2020)
 *
 * Swapping providers must require ZERO changes to any UI component. If you find yourself wanting
 * to import a concrete provider inside a component, that's a design smell — go through
 * `getListingProvider()` instead.
 */

import type { Listing, ListingQuery, ListingResult } from "./types";

export interface ListingProvider {
  /** Human-readable provider name, surfaced in dev tooling and the admin health check. */
  readonly name: string;

  /**
   * True when this provider serves real MLS data. Gates display of the board's attribution and
   * disclaimer blocks — we must not show a real MLS copyright line over fabricated sample data.
   */
  readonly isLiveMlsData: boolean;

  /** Run a filtered, sorted, paginated search. */
  search(query: ListingQuery): Promise<ListingResult>;

  /** Fetch one listing by its RESO ListingKey. Returns null when not found or no longer public. */
  getByKey(listingKey: string): Promise<Listing | null>;

  /**
   * Listings belonging to the site owner. Their own inventory and sold history is the core
   * credibility proof on the site, so it gets a dedicated path rather than a search filter.
   */
  getOwnListings(opts?: { includeSold?: boolean }): Promise<Listing[]>;

  /** Listings within a neighborhood, for embedding live inventory on its landing page. */
  getByNeighborhood(slug: string, limit?: number): Promise<Listing[]>;

  /**
   * Aggregate stats for a neighborhood, powering market-report content and the automated
   * monthly emails. Returns null when there aren't enough sales to be meaningful.
   */
  getMarketStats(neighborhoodSlug: string): Promise<MarketStats | null>;
}

export interface MarketStats {
  neighborhoodSlug: string;
  activeCount: number;
  medianListPrice: number;
  medianPricePerSqft: number;
  medianDaysOnMarket: number;
  /** Closed sales in the trailing 90 days. */
  closedLast90Days: number;
  /** Median close price over that window. Null when sample size is too small to publish. */
  medianClosePrice: number | null;
  /** Percent change in median list price vs. the prior 90-day window. */
  priceChangePercent: number | null;
  /** ISO timestamp — market reports must be dated or they mislead. */
  generatedAt: string;
}
