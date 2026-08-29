"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PRICE_BUCKETS_SALE } from "@tricity/domain";
import { CITIES } from "@tricity/geo";

import { localitiesWithContent } from "@/config/localities";
import { cn } from "@/lib/cn";
import { formatPriceCompact } from "@/lib/format";
import {
  FURNISHING_LABELS,
  POSSESSION_LABELS,
  PROPERTY_TYPE_SHORT,
  type Furnishing,
  type PossessionStatus,
  type PropertyType,
} from "@/lib/listings/types";

/**
 * Filter panel.
 *
 * Every change writes to the URL rather than local state — see query-params.ts for why the URL
 * is the source of truth (shareable, crawlable, back-button-correct, works without JS).
 *
 * Filter selection is opinionated. These are the ones buyers here actually use; a wall of thirty
 * checkboxes measurably reduces the number of people who filter at all. Notably included:
 *  - possession status, which in this market is used ahead of almost everything but price
 *  - furnishing, a standard expectation on flats here
 *  - max society maintenance, which buyers care about and most portals bury
 */

/** Price steps come from @tricity/domain so the site and the API bucket prices identically. */
const PRICE_STEPS = PRICE_BUCKETS_SALE;

/** Kept in step with the generator's FEATURE_POOL in mock-provider.ts. */
const FEATURES = [
  "Corner Plot",
  "Park Facing",
  "Power Backup",
  "Covered Parking",
  "Lift",
  "Gated Society",
  "Vaastu Compliant",
  "Modular Kitchen",
];

export function SearchFilters({ resultCount }: { resultCount: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  /** Write one param and navigate. Always resets pagination — a filtered page 4 rarely exists. */
  const update = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  };

  /** Toggle one value within a comma-separated multi-select param. */
  const toggleInList = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const current = (params.get(key) ?? "").split(",").filter(Boolean);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];

    if (next.length === 0) params.delete(key);
    else params.set(key, next.join(","));
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  };

  const has = (key: string, value: string) =>
    (searchParams.get(key) ?? "").split(",").includes(value);

  const get = (key: string) => searchParams.get(key) ?? "";

  const clearAll = () => router.push("/search");

  const activeCount = [
    "minPrice", "maxPrice", "beds", "baths", "minSqft", "minYear",
    "maxMaint", "city", "area", "type", "possession", "furnishing", "features", "poly",
  ].filter((key) => searchParams.get(key)).length;

  return (
    <div className="border-b border-sand-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            className="flex items-center gap-2 rounded-md border border-sand-300 px-3.5 py-2 text-sm font-medium text-sand-800 lg:hidden"
          >
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">
                {activeCount}
              </span>
            )}
          </button>

          <p className="text-sm text-sand-600">
            <span className="font-semibold text-sand-900">{resultCount}</span>{" "}
            {resultCount === 1 ? "property" : "properties"}
          </p>

          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Clear all
              </button>
            )}
            <label htmlFor="sort" className="sr-only">Sort results</label>
            <select
              id="sort"
              value={get("sort") || "newest"}
              onChange={(e) => update("sort", e.target.value === "newest" ? null : e.target.value)}
              className="rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-800"
            >
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="beds-desc">Most bedrooms</option>
              <option value="area-desc">Largest</option>
            </select>
          </div>
        </div>

        <div className={cn("mt-4 space-y-5 lg:block", mobileOpen ? "block" : "hidden")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              id="minPrice"
              label="Min price"
              value={get("minPrice")}
              onChange={(v) => update("minPrice", v)}
              options={PRICE_STEPS.map((p) => ({
                value: String(p),
                label: p === 0 ? "No min" : formatPriceCompact(p),
              }))}
            />
            <Select
              id="maxPrice"
              label="Max price"
              value={get("maxPrice")}
              onChange={(v) => update("maxPrice", v)}
              options={[
                { value: "", label: "No max" },
                ...PRICE_STEPS.filter((p) => p > 0).map((p) => ({
                  value: String(p),
                  label: formatPriceCompact(p),
                })),
              ]}
            />
            <Select
              id="beds"
              label="Bedrooms"
              value={get("beds")}
              onChange={(v) => update("beds", v)}
              options={[
                { value: "", label: "Any" },
                ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+` })),
              ]}
            />
            <Select
              id="baths"
              label="Bathrooms"
              value={get("baths")}
              onChange={(v) => update("baths", v)}
              options={[
                { value: "", label: "Any" },
                ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}+` })),
              ]}
            />
            {/*
              * Area is filtered on canonical square feet even though buyers think in marla, so
              * the labels carry both. Showing only sq ft here would make the filter unusable for
              * the plot buyers who are a large share of this market.
              */}
            <Select
              id="minSqft"
              label="Min area"
              value={get("minSqft")}
              onChange={(v) => update("minSqft", v)}
              options={[
                { value: "", label: "Any" },
                { value: "1089", label: "4 marla+" },
                { value: "1361", label: "5 marla+" },
                { value: "2178", label: "8 marla+" },
                { value: "2723", label: "10 marla+" },
                { value: "3812", label: "14 marla+" },
                { value: "5445", label: "1 kanal+" },
              ]}
            />
            <Select
              id="minYear"
              label="Built after"
              value={get("minYear")}
              onChange={(v) => update("minYear", v)}
              options={[
                { value: "", label: "Any year" },
                ...[1990, 2000, 2010, 2015, 2020].map((y) => ({
                  value: String(y),
                  label: String(y),
                })),
              ]}
            />
            <Select
              id="maxMaint"
              label="Max maintenance"
              value={get("maxMaint")}
              onChange={(v) => update("maxMaint", v)}
              options={[
                { value: "", label: "Any" },
                { value: "0", label: "None" },
                ...[2000, 4000, 6000, 10000].map((n) => ({
                  value: String(n),
                  label: `Up to ₹${n.toLocaleString("en-IN")}/mo`,
                })),
              ]}
            />
          </div>

          <ChipGroup
            label="Property type"
            options={(Object.keys(PROPERTY_TYPE_SHORT) as PropertyType[]).map((t) => ({
              value: t,
              label: PROPERTY_TYPE_SHORT[t],
            }))}
            isActive={(v) => has("type", v)}
            onToggle={(v) => toggleInList("type", v)}
          />

          {/*
           * Possession sits high in the panel on purpose: ready-to-move vs under-construction is
           * the first cut most buyers here make, ahead of size and often ahead of exact price.
           */}
          <ChipGroup
            label="Possession"
            options={(Object.keys(POSSESSION_LABELS) as PossessionStatus[]).map((p) => ({
              value: p,
              label: POSSESSION_LABELS[p],
            }))}
            isActive={(v) => has("possession", v)}
            onToggle={(v) => toggleInList("possession", v)}
          />

          <ChipGroup
            label="City"
            options={CITIES.map((c) => ({ value: c.slug, label: c.name }))}
            isActive={(v) => has("city", v)}
            onToggle={(v) => toggleInList("city", v)}
          />

          {/*
           * Locality values are city-qualified ("mohali/sector-70"). A bare slug would be
           * ambiguous across the tricity's three sector-numbering municipalities.
           */}
          <ChipGroup
            label="Area"
            options={localitiesWithContent().map((l) => ({
              value: `${l.citySlug}/${l.slug}`,
              label: `${l.name}, ${l.cityName}`,
            }))}
            isActive={(v) => has("area", v)}
            onToggle={(v) => toggleInList("area", v)}
          />

          <ChipGroup
            label="Furnishing"
            options={(Object.keys(FURNISHING_LABELS) as Furnishing[]).map((f) => ({
              value: f,
              label: FURNISHING_LABELS[f],
            }))}
            isActive={(v) => has("furnishing", v)}
            onToggle={(v) => toggleInList("furnishing", v)}
          />

          <ChipGroup
            label="Must have"
            options={FEATURES.map((f) => ({ value: f, label: f }))}
            isActive={(v) => has("features", v)}
            onToggle={(v) => toggleInList("features", v)}
          />
        </div>
      </div>
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wide text-sand-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-900"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  isActive,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  isActive: (value: string) => boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-sand-600">
        {label}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            aria-pressed={isActive(option.value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              isActive(option.value)
                ? "bg-brand-700 text-white"
                : "border border-sand-300 text-sand-700 hover:border-sand-400",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
