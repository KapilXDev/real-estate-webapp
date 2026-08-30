import type { AreaDto, ListingDto, ListingMediaDto } from "@tricity/contracts";

import type { ListingMediaRow, ListingRow } from "../dao/listing.row";
import {
  dbToFacing,
  dbToFurnishing,
  dbToPossession,
  dbToPropertyType,
  dbToStatus,
  dbToTransaction,
} from "../utils/enum-maps";

/**
 * Row → wire.
 *
 * The mapper is the only place that knows both vocabularies, which is what lets the schema and the
 * website evolve independently. It is pure and synchronous on purpose: no database handle, no
 * config, nothing to stub — so it is testable with a literal object and reads as a specification
 * of the wire format.
 */

/**
 * ⚠️ `numeric` arrives from postgres.js as a STRING, always.
 *
 * Postgres numeric has arbitrary precision, JS numbers do not, and the driver will not silently
 * lose precision for us. `Number(row.price)` is therefore mandatory and `row.price * 2` is string
 * concatenation that typechecks if the DAO lies about the column type. Prices here run to eight
 * figures in rupees, comfortably inside float64's exact-integer range, so the conversion itself is
 * lossless — it just has to actually happen.
 */
function num(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** ISO 8601, because JSON has no date type and a bare number is ambiguous about its units. */
function iso(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

/**
 * Build an area, attaching the as-entered figure only to the area it actually describes.
 *
 * ⚠️ THIS IS WHY `area_input_basis` EXISTS. The seller typed one number in one unit — "10 marla".
 * Attaching that to every area would render "10 marla" beside the carpet area as well as the plot
 * area, which is not a formatting quirk, it is a false statement about the property. Every other
 * area is returned as canonical square feet with no input echo, and the UI falls back to sq ft.
 */
function area(
  sqft: string | null,
  basis: "PLOT" | "BUILT_UP" | "CARPET",
  row: ListingRow,
): AreaDto | undefined {
  const canonical = num(sqft);
  if (canonical === undefined) return undefined;

  if (row.area_input_basis !== basis) return { sqft: canonical };

  const inputValue = num(row.area_input_value);
  const conversionFactor = num(row.area_conversion_factor);
  if (inputValue === undefined || row.area_input_unit === null) return { sqft: canonical };

  return {
    sqft: canonical,
    inputValue,
    inputUnit: row.area_input_unit as AreaDto["inputUnit"],
    conversionFactor,
  };
}

/**
 * Days the listing has been live.
 *
 * From `published_at`, not `created_at`: a listing that sat in DRAFT for three weeks has not been
 * on the market for three weeks, and "days on market" is a number buyers use to judge whether to
 * negotiate. Overstating it costs the seller money.
 */
function daysOnMarket(row: ListingRow): number {
  const start = row.published_at ?? row.created_at;
  const end = row.closed_at ?? new Date();
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, days);
}

/** A one-line address for display and schema.org, built from whatever parts exist. */
function unparsedAddress(row: ListingRow): string {
  return [
    row.plot_number,
    row.address_line,
    row.project_name,
    row.locality_name,
    row.city_name,
    row.pincode,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");
}

function features(raw: unknown): string[] {
  // jsonb defaults to '[]' and is NOT NULL, but a hand-edited row could hold anything. A bad
  // value must degrade to "no features", never throw on a public page.
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is string => typeof f === "string");
}

export function toMediaDto(row: ListingMediaRow): ListingMediaDto {
  return {
    // The API returns a path, not a signed URL. Signing belongs at the point of delivery (CDN or
    // media service) where the expiry can be short; baking one into a cached search response
    // would hand out URLs that outlive their signature.
    url: `/media/${row.storage_key}`,
    caption: row.caption ?? "",
    order: row.sort_order,
  };
}

export class ListingMappingError extends Error {}

/**
 * Map a joined row to the wire contract.
 *
 * Throws on a listing whose status or property type has no public representation. That is
 * deliberate and it should be unreachable — the repository already filters both — so reaching it
 * means the query and the mapper have drifted apart, and failing loudly in a log is better than a
 * listing rendering with a blank status badge on a public page.
 */
export function toListingDto(row: ListingRow, media: ListingMediaRow[] = []): ListingDto {
  const status = dbToStatus(row.status);
  if (status === undefined) {
    throw new ListingMappingError(
      `Listing ${row.id} has non-public status "${row.status}" — it should not have been selected.`,
    );
  }

  const propertyType = dbToPropertyType(row.property_type);
  if (propertyType === undefined) {
    throw new ListingMappingError(
      `Listing ${row.id} has property type "${row.property_type}", which has no public equivalent.`,
    );
  }

  const listDate = (row.published_at ?? row.created_at).toISOString();

  return {
    listingKey: row.id,
    referenceCode: row.reference_code,
    status,
    transactionType: dbToTransaction(row.transaction_type),

    listPrice: num(row.price) ?? 0,
    priceOnRequest: row.price_on_request,
    closePrice: num(row.close_price),

    address: {
      houseNumber: row.plot_number ?? undefined,
      line1: row.address_line ?? row.locality_name,
      projectName: row.project_name ?? undefined,
      city: row.city_name,
      state: row.city_state,
      pincode: row.pincode ?? "",
      unparsed: unparsedAddress(row),
    },

    coordinates: { lat: row.lat, lng: row.lng },
    citySlug: row.city_slug,
    localitySlug: row.locality_slug,

    bedroomsTotal: row.bedrooms ?? undefined,
    bathroomsTotal: row.bathrooms ?? undefined,
    balconies: row.balconies ?? undefined,

    builtUpArea: area(row.built_up_area_sqft, "BUILT_UP", row),
    carpetArea: area(row.carpet_area_sqft, "CARPET", row),
    plotArea: area(row.plot_area_sqft, "PLOT", row),

    floor: row.floor_number ?? undefined,
    totalFloors: row.total_floors ?? undefined,
    yearBuilt: row.year_built ?? undefined,

    possession: dbToPossession(row.possession),
    // date, not timestamp — slice rather than toISOString so a timezone cannot shift the day.
    possessionDate: row.possession_date
      ? row.possession_date.toISOString().slice(0, 10)
      : undefined,

    propertyType,
    furnishing: dbToFurnishing(row.furnishing),
    facing: dbToFacing(row.facing),

    maintenanceCharges: num(row.maintenance_monthly),

    publicRemarks: row.description ?? row.title ?? "",
    features: features(row.features),
    media: media.map(toMediaDto),

    daysOnMarket: daysOnMarket(row),
    modificationTimestamp: row.updated_at.toISOString(),
    listDate,

    /*
     * RERA attribution, resolved per listing rather than per organisation.
     *
     * The registration comes from `organization_rera` joined on the CITY'S STATE — a Chandigarh
     * listing carries the Chandigarh authority's number, a Mohali listing carries Punjab's, and
     * they are different regulators. An empty string here means the organisation has no
     * registration for that jurisdiction, which is a publication blocker enforced upstream in
     * `ListingAdminService`; it is not something to paper over with a fallback.
     */
    listedByFirm: row.org_name,
    listedByAgent: row.agent_name ?? row.org_name,
    reraAgentRegistration: row.rera_registration_no ?? "",
    reraProjectRegistration: row.project_rera_no ?? undefined,

    isOwnListing: row.org_is_host,
  };
}
