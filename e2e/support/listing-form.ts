import { expect, type Page } from "@playwright/test";

import { ADMIN_URL } from "./env";

/**
 * Driving the listing form.
 *
 * ⚠️ FIELDS ARE LOCATED BY THEIR `name` ATTRIBUTE, NOT BY LABEL, AND THAT IS DELIBERATE.
 *
 * Playwright's usual advice is to select the way a user perceives the page, and for buttons and
 * headings that is what the rest of this suite does. Form controls here are the exception for two
 * concrete reasons:
 *
 *   1. The `Field` wrapper puts the hint INSIDE the label, so the accessible name of the price
 *      input is not "Price" but `Price Type it how you say it — "1.45 cr", "85 lakh", or the full
 *      number`. `getByLabel("Price", { exact: true })` finds nothing, and the inexact form matches
 *      "Area" against "Which area?" as well. Both failure modes read as a broken page.
 *   2. The `name` attribute IS the contract. The server action reads `form.get("price")`, so
 *      renaming it silently breaks the save — exactly the kind of thing a test should catch —
 *      whereas rewording a hint is a copy change that should not fail anything.
 */
function field(page: Page, name: string) {
  return page.locator(`[name="${name}"]`);
}

export interface NewListingInput {
  /** City as the agent sees it in the dropdown, e.g. "Mohali". */
  city: string;
  /** Locality as the agent sees it, e.g. "Sector 70". */
  locality: string;
  title: string;
  /** Typed exactly as an agent would — "1.6 crore", "85 lakh", "14500000". */
  price: string;
  areaValue?: string;
  areaUnit?: "marla" | "kanal" | "gaj (sq yd)" | "sq ft" | "acre" | "bigha" | "sq m";
  /** Draft is always allowed; Published runs the RERA gate. */
  status?: "Draft" | "Published" | "Under offer" | "Sold";
  description?: string;
  bedrooms?: string;
}

/**
 * Fill the create form and submit it.
 *
 * Returns nothing — the caller asserts on where it landed, because "did it save" and "did it tell
 * me why it did not" are both outcomes worth testing and neither should be swallowed here.
 */
export async function fillNewListing(page: Page, input: NewListingInput): Promise<void> {
  await field(page, "citySlug").selectOption({ label: input.city });
  /* The locality options are re-rendered by the city select's onChange, so this must come after
   * it — and a (city, locality) pair is the only safe key anyway: slugs are unique per city, and
   * three tricity municipalities all number their sectors. */
  await expect(field(page, "localitySlug").locator("option", { hasText: input.locality })).toHaveCount(
    1,
  );
  await field(page, "localitySlug").selectOption({ label: input.locality });

  await field(page, "title").fill(input.title);
  await field(page, "price").fill(input.price);

  if (input.areaValue) {
    await field(page, "areaValue").fill(input.areaValue);
    if (input.areaUnit) await field(page, "areaUnit").selectOption({ label: input.areaUnit });
  }
  if (input.bedrooms) await field(page, "bedrooms").fill(input.bedrooms);
  if (input.description) await field(page, "description").fill(input.description);
  if (input.status) await field(page, "status").selectOption({ label: input.status });

  await page.getByRole("button", { name: "Create listing" }).click();
}

/**
 * Create a listing and return its id.
 *
 * The id comes out of the URL because that is the only place the app exposes it — creation
 * redirects to `/listings/{id}?created=1` to push the agent straight at the photo step.
 */
export async function createListing(page: Page, input: NewListingInput): Promise<string> {
  await page.goto(`${ADMIN_URL}/listings/new`);
  await fillNewListing(page, input);

  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);
  const id = /\/listings\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`Could not read a listing id out of ${page.url()}`);
  return id;
}

/** The price echo shown under the field before the agent can save. */
export function priceEcho(page: Page) {
  return page.getByText(/^Reads as/);
}

export { field as listingField };
