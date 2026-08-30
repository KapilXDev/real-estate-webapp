"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CITIES, LOCALITIES } from "@tricity/geo";
import { formatPriceShort, parsePriceInput } from "@tricity/domain";

import type { ListingFormState } from "@/app/listings/actions";

const PROPERTY_TYPES = [
  ["plot", "Plot"],
  ["kothi", "Kothi (independent house)"],
  ["builder-floor", "Builder floor"],
  ["flat", "Flat / apartment"],
  ["villa", "Villa"],
  ["sco", "SCO"],
  ["scf", "SCF"],
  ["booth", "Booth"],
  ["farmhouse", "Farmhouse"],
] as const;

const POSSESSION = [
  ["ready-to-move", "Ready to move"],
  ["under-construction", "Under construction"],
  ["new-launch", "New launch"],
] as const;

/** Ordered by how often they are actually used in the tricity — marla and kanal lead. */
const AREA_UNITS = [
  ["MARLA", "marla"],
  ["KANAL", "kanal"],
  ["SQ_YD", "gaj (sq yd)"],
  ["SQ_FT", "sq ft"],
  ["ACRE", "acre"],
  ["BIGHA", "bigha"],
  ["SQ_M", "sq m"],
] as const;

const FIELD =
  "w-full rounded-card border border-sand-300 bg-white px-3 py-2 text-sand-950 disabled:bg-sand-100 disabled:text-sand-500";
const LABEL = "block text-sm font-medium text-sand-800";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-sand-500">{hint}</span>}
      {error && (
        <span role="alert" className="block text-xs text-clay-700">
          {error}
        </span>
      )}
    </label>
  );
}

export interface ExistingListing {
  id: string;
  status: string;
  visibility: string;
  possession: string;
  possessionDate?: string;
  price: number;
  priceOnRequest: boolean;
  title: string | null;
  description: string | null;
  features: string[];
  citySlug: string;
  localitySlug: string;
  state: string;
  propertyType?: string;
  maintenanceCharges?: number;
  furnishing?: string;
}

export function ListingForm({
  action,
  existing,
}: {
  action: (prev: ListingFormState, form: FormData) => Promise<ListingFormState>;
  existing?: ExistingListing;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isEdit = existing !== undefined;

  const [citySlug, setCitySlug] = useState(existing?.citySlug ?? CITIES[0]!.slug);
  const [priceRaw, setPriceRaw] = useState(existing ? String(existing.price) : "");

  /*
   * ⚠️ THE PRICE ECHO. The agent types "1.45 cr"; this shows "₹1.45 Cr" underneath as they type.
   *
   * The authoritative parse happens server-side — this is purely a confirmation that what they
   * typed was understood as what they meant. Getting the magnitude wrong here is a 10⁵ error, and
   * an agent who can see "₹1.45 Cr" appear will catch it instantly, whereas nobody proofreads a
   * bare number field.
   */
  const parsedPrice = priceRaw ? parsePriceInput(priceRaw) : null;

  const localities = LOCALITIES.filter((l) => l.citySlug === citySlug);
  const city = CITIES.find((c) => c.slug === citySlug);

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <div
          role="alert"
          className="rounded-card border border-clay-300 bg-clay-100 px-4 py-3 text-sm text-clay-700"
        >
          <p>{state.error}</p>
          {/*
            The RERA gate is the one error with an obvious next action, so it gets one. Without
            this the agent sees a wall of legal text and no way forward.
          */}
          {state.reraBlockedState && (
            <p className="mt-2">
              <Link href="/rera" className="font-medium underline">
                Add your {state.reraBlockedState} RERA registration
              </Link>{" "}
              — or save this as a draft for now, which is always allowed.
            </p>
          )}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="font-medium text-sand-900">Where</h2>

        {isEdit ? (
          <p className="rounded-card bg-sand-100 px-3 py-2 text-sm text-sand-600">
            {existing.localitySlug.replace(/-/g, " ")}, {existing.citySlug} · {existing.state}
            <br />
            {/*
              Location is immutable after creation, and saying why prevents a support question.
              Changing it would mean this is a different property, dragging its leads and price
              history with it.
            */}
            <span className="text-xs">
              Location cannot be changed — a different address is a different property. Create a
              new listing instead.
            </span>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" error={state.fieldErrors?.locality}>
              <select
                name="citySlug"
                value={citySlug}
                onChange={(e) => setCitySlug(e.target.value)}
                className={FIELD}
              >
                {CITIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Locality" hint={`${localities.length} in ${city?.name ?? ""}`}>
              {/*
                ⚠️ Always chosen as a (city, locality) PAIR. Slugs are unique per city only, and
                three tricity municipalities number their sectors — so the city select above is
                not a convenience filter, it is half the key.
              */}
              <select name="localitySlug" className={FIELD} required>
                {localities.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Plot / house number" hint="Used for duplicate detection">
              <input name="plotNumber" className={FIELD} />
            </Field>

            <Field label="Address line">
              <input name="addressLine" className={FIELD} placeholder="Society, block or street" />
            </Field>

            <Field label="Pincode">
              <input name="pincode" inputMode="numeric" pattern="\d{6}" className={FIELD} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" error={state.fieldErrors?.location}>
                <input
                  name="lat"
                  className={FIELD}
                  defaultValue={city?.lat}
                  inputMode="decimal"
                  required
                />
              </Field>
              <Field label="Longitude">
                <input
                  name="lng"
                  className={FIELD}
                  defaultValue={city?.lng}
                  inputMode="decimal"
                  required
                />
              </Field>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-medium text-sand-900">Property</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select
              name="propertyType"
              className={FIELD}
              defaultValue={existing?.propertyType ?? "kothi"}
              disabled={isEdit}
              required={!isEdit}
            >
              {PROPERTY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Possession">
            <select
              name="possession"
              className={FIELD}
              defaultValue={existing?.possession ?? "ready-to-move"}
              required
            >
              {POSSESSION.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          {!isEdit && (
            <>
              {/*
                ⚠️ Area is entered ONCE, in the unit the seller used, and tagged with which area it
                describes. Three separate sqft boxes would invite an agent to convert in their head
                — and the stored conversion factor is what keeps a later correction to the marla
                constant from restating historical listings.
              */}
              <div className="sm:col-span-2 grid grid-cols-3 gap-3">
                <Field label="Area" error={state.fieldErrors?.area}>
                  <input name="areaValue" inputMode="decimal" className={FIELD} placeholder="10" />
                </Field>
                <Field label="Unit">
                  <select name="areaUnit" className={FIELD} defaultValue="MARLA">
                    {AREA_UNITS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Which area?" hint="Carpet is the RERA basis">
                  <select name="areaBasis" className={FIELD} defaultValue="PLOT">
                    <option value="PLOT">Plot</option>
                    <option value="BUILT_UP">Built-up</option>
                    <option value="CARPET">Carpet</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <Field label="Bedrooms">
                  <input name="bedrooms" inputMode="numeric" className={FIELD} />
                </Field>
                <Field label="Bathrooms">
                  <input name="bathrooms" inputMode="numeric" className={FIELD} />
                </Field>
                <Field label="Balconies">
                  <input name="balconies" inputMode="numeric" className={FIELD} />
                </Field>
                <Field label="Floor">
                  <input name="floorNumber" inputMode="numeric" className={FIELD} />
                </Field>
                <Field label="Total floors">
                  <input name="totalFloors" inputMode="numeric" className={FIELD} />
                </Field>
                <Field label="Year built">
                  <input name="yearBuilt" inputMode="numeric" className={FIELD} />
                </Field>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium text-sand-900">The offer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price"
            error={state.fieldErrors?.price}
            hint='Type it how you say it — "1.45 cr", "85 lakh", or the full number'
          >
            <input
              name="price"
              className={FIELD}
              value={priceRaw}
              onChange={(e) => setPriceRaw(e.target.value)}
              required
            />
          </Field>

          <div className="flex items-end pb-1">
            {/* The echo. Green when understood, amber when not — before they can save. */}
            {priceRaw &&
              (parsedPrice !== null ? (
                <p className="text-sm text-status-active">
                  Reads as <strong>{formatPriceShort(parsedPrice)}</strong> (
                  {parsedPrice.toLocaleString("en-IN")})
                </p>
              ) : (
                <p className="text-sm text-clay-700">Not a price we can read.</p>
              ))}
          </div>

          <Field label="Maintenance (₹/month)">
            <input
              name="maintenanceCharges"
              inputMode="numeric"
              className={FIELD}
              defaultValue={existing?.maintenanceCharges}
            />
          </Field>

          <Field label="Furnishing">
            <select name="furnishing" className={FIELD} defaultValue={existing?.furnishing ?? ""}>
              <option value="">Not specified</option>
              <option value="unfurnished">Unfurnished</option>
              <option value="semi-furnished">Semi-furnished</option>
              <option value="fully-furnished">Fully furnished</option>
            </select>
          </Field>

          <Field label="Title" hint="Shown as the listing headline">
            <input
              name="title"
              className={FIELD}
              defaultValue={existing?.title ?? ""}
              placeholder="4 BHK kothi in Phase 7"
            />
          </Field>

          <Field label="Features" hint="Comma separated">
            <input
              name="features"
              className={FIELD}
              defaultValue={existing?.features.join(", ") ?? ""}
              placeholder="Corner plot, Park facing"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                name="description"
                rows={5}
                className={FIELD}
                defaultValue={existing?.description ?? ""}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium text-sand-900">Publishing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status"
            hint="Draft is always allowed. Publishing needs a RERA registration for this jurisdiction."
          >
            <select
              name="status"
              className={FIELD}
              defaultValue={
                existing?.status === "ACTIVE"
                  ? "active"
                  : existing?.status === "UNDER_OFFER"
                    ? "under-offer"
                    : existing?.status === "SOLD"
                      ? "sold"
                      : "coming-soon"
              }
            >
              <option value="coming-soon">Draft</option>
              <option value="active">Published</option>
              <option value="under-offer">Under offer</option>
              <option value="sold">Sold</option>
            </select>
          </Field>

          <Field label="Visibility">
            <select name="visibility" className={FIELD} defaultValue={existing?.visibility ?? "PUBLIC"}>
              <option value="PUBLIC">Public</option>
              <option value="NETWORK_ONLY">Partner network only</option>
              <option value="PRIVATE">Private</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-card bg-brand-700 px-5 py-2.5 font-medium text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create listing"}
        </button>
        <Link
          href="/listings"
          className="rounded-card px-5 py-2.5 text-sand-700 hover:bg-sand-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
