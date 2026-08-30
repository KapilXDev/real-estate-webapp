import { expect, test as setup } from "@playwright/test";

import { ADMIN_URL, E2E_ORG, STAFF } from "../support/env";

const STATE_FILE = "./.auth/staff.json";
const GATE_STATE_FILE = "./.auth/gate.json";

/**
 * Sign in once, through the real form, and save the session for every other test.
 *
 * ⚠️ THIS IS ALSO THE LOGIN TEST. It is not a shortcut past the UI — no token is minted here and
 * no cookie is forged. It types the credentials, submits, and asserts it landed somewhere only a
 * signed-in user can reach. If login breaks, this fails first and the whole suite reports one
 * honest failure instead of forty confusing ones.
 *
 * ⚠️ EVERY OTHER TEST SHARES THIS REFRESH TOKEN, WHICH CONSTRAINS WHAT THEY MAY DO WITH IT.
 * Refresh tokens rotate and the API treats a replayed one as theft, revoking the whole family. So
 * a test that deliberately triggers a refresh must sign in for itself rather than rotate the
 * token three parallel workers are still holding — see `session-refresh.spec.ts`, which does
 * exactly that and says so.
 */
setup("sign in as staff", async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);

  await page.getByLabel("Email").fill(STAFF.email);
  await page.getByLabel("Password").fill(STAFF.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Landing on /listings is the assertion: the proxy gate only lets a session through, and the
  // page itself is a Server Component that calls the API with the access token.
  await page.waitForURL(`${ADMIN_URL}/listings`);
  await expect(page.getByRole("heading", { name: "Listings", level: 1 })).toBeVisible();

  await page.context().storageState({ path: STATE_FILE });
});

/**
 * The gate organisation's session — a second tenant with an empty RERA record.
 *
 * ⚠️ SAVED ONCE RATHER THAN SIGNED IN PER TEST, BECAUSE LOGIN IS RATE LIMITED TO 10 PER MINUTE
 * PER IP. On a dev machine the whole suite is one IP, so four tests each signing in for
 * themselves pushed the run past the limit and a later login 429'd — which surfaces as "the login
 * page did nothing", an alarming and completely misleading failure. Sessions are cheap; logins
 * are not.
 */
setup("sign in as the gate organisation", async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel("Email").fill(E2E_ORG.email);
  await page.getByLabel("Password").fill(E2E_ORG.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(`${ADMIN_URL}/listings`);
  await page.context().storageState({ path: GATE_STATE_FILE });
});
