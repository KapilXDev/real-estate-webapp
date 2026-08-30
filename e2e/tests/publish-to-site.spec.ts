import { expect, test } from "@playwright/test";

import { ADMIN_URL, SITE_URL } from "../support/env";
import { uniqueTitle } from "../support/marker";
import { createListing, listingField, priceEcho } from "../support/listing-form";
import { fixturePath } from "../support/global-setup";

/**
 * What an agent does all day: type a price the way they say it, publish, and look at the site.
 *
 * Two bugs live in this flow and both were reported as "the save did not work":
 *
 *   - A price read at the wrong magnitude. "1.6 crore" parsed as 1.6 renders as a plausible
 *     number on a public page and nobody proofreads a bare numeric field. It is a 10⁵ error.
 *   - Listing reads are cached 60s so crawler traffic does not turn every hit into a spatial
 *     query. That meant publishing a listing and then not seeing it, which reads as a failed
 *     save. The admin now calls the site's revalidate endpoint after every write.
 */

/** Punjab, where the dev organisation genuinely holds a RERA registration, so publishing is allowed. */
const CITY = "Mohali";
const LOCALITY = "Phase 7";
/* ⚠️ The search URL takes a (city, locality) PAIR — "phase-7" alone is ambiguous across the
 * tricity, and resolving it wrong tells a buyer the property is in a different town. */
const localitySlug = "phase-7";

test("a price typed the way an agent speaks it is echoed back before saving", async ({ page }) => {
  await page.goto(`${ADMIN_URL}/listings/new`);

  /*
   * ⚠️ The echo is the whole safety mechanism, so each of these is a distinct failure mode:
   * a word form, a different word form, and Indian digit grouping — which is 1,45,00,000 rather
   * than 14,500,000 and which a naive parser strips into the wrong number entirely.
   */
  await listingField(page, "price").fill("1.6 crore");
  await expect(priceEcho(page)).toContainText("₹1.6 Cr");
  await expect(priceEcho(page)).toContainText("1,60,00,000");

  await listingField(page, "price").fill("85 lakh");
  await expect(priceEcho(page)).toContainText("₹85 L");
  await expect(priceEcho(page)).toContainText("85,00,000");

  await listingField(page, "price").fill("1,45,00,000");
  await expect(priceEcho(page)).toContainText("₹1.45 Cr");

  /* And the negative: something unparseable must say so rather than quietly submitting a zero. */
  await listingField(page, "price").fill("about eight crores maybe");
  await expect(page.getByText("Not a price we can read.")).toBeVisible();
});

test("publishing a listing shows it on the site immediately, and edits propagate", async ({
  page,
  context,
}) => {
  const title = uniqueTitle("kothi");

  const listingId = await createListing(page, {
    city: CITY,
    locality: LOCALITY,
    title,
    price: "1.6 crore",
    areaValue: "10",
    areaUnit: "marla",
    bedrooms: "4",
    status: "Published",
    description: "Created by the browser test suite. Not real inventory.",
  });

  /*
   * ⚠️ ASSERTED ON A LIST PAGE, NOT THE DETAIL PAGE, AND THAT IS THE POINT. A brand-new listing's
   * own page was never in the cache, so it renders correctly even when invalidation is completely
   * broken. Only a list that was already cached can show the bug.
   */
  const site = await context.newPage();
  await site.goto(`${SITE_URL}/search?area=mohali/${localitySlug}`);

  /*
   * ⚠️ Matched on the LISTING ID in the card's link, not on the title. A buyer-facing card
   * deliberately never shows the agent's internal title — it leads with photo, price, spec line
   * and address, because that is the order a buyer scans in. Searching for the title finds
   * nothing and reads as "the listing is missing" when it is right there.
   *
   * Scoping to our own card also matters: another Phase 7 listing may legitimately be priced at
   * ₹1.6 Cr, and a page-level text assertion would then pass while proving nothing.
   */
  const card = site.locator("article").filter({ has: site.locator(`a[href="/listings/${listingId}"]`) });
  await expect(
    card,
    "published listing did not reach the site — check the revalidate call in the admin's actions",
  ).toBeVisible();
  await expect(card.getByText("₹1.6 Cr")).toBeVisible();

  /*
   * Now the stronger half. The search above populated the cache under LISTINGS_TAG, so this edit
   * is the one that has to invalidate it. Before the fix this page kept showing ₹1.6 Cr for up to
   * a minute — and a stale PRICE is worse than a stale listing, because the buyer sees a number
   * the agent has already moved off.
   */
  await page.goto(`${ADMIN_URL}/listings/${listingId}`);
  await listingField(page, "price").fill("1.75 crore");

  /* Waiting for the Server Action's own response, not for a spinner. The revalidate call to the
   * site happens inside that action, so once it has returned the cache is already invalidated —
   * anything the site serves after this point is the real behaviour, with no sleep needed. */
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(listingId),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await saved;

  await site.reload();
  await expect(
    card.getByText("₹1.75 Cr"),
    "the site is still serving the old price — revalidateTag must use { expire: 0 }, not a " +
      "stale-while-revalidate profile that keeps answering from the stale entry",
  ).toBeVisible();
  await expect(card.getByText("₹1.6 Cr")).toHaveCount(0);
});

test("a draft is not published to the site", async ({ page, context }) => {
  const title = uniqueTitle("draft kothi");

  const listingId = await createListing(page, {
    city: CITY,
    locality: LOCALITY,
    title,
    price: "95 lakh",
    areaValue: "6",
    areaUnit: "marla",
    status: "Draft",
  });

  /*
   * ⚠️ The other side of the cache fix. Invalidating aggressively after every write makes it
   * cheap to leak a draft onto a public page if the status filter is ever wrong, and a draft is
   * frequently a property the agent does not yet have the mandate to advertise. Publishing it
   * under a RERA number would be an advertising offence, not just a UI mistake.
   */
  const site = await context.newPage();
  await site.goto(`${SITE_URL}/search?area=mohali/${localitySlug}`);
  await expect(site.locator(`a[href="/listings/${listingId}"]`)).toHaveCount(0);
});

/**
 * Draft → published, on the agent's own credibility page, with the confirmations that tell them
 * it worked.
 *
 * ⚠️ THIS IS THE FLOW THAT ACTUALLY CONFUSED A USER, AND EVERY PART OF IT WAS A REASONABLE THING
 * TO BE CONFUSED BY. A new listing defaults to Draft and is therefore invisible on the public
 * site — correct, but indistinguishable from a broken save when nothing says so. Saving an edit
 * produced no message at all. And photos save on selection, not on "Save changes", which the
 * screen never said.
 *
 * `/listings` on the site is a stricter test than `/search`: it additionally requires `is_host`,
 * so it only shows the agent's own inventory.
 */
test("a draft is invisible on the agent's own listings page until it is published", async ({
  page,
  context,
}) => {
  const listingId = await createListing(page, {
    city: CITY,
    locality: LOCALITY,
    title: uniqueTitle("draft then publish"),
    price: "2.1 crore",
    areaValue: "12",
    areaUnit: "marla",
    status: "Draft",
  });

  const ownListings = `${SITE_URL}/listings`;
  const site = await context.newPage();
  await site.goto(ownListings);
  await expect(site.locator(`a[href="/listings/${listingId}"]`)).toHaveCount(0);

  /* The draft save has to SAY it is a draft. Silence here is what reads as a failed save. */
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved as a draft/)).toBeVisible();

  await listingField(page, "status").selectOption({ label: "Published" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved and published/)).toBeVisible();

  await site.reload();
  await expect(
    site.locator(`a[href="/listings/${listingId}"]`),
    "published, but still missing from the agent's own listings page",
  ).toHaveCount(1);
});

test("photos are saved on selection, and say so", async ({ page }) => {
  await createListing(page, {
    city: CITY,
    locality: LOCALITY,
    title: uniqueTitle("photo feedback"),
    price: "70 lakh",
    areaValue: "4",
    areaUnit: "marla",
    status: "Draft",
  });

  /*
   * No submit involved — choosing the file IS the save. Without the confirmation an agent either
   * waits for one that is never coming, or clicks "Save changes" expecting it to commit the
   * photos and reads the absence of any message as the upload having been lost.
   */
  await page.setInputFiles('input[type="file"]', fixturePath());
  await expect(page.getByText(/1 photo added and saved/)).toBeVisible({ timeout: 30_000 });
});
