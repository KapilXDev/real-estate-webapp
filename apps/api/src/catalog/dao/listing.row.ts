/**
 * DAO layer — the shape rows come back in, and nothing more.
 *
 * WHY THIS EXISTS AS ITS OWN LAYER: these are hand-written type assertions over raw SQL. The
 * compiler cannot check them against the wire, so they are the one place in the stack where
 * TypeScript is trusting us rather than verifying. Isolating them means there is exactly one file
 * to re-read when a column changes, instead of a type assertion buried in the middle of a query
 * in a service.
 *
 * Conventions, all of which follow from postgres.js rather than from preference:
 *  - snake_case, matching the columns, so a mismatch is visible against `\d listing`.
 *  - `numeric` columns arrive as STRINGS. Postgres numeric has arbitrary precision and JS numbers
 *    do not, so the driver refuses to lose precision silently. Every price and area is therefore
 *    `string` here and converted exactly once, in the mapper. Typing them `number` would compile
 *    fine and produce `"12500000" * 1.05` = string concatenation at runtime.
 *  - `null`, never `undefined` — SQL has one absent value and conflating them means a mapper
 *    branch that never fires.
 */

/** Joined listing + property + locality + city + org + agent, as the repository selects it. */
export interface ListingRow {
  id: string;
  reference_code: string;
  organization_id: string;
  status: string;
  transaction_type: string;
  visibility: string;
  source: string;

  price: string;
  price_on_request: boolean;
  close_price: string | null;
  closed_at: Date | null;
  maintenance_monthly: string | null;
  furnishing: string | null;

  title: string | null;
  description: string | null;
  features: unknown;

  possession: string;
  possession_date: Date | null;

  published_at: Date | null;
  created_at: Date;
  updated_at: Date;

  // --- property ---
  property_id: string;
  property_type: string;
  address_line: string | null;
  plot_number: string | null;
  pincode: string | null;
  /** ST_Y / ST_X of the geography point — always selected as floats, never as WKB. */
  lat: number;
  lng: number;

  plot_area_sqft: string | null;
  built_up_area_sqft: string | null;
  carpet_area_sqft: string | null;
  area_input_value: string | null;
  area_input_unit: string | null;
  area_conversion_factor: string | null;
  area_input_basis: string | null;

  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  total_floors: number | null;
  floor_number: number | null;
  facing: string | null;
  year_built: number | null;

  // --- locality / city ---
  locality_slug: string;
  locality_name: string;
  city_slug: string;
  city_name: string;
  /** Drives RERA jurisdiction resolution — see the mapper. */
  city_state: string;

  // --- project (nullable) ---
  project_name: string | null;
  project_rera_no: string | null;

  // --- attribution ---
  org_name: string;
  org_is_host: boolean;
  agent_name: string | null;
  /** Resolved for the listing's own jurisdiction, not the org's default. */
  rera_registration_no: string | null;
  rera_authority_name: string | null;
}

export interface ListingMediaRow {
  listing_id: string;
  storage_key: string;
  caption: string | null;
  sort_order: number;
  kind: string;
  processing_status: string;
}

/** `count(*) OVER ()` rides along with the page so pagination costs one round trip, not two. */
export interface CountedRow {
  total_count: string;
}

export interface MarketStatsRow {
  active_count: string;
  median_list_price: string | null;
  median_price_per_sqft: string | null;
  median_days_on_market: string | null;
  closed_last_90: string;
  median_close_price: string | null;
  median_list_price_prior: string | null;
}
