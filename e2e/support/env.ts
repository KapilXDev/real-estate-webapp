import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Where the running stack lives, and how to reach the database behind it.
 *
 * ⚠️ THESE TESTS RUN AGAINST THE DEV STACK, NOT A DISPOSABLE ONE. That is a deliberate trade and
 * the opposite of what `apps/api/test` does. The integration suite clones a template database per
 * file because it asserts things about the SCHEMA — RLS policies, CHECK constraints — and needs
 * to be able to leave the database in any state. These tests assert things about the BROWSER, and
 * everything they exercise (a photo actually decoding, a cookie actually being resent, a publish
 * actually reaching the public site) requires the real three-process stack wired together exactly
 * as the agent uses it. Standing up a second Postgres, API, site and admin on other ports to buy
 * isolation would double the moving parts to test the wiring between them, which is the thing
 * under test.
 *
 * The price is that isolation has to be earned by discipline instead of by `CREATE DATABASE`:
 * every row these tests create carries the marker in `marker.ts`, and `db.ts` removes exactly
 * those rows and nothing else. See the warning there before widening any DELETE.
 */

/** Marks the repo root: the workspace root package.json, which no sub-package has. */
function isRepoRoot(dir: string): boolean {
  const pkg = path.join(dir, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    return Array.isArray(JSON.parse(readFileSync(pkg, "utf8")).workspaces);
  } catch {
    return false;
  }
}

export function repoRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate the repo root from " + __dirname);
    dir = parent;
  }
}

let loaded = false;

/**
 * Load the repo-root `.env`.
 *
 * Deliberately a copy of `apps/api/src/config/load-env.ts` rather than an import of it: reaching
 * across into another app's source would breach the module boundaries in
 * `.eslintrc.boundaries.json`, and it is eight lines. Same rule as there — EXISTING VALUES WIN,
 * so a variable already exported in the shell (or injected by CI) is never clobbered by the file.
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(repoRoot(), ".env");
  if (!existsSync(envPath)) return;

  for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, "utf8")))) {
    if (process.env[key] === undefined && typeof value === "string") {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

/** The buyer-facing site. */
export const SITE_URL = process.env.E2E_SITE_URL ?? "http://localhost:3000";
/** The API. Hit directly only to assert what an ANONYMOUS caller can see. */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001/api";
/** The staff tool — the subject of most of these tests. */
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3002";

/**
 * ⚠️ The OWNER connection, used only by `db.ts` for setup and cleanup.
 *
 * Never point a test's assertions at this. It is a superuser in local Docker, so it IGNORES
 * row-level security entirely — asserting "the row is invisible" through this connection would
 * pass against a schema with no isolation at all. Anything about visibility must be asserted
 * through the API, as an actual anonymous or authenticated caller.
 */
export function ownerDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set, so the browser tests cannot clean up after themselves.\n" +
        "It lives in the repo-root .env — see .env.example.",
    );
  }
  return url;
}

/**
 * Dev staff credentials.
 *
 * There is no staff registration route by design, so these come from `npm run db:bootstrap`.
 * Overridable because the same suite should run against a CI database seeded with its own owner.
 */
export const STAFF = {
  email: process.env.E2E_STAFF_EMAIL ?? "owner@tricityestate.test",
  password: process.env.E2E_STAFF_PASSWORD ?? "dev-owner-password-123",
};

/**
 * A SECOND organisation, holding no RERA registrations at all.
 *
 * ⚠️ WHY A SECOND TENANT EXISTS PURELY FOR ONE TEST. The RERA publication gate can only be
 * observed by trying to publish into a jurisdiction the organisation is NOT registered in, and
 * the dev organisation is registered in both jurisdictions that are reachable through the UI:
 * Punjab and Chandigarh. Haryana is deliberately left unregistered so the gate can be
 * demonstrated by hand — but `@tricity/geo` has no Panchkula localities, so no listing can
 * actually be created there, and the gate is unreachable from the form. (Worth fixing; noted in
 * the build log.)
 *
 * The alternatives were both worse. Deleting or expiring the dev organisation's Chandigarh
 * registration for the duration of a test mutates the single most compliance-sensitive record in
 * the system, and a crashed run would leave a real registration marked expired — which the API
 * treats as absent, silently blocking the agent from publishing. Skipping the negative path
 * would leave the gate itself untested, and the gate is the reason RERA is enforced in code at
 * all.
 *
 * So the gate test signs in as a different tenant with an empty compliance record and never
 * touches the agent's. As a bonus it exercises the multi-tenant path for real: this organisation
 * is not `is_host`, so it also proves a partner broker can hold inventory.
 */
export const E2E_ORG = {
  name: "E2E Gate Firm",
  slug: "e2e-gate-firm",
  email: "gate-owner@e2e.invalid",
  fullName: "E2E Gate Owner",
  password: "e2e-gate-password-123",
};
