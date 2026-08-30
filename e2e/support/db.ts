import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import postgres from "postgres";

import { E2E_ORG, ownerDatabaseUrl, repoRoot } from "./env";
import { E2E_EMAIL_DOMAIN, E2E_PREFIX } from "./marker";

/**
 * Setup and teardown against the dev database.
 *
 * ⚠️⚠️ EVERY STATEMENT IN THIS FILE IS SCOPED BY THE E2E MARKER, AND THAT IS NOT NEGOTIABLE.
 *
 * These tests share a database with the agent's real inventory (see `env.ts` for why). A DELETE
 * here that is not anchored to `[E2E]` or the reserved e2e.invalid email domain can destroy work
 * that has no backup — there is one machine and, as of this writing, no remote. `TRUNCATE`,
 * `DELETE FROM listing` with no predicate, and "just drop the test org" are all wrong for the
 * same reason. `seed/demo-listings.ts` takes exactly this approach with `[SAMPLE]`, for exactly
 * this reason.
 *
 * ⚠️ ALSO: THIS CONNECTION IS THE OWNER, WHICH IS A SUPERUSER LOCALLY, SO IT BYPASSES RLS. Use it
 * to arrange and to clean up, never to assert. "The anonymous caller cannot see this" has to be
 * asserted by being an anonymous caller — through the API — or it asserts nothing.
 */

function connect() {
  // max: 1 — this runs in global setup/teardown, not under load, and a single connection makes
  // the statement order below actually sequential.
  return postgres(ownerDatabaseUrl(), { max: 1, onnotice: () => {} });
}

export interface CleanupSummary {
  listings: number;
  leads: number;
  contacts: number;
  reraRegistrations: number;
}

/**
 * Remove everything the browser tests created.
 *
 * Run at the START of a run as well as the end: a crashed or cancelled run leaves rows behind,
 * and the next run would then find two listings matching its search and fail for a reason that
 * has nothing to do with the code.
 */
export async function cleanupE2EData(): Promise<CleanupSummary> {
  const sql = connect();
  try {
    /*
     * Order matters. `lead.listing_id` is ON DELETE SET NULL and `lead.contact_id` likewise, so
     * leads must go before contacts or the contact delete is blocked by nothing and simply leaves
     * orphaned leads pointing at nobody. `lead_activity` and `listing_media` both CASCADE.
     */
    /*
     * Matched on the message marker as well as on the contact, deliberately. An enquiry is
     * attached to an existing contact when the PHONE matches — so if a test ever reuses a number
     * that already belongs to somebody, its lead hangs off a real contact and the email-domain
     * predicate below would never find it. The marker in the message is the backstop that keeps
     * a stray test enquiry out of the agent's follow-up queue.
     */
    const leads = await sql`
      DELETE FROM lead
       WHERE contact_id IN (
         SELECT id FROM contact WHERE primary_email LIKE ${"%@" + E2E_EMAIL_DOMAIN}
       )
          OR message LIKE ${"%" + E2E_PREFIX + "%"}
       RETURNING id
    `;

    const contacts = await sql`
      DELETE FROM contact
       WHERE primary_email LIKE ${"%@" + E2E_EMAIL_DOMAIN}
       RETURNING id
    `;

    /*
     * Properties are deliberately left behind, matching `demo-listings.ts`: a property is a
     * physical record that other things may reference, and `listing.property_id` is ON DELETE
     * RESTRICT precisely to stop a listing cleanup from taking one with it. They are invisible
     * without a listing, so the cost is a few stranded rows in a dev database.
     */
    const listings = await sql`
      DELETE FROM listing
       WHERE title LIKE ${E2E_PREFIX + "%"}
       RETURNING id
    `;

    /*
     * ⚠️ RERA registrations are matched on the registration NUMBER carrying the marker, not on
     * the state. The dev organisation genuinely holds Punjab and Chandigarh registrations and
     * deliberately holds no Haryana one, so that the publication gate can be demonstrated. A
     * cleanup keyed on `state = 'Haryana'` would delete a real registration the day the agent
     * adds one, and the failure would look like the API losing data.
     */
    const rera = await sql`
      DELETE FROM organization_rera
       WHERE registration_no LIKE ${E2E_PREFIX + "%"}
       RETURNING id
    `;

    return {
      listings: listings.length,
      leads: leads.length,
      contacts: contacts.length,
      reraRegistrations: rera.length,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Fail loudly if the stack is pointed at something that is not a dev database.
 *
 * Cheap insurance against the day someone exports a staging DATABASE_URL in their shell and runs
 * the browser suite. The tests would create and delete rows in it and mostly pass.
 */
export function assertDevDatabase(): void {
  const url = new URL(ownerDatabaseUrl());
  const local = ["localhost", "127.0.0.1", "::1", "postgres"];
  if (!local.includes(url.hostname)) {
    throw new Error(
      `Refusing to run the browser tests against a non-local database (${url.hostname}).\n` +
        "They create and delete rows in whatever DATABASE_URL points at.",
    );
  }
}

/**
 * The RERA jurisdictions the organisation is currently registered in.
 *
 * The publication-gate test needs to know that Haryana is genuinely absent before it asserts that
 * publishing into Haryana is blocked — otherwise a passing test might just mean the registration
 * was there all along and something else failed.
 */
export async function registeredReraStates(): Promise<string[]> {
  const sql = connect();
  try {
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM organization_rera
       WHERE valid_until IS NULL OR valid_until >= current_date
       ORDER BY state
    `;
    return rows.map((r) => r.state);
  } finally {
    await sql.end();
  }
}

/**
 * Make sure the gate-test organisation exists.
 *
 * Created by shelling out to the documented `npm run db:bootstrap` rather than by inserting rows
 * here. There is no staff registration route by design, so that command is the ONLY supported way
 * an organisation and its first owner come into existence — reimplementing it in the test harness
 * would duplicate the argon2 parameters and drift the day they are tuned.
 *
 * Guarded by an existence check because bootstrap deliberately refuses to touch an account that
 * already exists (it does not reset passwords), so a second run would fail on the unique email.
 *
 * ⚠️ This organisation is NOT removed by cleanup, on purpose. Recreating it costs an argon2 hash
 * and a subprocess on every run, and an empty organisation with no listings is invisible: it is
 * not `is_host`, so it appears on no page of the public site. Its listings are cleaned like every
 * other marked row.
 */
export async function ensureGateOrganisation(): Promise<{ created: boolean }> {
  const sql = connect();
  try {
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM app_user WHERE email = ${E2E_ORG.email}
    `;
    if (existing) return { created: false };
  } finally {
    await sql.end();
  }

  await new Promise<void>((resolve, reject) => {
    /*
     * ⚠️ SHELL, WITH THE ARGUMENTS QUOTED BY HAND. Both obvious alternatives fail on Windows:
     * `spawn("npm", …)` cannot exec a `.cmd` shim, and `spawn("npm.cmd", …)` without a shell is
     * refused outright by Node >= 20 with EINVAL (the fix for CVE-2024-27980). So a shell it is —
     * and with `shell: true` Node concatenates the argument array WITHOUT quoting, which turned
     * `--org E2E Gate Firm` into three positional arguments and made bootstrap reject its own
     * input. Quoting here is what keeps a value with a space in it intact.
     */
    const args = [
      "run",
      "db:bootstrap",
      "--",
      "--email",
      E2E_ORG.email,
      "--name",
      E2E_ORG.fullName,
      "--org",
      E2E_ORG.name,
      "--org-slug",
      E2E_ORG.slug,
      "--password",
      E2E_ORG.password,
    ].map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));

    const child = spawn(`npm ${args.join(" ")}`, {
      cwd: repoRoot(),
      shell: true,
      stdio: "pipe",
    });

    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`db:bootstrap failed (exit ${code}) while creating the gate org:
${output}`));
    });
  });

  return { created: true };
}

/**
 * Remove only the RERA registrations this suite created.
 *
 * Called between files as well as at teardown, because the gate tests assert on an EMPTY
 * compliance record — "publishing is blocked" is only true until one of them registers a
 * jurisdiction. Scoped to the marked registration number so it can never touch a real one.
 */
export async function deleteMarkedReraRegistrations(): Promise<number> {
  const sql = connect();
  try {
    const rows = await sql`
      DELETE FROM organization_rera
       WHERE registration_no LIKE ${E2E_PREFIX + "%"}
       RETURNING id
    `;
    return rows.length;
  } finally {
    await sql.end();
  }
}

/**
 * Age a refresh token's rotation timestamp, so a replay lands OUTSIDE the grace window.
 *
 * ⚠️ The alternative was `await new Promise(r => setTimeout(r, 11_000))` in a suite that
 * otherwise runs in thirty seconds — and a sleep long enough to be correct today silently stops
 * being long enough the moment someone raises `REFRESH_ROTATION_GRACE_SECONDS`. Backdating tests
 * the same branch deterministically and instantly.
 *
 * Matched on the SHA-256 of the raw token, because the raw value is deliberately never stored.
 */
export async function ageRefreshTokenUse(rawToken: string, seconds: number): Promise<void> {
  const hash = createHash("sha256").update(rawToken).digest("hex");
  const sql = connect();
  try {
    const rows = await sql`
      UPDATE refresh_token
         SET used_at = used_at - make_interval(secs => ${seconds})
       WHERE token_hash = ${hash}
         AND used_at IS NOT NULL
      RETURNING id
    `;
    if (rows.length !== 1) {
      throw new Error(
        `Expected exactly one used refresh_token row to age, found ${rows.length}. ` +
          "The token was probably never rotated.",
      );
    }
  } finally {
    await sql.end();
  }
}
