import { defineConfig, devices } from "@playwright/test";

import { ADMIN_URL, API_URL, SITE_URL } from "./support/env";

/**
 * Browser tests for the admin tool and the buyer site.
 *
 * ⚠️ WHY THIS SUITE EXISTS AT ALL, given 170 passing integration tests: the last three bugs
 * shipped in this repo were all invisible to every one of them.
 *
 *   - `Cross-Origin-Resource-Policy: same-origin` from helmet() blocked every listing photo. The
 *     header is enforced by the BROWSER, so curl, fetch-in-node and the API's own tests all saw a
 *     perfectly good image.
 *   - `next/image` rejected the media host and returned 400 for every photo. The page still
 *     rendered, just blank where the pictures were.
 *   - Publishing a listing did not show up on the site for 60 seconds, because of a cache tag.
 *     Every API call involved was correct.
 *
 * The common shape is that the server was right and the product was broken. That gap is only
 * observable from something that parses HTML, applies response headers, runs JavaScript and keeps
 * cookies — so these tests assert on the rendered result, not on status codes, and prefer
 * `naturalWidth > 0` over `response.ok`.
 *
 * ⚠️ NOT part of `npm test`. This package has no `test` script on purpose, so `nx run-many -t
 * test` skips it: the integration suite is hermetic and runs in ~2s, and folding a suite that
 * needs Docker plus three servers into the same command would make the fast one feel slow and
 * unreliable. Run it with `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.ts",
  globalTeardown: "./support/global-teardown.ts",

  /* Next dev compiles a route the first time it is requested; the first hit on a cold server is
   * genuinely slow, and a tight timeout here just produces flakes on the first test of a run. */
  timeout: 90_000,
  expect: { timeout: 15_000 },

  fullyParallel: true,
  /* ⚠️ No `.only` reaches CI — it would silently reduce the suite to one test while reporting
   * green. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  /*
   * ⚠️ ONE WORKER, AND NOT OUT OF CAUTION — THE API'S RATE LIMITER MAKES PARALLELISM UNSOUND HERE.
   *
   * The throttler is keyed on client IP and allows 10 requests per SECOND. On a dev machine every
   * participant shares 127.0.0.1: the site's server-side fetches, the admin's server-side fetches,
   * the browser's image requests and the tests' own calls all draw from the same bucket. Three
   * workers reliably exhausted it, and a throttled fetch inside a Server Component does not throw
   * — `apiGet` returns null and the page renders its empty state. The test then fails with
   * "listing did not reach the site", which is a completely false accusation.
   *
   * In production these are different clients on different addresses, so this is a property of
   * the dev topology rather than of the product. Fixing it properly would mean making the limits
   * configurable per environment; until then, serial.
   */
  workers: 1,

  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    ...devices["Desktop Chrome"],
    /* No baseURL. Tests span three origins and a bare `page.goto("/listings")` would leave the
     * reader guessing which app it means — every navigation names its app explicitly. */
    navigationTimeout: 45_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    /* The admin runs on plain http in dev and the session cookies are not `secure`; nothing here
     * needs a real certificate. */
    ignoreHTTPSErrors: true,
  },

  projects: [
    /* Signs in once through the real login form and saves the cookies. Everything else starts
     * signed in, because re-typing the password in forty tests asserts nothing after the first. */
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { storageState: "./.auth/staff.json" },
      dependencies: ["setup"],
    },
  ],

  /*
   * ⚠️ `reuseExistingServer` is on outside CI, so a dev server you already have running is used
   * as-is and is NOT killed when the run finishes. Restarting the servers under someone who is
   * mid-session would be hostile, and Next dev servers take long enough to warm up that starting
   * fresh ones per run would dominate the wall clock.
   *
   * Docker is not managed here. If Postgres or MinIO are down the API fails to boot and the error
   * below points at `npm run db:up`, which is a better message than a connection refused.
   */
  webServer: [
    {
      command: "npm run api:dev",
      cwd: "..",
      url: `${API_URL}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run web:dev",
      cwd: "..",
      url: SITE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run admin:dev",
      cwd: "..",
      /* /login is the one admin route that renders without a session — anything else redirects,
       * and Playwright would be waiting on a 307. */
      url: `${ADMIN_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
