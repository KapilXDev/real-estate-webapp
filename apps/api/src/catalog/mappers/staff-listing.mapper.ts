import type { StaffListingRow, StaffListingSummaryRow } from "../dao/staff-listing.row";
import {
  dbToFacing,
  dbToFurnishing,
  dbToPossession,
  dbToPropertyType,
  dbToTransaction,
} from "../utils/enum-maps";

/**
 * Staff row -> the shape the admin form round-trips.
 *
 * ⚠️ Status is NOT translated through `dbToStatus` here, and that is the difference from the
 * public mapper. `dbToStatus` returns undefined for DRAFT / PENDING_REVIEW / REJECTED / WITHDRAWN
 * / EXPIRED, because those must never reach a buyer — the public mapper throws on them by design.
 * The agent's own list is exactly where those statuses have to be visible, so the raw DB value is
 * passed through and the UI labels it.
 */

const num = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const features = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [];

export function toStaffListingSummary(row: StaffListingSummaryRow) {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    status: row.status,
    visibility: row.visibility,
    possession: dbToPossession(row.possession),
    price: num(row.price) ?? 0,
    title: row.title,
    citySlug: row.city_slug,
    localitySlug: row.locality_slug,
    photoCount: row.photo_count,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toStaffListing(row: StaffListingRow) {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    // Raw DB status — includes DRAFT and the other internal states. See the note above.
    status: row.status,
    transactionType: dbToTransaction(row.transaction_type),
    visibility: row.visibility,
    possession: dbToPossession(row.possession),
    possessionDate: row.possession_date
      ? row.possession_date.toISOString().slice(0, 10)
      : undefined,

    price: num(row.price) ?? 0,
    priceOnRequest: row.price_on_request,
    closePrice: num(row.close_price),
    maintenanceCharges: num(row.maintenance_monthly),
    furnishing: dbToFurnishing(row.furnishing),

    title: row.title,
    description: row.description,
    features: features(row.features),

    citySlug: row.city_slug,
    localitySlug: row.locality_slug,
    /** The jurisdiction — the form needs it to explain a RERA 403 in the right words. */
    state: row.city_state,

    propertyType: dbToPropertyType(row.property_type),
    addressLine: row.address_line,
    plotNumber: row.plot_number,
    pincode: row.pincode,
    lat: row.lat,
    lng: row.lng,

    plotAreaSqft: num(row.plot_area_sqft),
    builtUpAreaSqft: num(row.built_up_area_sqft),
    carpetAreaSqft: num(row.carpet_area_sqft),
    /*
     * All four move together or none do — `property_area_input_complete` enforces it in the
     * database. The form must edit them as a unit, which is why they are surfaced as a nested
     * object rather than four loose fields that can drift apart.
     */
    areaInput:
      row.area_input_value !== null && row.area_input_unit !== null
        ? {
            value: num(row.area_input_value)!,
            unit: row.area_input_unit,
            conversionFactor: num(row.area_conversion_factor),
            basis: row.area_input_basis,
          }
        : undefined,

    bedrooms: row.bedrooms ?? undefined,
    bathrooms: row.bathrooms ?? undefined,
    balconies: row.balconies ?? undefined,
    totalFloors: row.total_floors ?? undefined,
    floorNumber: row.floor_number ?? undefined,
    facing: dbToFacing(row.facing),
    yearBuilt: row.year_built ?? undefined,

    photoCount: row.photo_count,
    publishedAt: row.published_at?.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
