/**
 * The seam between the UI and wherever listing data actually comes from.
 *
 * WHY THIS EXISTS — and why the reason CHANGED:
 *
 * This interface originally existed to absorb an IDX/MLS feed integration. That plan is dead:
 * there is no MLS in India. The seam is still worth keeping, but for a different and more
 * permanent reason — inventory here arrives from several unrelated sources that will never share
 * a schema:
 *
 *   Today:  MockProvider   — deterministic generated sample data
 *   Next:   ApiProvider    — our own NestJS catalog service (agent's own listings)
 *   Later:  PartnerProvider / builder project feeds, merged behind the same contract
 *
 * Because inventory sourcing is the hardest unsolved problem in this project rather than a
 * licensing formality, the abstraction earns its keep permanently instead of being scaffolding.
 *
 * Swapping providers must require ZERO changes to any UI component. If you find yourself wanting
 * to import a concrete provider inside a component, that's a design smell — go through
 * `getListingProvider()` instead.
 */

import type { Listing, ListingQuery, ListingResult, LocalityRef } from "./types";

export interface ListingProvider {
  /** Human-readable provider name, surfaced in dev tooling and the admin health check. */
  readonly name: string;

  /**
   * True when this provider serves real inventory.
   *
   * While false, the site must not present itself as a working property portal: robots.ts blocks
   * indexing and ListingAttribution suppresses provenance claims. Publishing fabricated listings
   * as though they were real is a RERA advertising problem, not just a bug.
   */
  readonly isLiveData: boolean;

  /** Run a filtered, sorted, paginated search. */
  search(query: ListingQuery): Promise<ListingResult>;

  /** Fetch one listing by key. Returns null when not found or no longer public. */
  getByKey(listingKey: string): Promise<Listing | null>;

  /**
   * Listings belonging to the site owner. Their own inventory and sold history is the core
   * credibility proof on the site, so it gets a dedicated path rather than a search filter.
   */
  getOwnListings(opts?: { includeSold?: boolean }): Promise<Listing[]>;

  /**
   * Listings within a locality, for embedding live inventory on its landing page.
   * Takes a city-qualified ref — locality slugs are not globally unique.
   */
  getByLocality(ref: LocalityRef, limit?: number): Promise<Listing[]>;

  /** Listings anywhere in a city, for the city hub pages. */
  getByCity(citySlug: string, limit?: number): Promise<Listing[]>;

  /**
   * Aggregate stats for a locality, powering market-report content and the automated monthly
   * emails. Returns null when there isn't enough inventory to be meaningful.
   */
  getMarketStats(ref: LocalityRef): Promise<MarketStats | null>;
}

export interface MarketStats {
  citySlug: string;
  localitySlug: string;
  activeCount: number;
  /** Rupees. */
  medianListPrice: number;
  /** Rupees per square foot — the comparison metric buyers here use most. */
  medianPricePerSqft: number;
  medianDaysOnMarket: number;
  /** Sales closed in the trailing 90 days. */
  closedLast90Days: number;
  /** Median close price over that window. Null when sample size is too small to publish. */
  medianClosePrice: number | null;
  /** Percent change in median list price vs. the prior 90-day window. */
  priceChangePercent: number | null;
  /** ISO timestamp — market reports must be dated or they mislead. */
  generatedAt: string;
}
