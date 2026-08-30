import { expect, test } from "@playwright/test";

import { ADMIN_URL, STAFF } from "../support/env";

/**
 * Silent token refresh, and the rotation bug it was built to avoid.
 *
 * ⚠️ THE BUG THIS GUARDS IS THE HARDEST ONE IN THE ADMIN, AND IT IS INVISIBLE FOR 13 MINUTES.
 *
 * Refresh tokens ROTATE, and a Server Component render CANNOT WRITE COOKIES. The obvious design —
 * refresh lazily inside the API client when a call 401s — therefore consumes the old refresh
 * token and throws the replacement away, because Next forbids the cookie write during a render.
 * The *next* request then presents a token the API has already seen, the API correctly treats
 * that as theft, and it revokes the entire token family. The user is signed out everywhere, about
 * fifteen minutes after they last did anything, and the request that fails is not the request
 * that caused it.
 *
 * That is why refresh lives in `proxy.ts`, which runs before rendering and can write both the
 * incoming request's cookies and the outgoing response's.
 *
 * ⚠️ HOW THIS IS TESTED WITHOUT WAITING 13 MINUTES: the access cookie is deleted while the
 * refresh cookie is kept. That is exactly the state the browser is in once the access cookie
 * expires — its 13-minute lifetime is deliberately shorter than the JWT's 15 — so the proxy takes
 * the same branch it would take then.
 *
 * ⚠️ AND WHY THIS FILE SIGNS IN FOR ITSELF instead of using the shared session: it deliberately
 * rotates the refresh token. Every other test loads the same saved `storageState`, so rotating
 * the token they hold would hand them a revoked one — a suite-wide failure whose cause is in a
 * different file. Its own login means its own token family.
 */

const ACCESS_COOKIE = "tricity_access";
const REFRESH_COOKIE = "tricity_refresh";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * ⚠️ CALLED BY THE TESTS THAT NEED A SESSION, NOT FROM `beforeEach`. Staff login is rate limited
 * to 10 per minute per IP and the entire suite is a single IP on a dev machine, so signing in for
 * tests that deliberately start signed out wasted two of that budget and a later login 429'd —
 * which looks exactly like a broken login page.
 */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel("Email").fill(STAFF.email);
  await page.getByLabel("Password").fill(STAFF.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${ADMIN_URL}/listings`);
}

/** Simulates the access cookie reaching its 13-minute expiry, leaving only the refresh cookie. */
async function expireAccessToken(context: import("@playwright/test").BrowserContext) {
  const kept = (await context.cookies()).filter((c) => c.name !== ACCESS_COOKIE);
  await context.clearCookies();
  await context.addCookies(kept);

  const names = (await context.cookies()).map((c) => c.name);
  expect(names, "the refresh cookie must survive — otherwise this tests the logout path").toContain(
    REFRESH_COOKIE,
  );
  expect(names).not.toContain(ACCESS_COOKIE);
}

test("an expired access token is refreshed without the agent noticing", async ({
  page,
  context,
}) => {
  await signIn(page);

  await expireAccessToken(context);

  await page.goto(`${ADMIN_URL}/listings`);

  /*
   * Not redirected to /login is the first half. The second half is that the page actually
   * RENDERED — the proxy has to rewrite the incoming request's cookies too, not just the
   * response's, or this render still has no access token and 401s its way to the login page. A
   * refresh that "works" and leaves the current page broken is the exact bug that shape produces.
   */
  await expect(page).toHaveURL(`${ADMIN_URL}/listings`);
  await expect(page.getByRole("heading", { name: "Listings", level: 1 })).toBeVisible();

  const names = (await context.cookies()).map((c) => c.name);
  expect(names, "the browser was never given a new access cookie").toContain(ACCESS_COOKIE);
});

test("the rotated refresh token is persisted, so a second refresh also works", async ({
  page,
  context,
}) => {
  await signIn(page);

  /*
   * ⚠️ THIS IS THE ACTUAL REGRESSION TEST. One refresh passes even in the broken design — the
   * exchange succeeds and the page renders. The damage is that the ROTATED token was discarded,
   * which only surfaces on the NEXT refresh, when the browser presents a token the API has
   * already retired and the whole family is revoked as theft.
   *
   * So: refresh twice. If the replacement was not written back to the browser, the second
   * navigation lands on /login.
   */
  await expireAccessToken(context);
  await page.goto(`${ADMIN_URL}/listings`);
  await expect(page.getByRole("heading", { name: "Listings", level: 1 })).toBeVisible();

  const afterFirst = (await context.cookies()).find((c) => c.name === REFRESH_COOKIE)?.value;

  await expireAccessToken(context);
  await page.goto(`${ADMIN_URL}/leads`);

  await expect(
    page,
    "signed out on the second refresh — the rotated token was not written back, so the API saw " +
      "a replayed one and revoked the family",
  ).toHaveURL(`${ADMIN_URL}/leads`);
  await expect(page.getByRole("heading", { name: "Enquiries", level: 1 })).toBeVisible();

  const afterSecond = (await context.cookies()).find((c) => c.name === REFRESH_COOKIE)?.value;
  expect(afterFirst, "the refresh token did not rotate — reuse detection is doing nothing").not.toBe(
    afterSecond,
  );
});

test("concurrent requests after expiry do not revoke the session", async ({ page, context }) => {
  await signIn(page);

  /*
   * ⚠️⚠️ KNOWN BUG — REMOVE `test.fail()` WHEN IT IS FIXED. MEASURED, NOT SUSPECTED:
   *
   *     N=2  1 of 2 requests bounced to /login, session DEAD afterwards
   *     N=3  2 of 3 bounced,                    session DEAD
   *     N=6  5 of 6 bounced,                    session DEAD
   *
   * TWO concurrent requests are enough. The single-flight in `proxy.ts` only collapses requests
   * that arrive while an exchange is still running; a straggler that arrives just after it
   * completes still carries the OLD refresh cookie, because the browser has not yet seen the
   * response that replaces it. The API sees a token it has already rotated, correctly treats it
   * as theft, and revokes the whole family — signing the agent out everywhere.
   *
   * In practice: an agent with two tabs open, idle past the 13-minute access-cookie lifetime, is
   * logged out of both the next time anything touches the server. That is the same class of bug
   * step 17 fixed, arrived at from a different direction.
   *
   * The usual remedy is a rotation grace interval: for a few seconds after rotating, a
   * presentation of the old token returns the SAME replacement instead of revoking. Auth0 and
   * Okta both do this. It can live in `proxy.ts` (cache old→new briefly) or in the API next to
   * reuse detection, which is the more correct home — a design call, so it is reported rather
   * than patched here.
   */
  test.fail(true, "two concurrent requests after access-token expiry revoke the refresh family");

  /*
   * ⚠️ THE RACE THAT FOUND THE BUG ON ITS FIRST RUN: eight parallel requests all returned 200,
   * and then the very next request 500'd with a dead session. Every individual response looked
   * fine, which is why the single-flight in `proxy.ts` is keyed on the refresh token rather than
   * held in a module-level variable — a single variable would also serialise refreshes across
   * different users sharing the process, and one could receive the other's tokens.
   *
   * The assertion that matters is therefore the one AFTER the storm, not the storm itself.
   */
  await expireAccessToken(context);

  const pages = await Promise.all([page, ...Array.from({ length: 5 }, () => context.newPage())]);
  const responses = await Promise.all(
    pages.map((p) => p.goto(`${ADMIN_URL}/listings`, { waitUntil: "domcontentloaded" })),
  );

  for (const response of responses) {
    expect(response?.status(), "a parallel request failed outright").toBeLessThan(400);
  }
  for (const p of pages) {
    expect(p.url(), "a parallel request was bounced to login").toBe(`${ADMIN_URL}/listings`);
  }

  /* The one that used to 500. */
  await page.goto(`${ADMIN_URL}/leads`);
  await expect(
    page.getByRole("heading", { name: "Enquiries", level: 1 }),
    "the session died on the request AFTER the concurrent ones — the classic shape of a " +
      "refresh-token race",
  ).toBeVisible();
});

test("no session at all lands on the login page, with a way back", async ({ page, context }) => {
  await context.clearCookies();

  await page.goto(`${ADMIN_URL}/listings?status=ACTIVE`);

  await expect(page).toHaveURL(/\/login\?from=/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  /*
   * ⚠️ `from` is a PATH ONLY. A crafted link could set it to `//evil.example`, which most routers
   * treat as absolute — turning the login page into an open redirect for phishing. The login form
   * rejects anything not starting with a single slash.
   */
  const from = new URL(page.url()).searchParams.get("from");
  expect(from).toBe("/listings?status=ACTIVE");
});

test("a crafted `from` cannot redirect off-site after login", async ({ page, context }) => {
  await context.clearCookies();

  /*
   * ⚠️ `//evil.example` is a PROTOCOL-RELATIVE URL. It looks like a path and most routers treat it
   * as absolute, so a login link mailed to an agent could take them somewhere else the instant
   * they authenticate — with a fresh session in hand. The form rejects anything that does not
   * start with a single slash and falls back to /listings.
   */
  await page.goto(`${ADMIN_URL}/login?from=${encodeURIComponent("//evil.example/steal")}`);
  await page.getByLabel("Email").fill(STAFF.email);
  await page.getByLabel("Password").fill(STAFF.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(`${ADMIN_URL}/listings`);
});
