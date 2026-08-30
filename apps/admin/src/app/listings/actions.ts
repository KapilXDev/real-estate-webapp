"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Area, parsePriceInput, type AreaUnit } from "@tricity/domain";

import { apiFetch } from "@/lib/api";
import { revalidateSite } from "@/lib/revalidate-site";

/**
 * Server Actions for listing create/edit.
 *
 * ⚠️ THE PARSING HAPPENS HERE, ON THE SERVER, not in the browser. The form posts the raw strings
 * an agent typed — "1.45 cr", "10 marla" — and this is where they become rupees and square feet.
 * Doing it client-side would mean a disabled-JS or half-hydrated form silently posting the wrong
 * magnitude, and the magnitudes involved are 10⁵ apart.
 */

export interface ListingFormState {
  error?: string;
  /** Set when the RERA gate blocks publication, so the UI can link to the fix. */
  reraBlockedState?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Field errors, plus a banner so they can never be invisible.
 *
 * ⚠️ A field error is only ever seen if the field that renders it is on screen. The edit form
 * omits half the fields by design, so a validation failure keyed to one of them produced a form
 * that refused to save and said nothing at all. The specific cause is fixed above; this makes the
 * whole class survivable — whatever else goes wrong, the agent gets a visible message rather than
 * a dead button.
 */
function rejected(fieldErrors: Record<string, string>): ListingFormState {
  return {
    fieldErrors,
    error: `Could not save: ${Object.values(fieldErrors).join(" ")}`,
  };
}

const AREA_UNITS: AreaUnit[] = ["SQ_FT", "SQ_YD", "MARLA", "KANAL", "ACRE", "BIGHA", "SQ_M"];

function str(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(form: FormData, key: string): number | undefined {
  const raw = str(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/**
 * Build the payload the API expects, or return what the agent got wrong.
 *
 * Returned rather than thrown so every problem is reported at once — a form that surfaces one
 * error per submit is miserable to fill in.
 */
/**
 * @param mode `"create"` validates the whole form. `"update"` validates only the offer fields.
 *
 * ⚠️⚠️ THE MODE IS NOT AN OPTIMISATION — WITHOUT IT, EDITING A LISTING SILENTLY DOES NOTHING.
 *
 * The edit form deliberately omits location and property attributes: changing them would mean it
 * is a different property, dragging its leads and price history along. So `citySlug`,
 * `localitySlug`, `lat` and `lng` are simply absent from the FormData on an update — and the
 * unconditional checks below then recorded "Choose a locality" and "Enter valid coordinates",
 * returned early, and never called the API.
 *
 * The failure was invisible from every direction. Those two errors render against the City and
 * Latitude fields, which do not exist on the edit form, so nothing appeared. No error banner, no
 * network call, no log — the agent clicked Save changes and the page sat there looking saved.
 * Every edit path was affected: price, status, description, features. Publishing a draft from the
 * edit screen — the normal way a listing goes live — could not work at all.
 *
 * Caught by the browser suite, which changed a price and then looked at the public site.
 */
function buildPayload(
  form: FormData,
  mode: "create" | "update",
): { payload?: Record<string, unknown>; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};

  /*
   * ⚠️ PRICE GOES THROUGH `parsePriceInput`. Agents type "85 lakh" and "1.25cr", and those are the
   * forms they will use even in a field labelled "rupees". Reading "1.45" as one rupee forty-five
   * paise — or as 1.45 crore when they meant lakh — is a 10⁵ error that renders as a plausible
   * number on a public page. The parsed value is echoed back in the form so the agent can see
   * what was understood before they save.
   */
  const priceRaw = str(form, "price");
  const price = priceRaw ? parsePriceInput(priceRaw) : null;
  if (price === null) {
    errors.price = 'Enter a price like "1.45 cr", "85 lakh" or "14500000".';
  }

  const citySlug = str(form, "citySlug");
  const localitySlug = str(form, "localitySlug");
  const lat = Number(str(form, "lat"));
  const lng = Number(str(form, "lng"));

  if (mode === "create") {
    // Always a pair — a bare locality slug is ambiguous across the tricity's three
    // sector-numbering municipalities, and guessing wrong files the property in another town.
    if (!citySlug || !localitySlug) errors.locality = "Choose a locality.";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.location = "Enter valid coordinates.";
    }
  }

  /*
   * ⚠️ AREA: value + unit + WHICH AREA IT DESCRIBES, all together.
   *
   * `Area.of()` computes the canonical square footage and, critically, hands back the conversion
   * factor it used — which is persisted per row so a future correction to the marla constant
   * cannot silently restate historical listings. The basis is what stops "10 marla" being echoed
   * next to the carpet area when the seller meant the plot. The database CHECK
   * (`property_area_input_complete`) enforces all-four-or-none, so a partial submission is
   * rejected here rather than at the driver.
   */
  const areaValueRaw = str(form, "areaValue");
  const areaUnit = str(form, "areaUnit") as AreaUnit | undefined;
  const areaBasis = str(form, "areaBasis") as "PLOT" | "BUILT_UP" | "CARPET" | undefined;

  let areaFields: Record<string, unknown> = {};
  // Area is create-only for the same reason as location — it describes the property, not the
  // offer — so on an update there is nothing here to validate.
  if (mode === "create" && areaValueRaw) {
    const value = Number(areaValueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      errors.area = "Area must be a positive number.";
    } else if (!areaUnit || !AREA_UNITS.includes(areaUnit)) {
      errors.area = "Choose a unit.";
    } else if (!areaBasis) {
      errors.area = "Say which area this is — plot, built-up or carpet.";
    } else {
      const area = Area.of(value, areaUnit);
      areaFields = {
        areaInputValue: area.inputValue,
        areaInputUnit: area.inputUnit,
        areaConversionFactor: area.conversionFactor,
        areaInputBasis: areaBasis,
        ...(areaBasis === "PLOT" ? { plotAreaSqft: area.sqft } : {}),
        ...(areaBasis === "BUILT_UP" ? { builtUpAreaSqft: area.sqft } : {}),
        ...(areaBasis === "CARPET" ? { carpetAreaSqft: area.sqft } : {}),
      };
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    payload: {
      citySlug,
      localitySlug,
      lat,
      lng,
      propertyType: str(form, "propertyType"),
      possession: str(form, "possession"),
      transactionType: str(form, "transactionType") ?? "sale",
      status: str(form, "status") ?? "coming-soon",
      visibility: str(form, "visibility") ?? "PUBLIC",
      price,
      priceOnRequest: form.get("priceOnRequest") === "on",
      title: str(form, "title"),
      description: str(form, "description"),
      addressLine: str(form, "addressLine"),
      plotNumber: str(form, "plotNumber"),
      pincode: str(form, "pincode"),
      bedrooms: int(form, "bedrooms"),
      bathrooms: int(form, "bathrooms"),
      balconies: int(form, "balconies"),
      totalFloors: int(form, "totalFloors"),
      floorNumber: int(form, "floorNumber"),
      yearBuilt: int(form, "yearBuilt"),
      facing: str(form, "facing"),
      furnishing: str(form, "furnishing"),
      maintenanceCharges: int(form, "maintenanceCharges"),
      possessionDate: str(form, "possessionDate"),
      features: (str(form, "features") ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      ...areaFields,
    },
  };
}

/**
 * ⚠️ A 403 from the API is the RERA publication gate, not a permissions bug.
 *
 * It means the organisation holds no valid registration for THAT listing's jurisdiction. The
 * message names the state, so it is surfaced verbatim along with a flag the form uses to offer
 * "add your {state} registration" — and to point out that saving as a draft always works. A
 * generic "forbidden" here would leave the agent with no idea what to do.
 */
function interpretError(status: number, error: string | undefined): ListingFormState {
  if (status === 403 && error) {
    const match = /listing in ([A-Za-z ]+):/.exec(error);
    return { error, reraBlockedState: match?.[1]?.trim() };
  }
  return { error: error ?? "Could not save the listing." };
}

export async function createListing(
  _prev: ListingFormState,
  form: FormData,
): Promise<ListingFormState> {
  const { payload, errors } = buildPayload(form, "create");
  if (errors) return rejected(errors);

  const result = await apiFetch<{ id: string }>("/staff/listings", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!result.ok) return interpretError(result.status, result.error);

  revalidatePath("/listings");
  // Push the change to the public site now rather than leaving the agent to wonder for a minute
  // whether the save worked. See revalidate-site.ts — deliberately non-fatal.
  await revalidateSite();
  // Straight to the photos step: a listing with no pictures is the most common reason an agent's
  // inventory underperforms, so the flow should not end at "saved".
  redirect(`/listings/${result.data!.id}?created=1`);
}

export async function updateListing(
  listingId: string,
  _prev: ListingFormState,
  form: FormData,
): Promise<ListingFormState> {
  const { payload, errors } = buildPayload(form, "update");
  if (errors) return rejected(errors);

  /*
   * The update endpoint deliberately accepts only the offer fields — location and property
   * attributes are immutable, because changing them means it is a different property and would
   * drag the listing's leads and price history along with it.
   */
  const patch = {
    status: payload!.status,
    visibility: payload!.visibility,
    possession: payload!.possession,
    possessionDate: payload!.possessionDate,
    price: payload!.price,
    priceOnRequest: payload!.priceOnRequest,
    maintenanceCharges: payload!.maintenanceCharges,
    furnishing: payload!.furnishing,
    title: payload!.title,
    description: payload!.description,
    features: payload!.features,
  };

  const result = await apiFetch(`/staff/listings/${listingId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  if (!result.ok) return interpretError(result.status, result.error);

  revalidatePath("/listings");
  revalidatePath(`/listings/${listingId}`);
  await revalidateSite();
  return {};
}
