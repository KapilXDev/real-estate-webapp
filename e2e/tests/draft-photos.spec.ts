import { expect, test } from "@playwright/test";

import { ADMIN_URL, API_URL } from "../support/env";
import { uniqueTitle } from "../support/marker";
import { createListing } from "../support/listing-form";
import { fixturePath } from "../support/global-setup";

/**
 * Photos on a listing that is still a draft.
 *
 * ⚠️ THIS IS THE OTHER HALF OF THE PHOTO BUG, AND IT IS A SECURITY BOUNDARY, NOT A UI DETAIL.
 *
 * A new listing is a draft (PENDING_REVIEW). The API's media delivery route is `@Public()`, so
 * the guard skips verification entirely and never populates `request.principal` — which meant the
 * lookup ran as ANONYMOUS even with a perfectly good staff token attached, and RLS correctly
 * refused a draft listing's media. The agent uploaded fifteen photos and saw fifteen grey boxes,
 * which is indistinguishable from "upload is broken".
 *
 * The fix was a separate authenticated route rather than optional auth on the public one. So
 * there are two assertions here and BOTH have to hold, in the same test, on the same photo:
 *
 *   1. The agent can see their own draft's photos.
 *   2. An anonymous caller cannot.
 *
 * Testing only the first would pass just as well against "RLS is off", which is precisely the
 * failure mode `apps/api/test/rls.spec.ts` exists to catch and which has already happened twice
 * in this repo.
 */

test("an agent sees photos on their own draft, and nobody else does", async ({
  page,
  playwright,
}) => {
  await createListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title: uniqueTitle("draft with photos"),
    price: "1.2 crore",
    areaValue: "8",
    areaUnit: "marla",
    status: "Draft",
  });

  await page.setInputFiles('input[type="file"]', fixturePath());

  /*
   * The thumbnail only renders once processing_status is READY — the API resizes synchronously
   * during the upload, so this is waiting on the request, not on a queue. `naturalWidth` again,
   * not `toBeVisible`: the placeholder box occupies the same space and is equally visible.
   */
  const thumb = page.locator('img[src*="/api/media/"]').first();
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 30_000,
      message: "the agent's own draft thumbnail never painted — the staff media route is the fix",
    })
    .toBeGreaterThan(0);

  await expect(page.getByText("Hero")).toBeVisible();

  const src = await thumb.getAttribute("src");
  const mediaId = /\/api\/media\/([0-9a-f-]{36})\//.exec(src ?? "")?.[1];
  expect(mediaId, `could not read a media id out of ${src}`).toBeTruthy();

  /*
   * ⚠️ A GENUINELY EMPTY CONTEXT, created from the browser rather than reusing `request`. Cookies
   * are scoped by HOST AND NOT BY PORT, so the admin's session cookie for localhost:3002 is also
   * sent to localhost:3001. It happens not to matter — the API authenticates with a bearer token,
   * not a cookie — but relying on that would make this assertion quietly meaningless the day
   * anything cookie-based is added.
   */
  const anonymous = await playwright.request.newContext({ storageState: undefined });
  try {
    const response = await anonymous.get(`${API_URL}/media/${mediaId}/card`);
    expect(
      response.status(),
      "an anonymous caller was served a photo from an UNPUBLISHED listing",
    ).toBe(404);
  } finally {
    await anonymous.dispose();
  }
});

test("publishing makes the same photo public", async ({ page, playwright }) => {
  const listingId = await createListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title: uniqueTitle("publish with photo"),
    price: "1.1 crore",
    areaValue: "7",
    areaUnit: "marla",
    status: "Draft",
  });

  await page.setInputFiles('input[type="file"]', fixturePath());
  const thumb = page.locator('img[src*="/api/media/"]').first();
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  const mediaId = /\/api\/media\/([0-9a-f-]{36})\//.exec(
    (await thumb.getAttribute("src")) ?? "",
  )?.[1];
  expect(mediaId).toBeTruthy();

  /*
   * The complement of the test above: it proves the 404 there was the listing's STATUS and not
   * simply a broken route. Without this pair, "anonymous gets 404" is satisfied by an endpoint
   * that never works at all.
   */
  await page.locator('[name="status"]').selectOption({ label: "Published" });
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(listingId),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await saved;

  const anonymous = await playwright.request.newContext({ storageState: undefined });
  try {
    const response = await anonymous.get(`${API_URL}/media/${mediaId}/card`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
  } finally {
    await anonymous.dispose();
  }
});

test("deleting a photo removes it", async ({ page }) => {
  await createListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title: uniqueTitle("photo delete"),
    price: "80 lakh",
    areaValue: "5",
    areaUnit: "marla",
    status: "Draft",
  });

  await page.setInputFiles('input[type="file"]', fixturePath());
  await expect(page.locator('img[src*="/api/media/"]')).toHaveCount(1, { timeout: 30_000 });

  await page.getByRole("button", { name: "Delete photo" }).click();
  await expect(page.locator('img[src*="/api/media/"]')).toHaveCount(0);
  await expect(page.getByText("No photos yet.")).toBeVisible();
});
