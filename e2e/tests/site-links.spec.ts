import { expect, test } from "@playwright/test";

import { SITE_URL } from "../support/env";

/**
 * Every internal link on the public site resolves.
 *
 * ⚠️ WRITTEN BECAUSE THE SITE HEADER POINTED AT A 404 ON EVERY SINGLE PAGE. The India pivot
 * renamed the route from `/neighborhoods` to `/localities` and the nav was missed, so the second
 * item in the main navigation — on the home page, on every listing, everywhere — was dead. The
 * build passed, every other test passed, and nothing in the codebase could have noticed: a
 * `<Link href>` to a route that does not exist is valid TypeScript and valid JSX.
 *
 * That is the cheapest possible bug to catch and the most embarrassing one to ship, so it gets a
 * crawl rather than an assertion about one link. A crawl also covers what a per-link test never
 * would: the next rename.
 *
 * ⚠️ SERVER-RENDERED HREFS ONLY. The crawl reads HTML rather than driving a browser, which means
 * it sees links a crawler and a no-JS visitor see — exactly the set that matters for SEO, and the
 * set the sitemap should agree with. Client-rendered navigation is out of scope here and covered
 * by the flows in the other specs.
 */

/** Matches `href="/x"` in SSR markup and `href=\"/x\"` inside the RSC flight payload. */
const HREF = /href=\\?"(\/[^"\\?#]*)/g;

/**
 * ⚠️ PACED, AND A 429 IS RETRIED RATHER THAN COUNTED AS A BROKEN LINK.
 *
 * Each page here triggers one or two server-side API calls, and the API throttles at 10 requests
 * per SECOND per IP — which on a dev machine is every process at once. An unpaced crawl of forty
 * pages sails past that, the site's own fetch fails, and the page renders `notFound()`. The first
 * run of this test duly reported three listing pages as 404s that were serving perfectly well a
 * second later.
 *
 * A rate limit is not a broken link, and a test that conflates them would send someone hunting a
 * bug that does not exist — so the two are told apart explicitly.
 */
async function fetchPaced(request: import("@playwright/test").APIRequestContext, path: string) {
  let response = await request.get(`${SITE_URL}${path}`, { maxRedirects: 5 });

  if (response.status() === 429) {
    // One full limiter window, then try again. Still throttled after that is a real problem.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    response = await request.get(`${SITE_URL}${path}`, { maxRedirects: 5 });
  }

  // Roughly four pages a second, which keeps the API calls behind them under the limit.
  await new Promise((resolve) => setTimeout(resolve, 250));
  return response;
}

test("no internal link on the public site 404s", async ({ request }) => {
  test.setTimeout(120_000);
  const seen = new Set<string>();
  const queue: string[] = ["/"];
  const broken: string[] = [];
  /* Kept so a failure names the page to go and fix, not just the dead URL. */
  const linkedFrom = new Map<string, string>();

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const response = await fetchPaced(request, path);
    if (!response.ok()) {
      broken.push(`${response.status()}  ${path}  (linked from ${linkedFrom.get(path) ?? "—"})`);
      continue;
    }

    for (const match of (await response.text()).matchAll(HREF)) {
      let href = match[1]!;
      if (href.length > 1) href = href.replace(/\/$/, "");
      /* Next's own assets, and the API routes, which are not pages. */
      if (href.startsWith("/_next") || href.startsWith("/api") || href === "") continue;
      if (!linkedFrom.has(href)) linkedFrom.set(href, path);
      if (!seen.has(href) && !queue.includes(href)) queue.push(href);
    }
  }

  /* A sanity floor: if the crawl only ever saw the home page the regex has drifted and this test
   * is passing while checking nothing. */
  expect(seen.size, "the crawl found almost no pages — the href pattern has probably drifted")
    .toBeGreaterThan(20);

  expect(broken, `broken internal links:\n${broken.join("\n")}`).toEqual([]);
});

test("the old US-era neighbourhood URLs redirect instead of 404ing", async ({ request }) => {
  /*
   * Both spellings. The route is `/localities`, but "neighborhood" is what the US build called it
   * and what someone guessing a URL is likely to type — and half of them will type the U.
   * Permanent (308) so a crawler moves any accumulated authority rather than indexing both.
   */
  for (const path of ["/neighborhoods", "/neighbourhoods"]) {
    const response = await request.get(`${SITE_URL}${path}`, { maxRedirects: 0 });
    expect(response.status(), `${path} should redirect`).toBe(308);
    expect(response.headers()["location"]).toContain("/localities");
  }

  /* Deep paths carry through, so an old link to a specific area guide still lands on it. */
  const deep = await request.get(`${SITE_URL}/neighborhoods/mohali/phase-7`, { maxRedirects: 0 });
  expect(deep.status()).toBe(308);
  expect(deep.headers()["location"]).toContain("/localities/mohali/phase-7");
});

/**
 * ⚠️ A locality WITHOUT hand-written content is a 404 ON PURPOSE, and that is a content-strategy
 * decision rather than a gap.
 *
 * There are 102 localities and 8 guides. Generating the other 94 from a template would produce
 * near-identical thin pages, which reads to a search engine as doorway spam and damages the whole
 * domain — so `generateStaticParams` and the sitemap both iterate only the ones with real copy.
 * The rest stay searchable and linked from the city hub; they just do not get a page.
 *
 * This test exists so that if someone "fixes" the 404 by rendering a template, they have to
 * confront the reason first.
 */
test("a locality with no editorial content is deliberately not a page", async ({ request }) => {
  const withContent = await request.get(`${SITE_URL}/localities/chandigarh/sector-35`);
  expect(withContent.status(), "Sector 35 has a written guide and should render").toBe(200);

  const withoutContent = await request.get(`${SITE_URL}/localities/chandigarh/sector-22`);
  expect(
    withoutContent.status(),
    "Sector 22 has no written guide — a templated page here would be thin content",
  ).toBe(404);

  /* And nothing links to it, so the 404 is unreachable by clicking — which is what makes it
   * acceptable. The crawl above enforces that globally; this is the specific case. */
  const hub = await request.get(`${SITE_URL}/localities/chandigarh`);
  expect(await hub.text()).not.toContain('href="/localities/chandigarh/sector-22"');
});
