/**
 * Staff-side row shapes.
 *
 * ⚠️ Separate from `listing.row.ts` on purpose. That one backs the PUBLIC projection: it resolves
 * RERA registrations, joins the agent name, and is always filtered to published statuses. These
 * back the agent's own view — raw stored values, drafts included, no derived presentation.
 *
 * Sharing one row type between "what a buyer sees" and "what an agent edits" would make it easy
 * for a draft-only field to end up on a public response, or for the public projection to grow a
 * column only the admin needs. Two small types, no ambiguity about which one an endpoint returns.
 *
 * As everywhere: `numeric` arrives as a STRING (arbitrary precision), so prices and areas are
 * `string` here and converted exactly once, in the mapper.
 */

/** The list screen: enough to scan inventory, not enough to edit it. */
export interface StaffListingSummaryRow {
  id: string;
  reference_code: string;
  status: string;
  visibility: string;
  possession: string;
  price: string;
  title: string | null;
  updated_at: Date;
  locality_slug: string;
  city_slug: string;
  /** Drives the "needs photos" nudge — a listing with none converts badly. */
  photo_count: number;
}

/** Everything the edit form needs to round-trip a listing without losing a field. */
export interface StaffListingRow {
  id: string;
  reference_code: string;
  status: string;
  transaction_type: string;
  visibility: string;
  possession: string;
  possession_date: Date | null;

  price: string;
  price_on_request: boolean;
  close_price: string | null;
  maintenance_monthly: string | null;
  furnishing: string | null;

  title: string | null;
  description: string | null;
  features: unknown;

  published_at: Date | null;
  created_at: Date;
  updated_at: Date;

  property_id: string;
  property_type: string;
  address_line: string | null;
  plot_number: string | null;
  pincode: string | null;
  lat: number;
  lng: number;

  plot_area_sqft: string | null;
  built_up_area_sqft: string | null;
  carpet_area_sqft: string | null;
  area_input_value: string | null;
  area_input_unit: string | null;
  area_conversion_factor: string | null;
  /** Which area the seller's typed figure describes. See migration 0015. */
  area_input_basis: string | null;

  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  total_floors: number | null;
  floor_number: number | null;
  facing: string | null;
  year_built: number | null;

  locality_slug: string;
  city_slug: string;
  /** The RERA jurisdiction this listing falls under — the form needs it to explain a 403. */
  city_state: string;

  photo_count: number;
}
