import { expect, test } from "@playwright/test";

import { SITE_URL } from "../support/env";

/**
 * Listing photos actually appear in a browser.
 *
 * ⚠️ THIS IS THE REGRESSION TEST FOR THE BUG CLASS THAT COST A WHOLE SESSION. Photos have broken
 * three separate ways, and NOT ONE of them was visible to a server-side check:
 *
 *   1. `next/image` rejected the media host and answered `400 "url" parameter is not allowed`.
 *   2. helmet's global `Cross-Origin-Resource-Policy: same-origin` told the browser to refuse to
 *      embed a :3001 response in a :3000 document. The bytes arrive with a 200 and the browser
 *      throws them away.
 *   3. The public mapper emitted `/media/{storage_key}` — a route that serves nothing.
 *
 * In all three the page renders, the HTML contains an `<img>`, the network request may even
 * return 200, and every photo is blank. So the assertion here is deliberately NOT about status
 * codes or markup: it is `naturalWidth > 0`, which is only true if the browser decoded the bytes
 * AND was permitted to use them. That single property is what all three bugs would have failed.
 */

/** An image element that has been fetched, decoded, and allowed to paint. */
async function decodedWidths(page: import("@playwright/test").Page, selector: string) {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => {
      const img = node as HTMLImageElement;
      return { src: img.currentSrc || img.src, width: img.naturalWidth };
    }),
  );
}

test("every search result photo decodes in the browser", async ({ page }) => {
  /*
   * ⚠️ Requests to the optimizer are recorded rather than assumed absent. Reintroducing
   * `next/image` is an easy and well-intentioned change — it is what the docs recommend — and it
   * silently breaks every photo here. Catching the request is more direct than catching the
   * blank image it produces.
   */
  const optimizerRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_next/image")) optimizerRequests.push(request.url());
  });

  await page.goto(`${SITE_URL}/search`);

  const cards = page.locator('a[href^="/listings/"]');
  await expect(cards.first()).toBeVisible();

  /* Below-the-fold photos are lazy by design (the LCP budget is 2.5s), so they are not fetched
   * until they scroll into view. Scrolling makes the whole grid a real assertion instead of a
   * test of the first row. */
  await page.mouse.wheel(0, 4000);
  await page.waitForLoadState("networkidle");

  const photos = await decodedWidths(page, 'img[src*="/api/media/"]');
  expect(photos.length, "no listing photos on /search at all").toBeGreaterThan(0);

  const blank = photos.filter((p) => p.width === 0);
  expect(
    blank,
    "these images were in the DOM but the browser never painted them — check CORP, the media " +
      "host, and whether next/image crept back in",
  ).toEqual([]);

  expect(optimizerRequests, "photos must not go through the Next image optimizer").toEqual([]);
});

test("a listing hero is served from our own variants, not re-encoded", async ({ page }) => {
  await page.goto(`${SITE_URL}/search`);
  await page.locator('a[href^="/listings/"]').first().click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);

  const hero = page.locator('img[src*="/api/media/"]').first();
  await expect(hero).toBeVisible();

  /*
   * The three widths the API generates at upload. Their presence is what makes dropping the
   * optimizer a real improvement rather than a regression — without a srcset the browser would
   * pull the 1600px hero onto a phone.
   */
  const srcset = await hero.getAttribute("srcset");
  expect(srcset, "no srcset — the wire contract stopped carrying variants").toBeTruthy();
  expect(srcset).toContain("400w");
  expect(srcset).toContain("800w");
  expect(srcset).toContain("1600w");

  await expect
    .poll(async () => (await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)) as number)
    .toBeGreaterThan(0);
});

test("photos are embeddable cross-origin", async ({ page, request }) => {
  /*
   * ⚠️ Asserted at the header level as well as visually, because this is the one bug that will
   * come back. `helmet()` sets CORP globally to same-origin; the media routes opt out. Anyone
   * adding a new media route, or "tidying" the helmet config, reintroduces it — and the visual
   * test above only catches it once a listing with a photo exists on the page it happens to load.
   */
  await page.goto(`${SITE_URL}/search`);
  const src = await page.locator('img[src*="/api/media/"]').first().getAttribute("src");
  expect(src).toBeTruthy();

  const response = await request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(
    response.headers()["cross-origin-resource-policy"],
    "same-origin here means the browser will refuse to render this on the site",
  ).toBe("cross-origin");
});
