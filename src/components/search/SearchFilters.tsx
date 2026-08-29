"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PROPERTY_TYPE_LABELS, neighborhoods, type PropertyType } from "@/config/neighborhoods";
import { cn } from "@/lib/cn";
import { formatPriceCompact } from "@/lib/format";

/**
 * Filter panel.
 *
 * Every change writes to the URL rather than local state — see query-params.ts for why the URL
 * is the source of truth (shareable, crawlable, back-button-correct, works without JS).
 *
 * Filter selection is opinionated. These are the ones buyers actually use; a wall of thirty
 * checkboxes measurably reduces the number of people who filter at all. Notably included:
 *  - max HOA, which buyers care about and most agent sites omit
 *  - year built, the proxy for "will this need a new roof and wiring"
 */

const PRICE_STEPS = [
  0, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000,
  500_000, 600_000, 700_000, 800_000, 1_000_000, 1_500_000, 2_000_000,
];

const FEATURES = [
  "Garage",
  "Fenced Yard",
  "Updated Kitchen",
  "Finished Basement",
  "Pool",
  "Waterfront",
  "New Construction",
  "Home Office",
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
    "maxHoa", "area", "type", "features", "poly",
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
            {resultCount === 1 ? "home" : "homes"}
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
              <option value="sqft-desc">Largest</option>
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
            <Select
              id="minSqft"
              label="Min square feet"
              value={get("minSqft")}
              onChange={(v) => update("minSqft", v)}
              options={[
                { value: "", label: "Any" },
                ...[800, 1000, 1250, 1500, 2000, 2500, 3000].map((n) => ({
                  value: String(n),
                  label: `${n.toLocaleString()}+`,
                })),
              ]}
            />
            <Select
              id="minYear"
              label="Built after"
              value={get("minYear")}
              onChange={(v) => update("minYear", v)}
              options={[
                { value: "", label: "Any year" },
                ...[1950, 1970, 1990, 2000, 2010, 2020].map((y) => ({
                  value: String(y),
                  label: String(y),
                })),
              ]}
            />
            {/* Buyers filter on HOA more than most agent sites expect. */}
            <Select
              id="maxHoa"
              label="Max HOA dues"
              value={get("maxHoa")}
              onChange={(v) => update("maxHoa", v)}
              options={[
                { value: "", label: "Any" },
                { value: "0", label: "No HOA" },
                ...[150, 250, 400, 600].map((n) => ({
                  value: String(n),
                  label: `Up to $${n}/mo`,
                })),
              ]}
            />
          </div>

          <ChipGroup
            label="Property type"
            options={(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((t) => ({
              value: t,
              label: PROPERTY_TYPE_LABELS[t],
            }))}
            isActive={(v) => has("type", v)}
            onToggle={(v) => toggleInList("type", v)}
          />

          <ChipGroup
            label="Neighborhood"
            options={neighborhoods.map((n) => ({ value: n.slug, label: n.name }))}
            isActive={(v) => has("area", v)}
            onToggle={(v) => toggleInList("area", v)}
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
