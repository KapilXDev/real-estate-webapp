import { randomBytes } from "node:crypto";
import postgres from "postgres";

import { loadEnvFile } from "../../src/config/load-env";
import { runMigrations } from "../../src/database/migrate";
import { seed } from "../../src/database/seed";

/**
 * Integration-test database provisioning.
 *
 * WHY NOT TESTCONTAINERS: it was the original plan, and it is the wrong trade here. These tests
 * assert things about the *schema* — RLS policies, SECURITY DEFINER functions, CHECK constraints
 * — so what they need is a real Postgres with our migrations on it, which the dev Compose stack
 * already provides. Testcontainers would add a heavyweight dependency and 5-15s of container
 * startup to buy an isolation guarantee this design gets for free from CREATE DATABASE. If CI
 * ever needs a container, it is one `services:` block in the workflow, not a code change:
 * everything below keys off DATABASE_URL.
 *
 * ⚠️ WHY A TEMPLATE DATABASE RATHER THAN MIGRATING PER SUITE: 12 migrations plus the 102-locality
 * seed take a few seconds. Paying that once per test FILE would dominate the run and push people
 * toward sharing one database between suites — which is exactly what must not happen here, since
 * an RLS test that leaves a stray organisation behind would silently change another test's
 * result. `CREATE DATABASE ... TEMPLATE` is a file copy: near-instant, so per-suite isolation
 * costs almost nothing and there is no incentive to cheat.
 *
 * ⚠️⚠️ WHICH ROLE THE TESTS CONNECT AS IS THE WHOLE BALLGAME. Read this before changing it.
 *
 * There are two, and they are not interchangeable:
 *
 *   OWNER (`DATABASE_URL`, `tricity`) — creates the databases and runs the migrations. In local
 *   Docker it is a SUPERUSER, because the postgres image makes POSTGRES_USER one.
 *
 *   RUNTIME (`APP_DATABASE_URL`, `tricity_app`) — what the API serves requests as, and what the
 *   per-suite client below connects as. NOSUPERUSER, NOBYPASSRLS.
 *
 * A superuser IGNORES row-level security completely: FORCE does not apply to it and no policy is
 * ever consulted. So a suite that connects as the owner passes against a schema with NO WORKING
 * TENANT ISOLATION AT ALL — it asserts nothing while looking thorough, which is worse than having
 * no test. Not hypothetical: it is exactly what the first run of `rls.spec.ts` caught, 11
 * failures deep, and it is why migration 0013 exists.
 *
 * Note the consequence: the runtime role is NOT the table owner, so it would be subject to
 * policies even if FORCE were removed. Behaviour alone can therefore no longer detect a missing
 * FORCE, which is why `rls.spec.ts` asserts `relforcerowsecurity` against `pg_class` directly.
 */

/** Guards every identifier we interpolate into DDL, since CREATE DATABASE cannot be parameterised. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Runtime connection: the least-privilege role the API actually uses. Tests use this. */
function requireAppDatabaseUrl(): URL {
  loadEnvFile();
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "APP_DATABASE_URL must be set to run integration tests.\n\n" +
        "The tests must connect as the same least-privilege role as the API. Connecting as the " +
        "owner (a superuser in local Docker) bypasses row-level security entirely, so the RLS " +
        "suite would pass against a completely unprotected schema.\n\n" +
        "  npm run db:migrate && npm run db:app-role",
    );
  }
  return new URL(raw);
}

/** Owner connection: creates/drops databases and runs migrations. */
function requireDatabaseUrl(): URL {
  loadEnvFile();
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL or DATABASE_URL must be set to run integration tests.\n" +
        "Start the dev database with `npm run db:up` and copy .env.example to .env.",
    );
  }
  return new URL(raw);
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

function withDatabase(url: URL, name: string): string {
  const next = new URL(url.toString());
  next.pathname = `/${encodeURIComponent(name)}`;
  return next.toString();
}

/**
 * Connection to the maintenance database.
 *
 * CREATE/DROP DATABASE cannot run while connected to the database in question, and cannot run
 * inside a transaction — hence a separate session and `unsafe` rather than a tagged template.
 */
function adminConnection(url: URL) {
  return postgres(withDatabase(url, "postgres"), { max: 1, onnotice: () => {} });
}

export function templateDatabaseName(): string {
  const base = databaseName(requireDatabaseUrl());
  const name = `${base}_test_template`;
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Refusing to use unsafe database name "${name}"`);
  }
  return name;
}

/**
 * Build (or rebuild) the migrated + seeded template. Runs ONCE per `vitest` invocation, from
 * globalSetup.
 *
 * Rebuilt from scratch every run rather than reused across runs: a stale template that predates
 * a new migration would give every suite a schema that does not match the code, and the failure
 * would look like a broken test rather than a stale artefact.
 */
export async function buildTemplateDatabase(): Promise<void> {
  const url = requireDatabaseUrl();
  const template = templateDatabaseName();
  const admin = adminConnection(url);

  try {
    await dropDatabase(admin, template);
    await admin.unsafe(`CREATE DATABASE "${template}"`);
  } finally {
    await admin.end();
  }

  const templateUrl = withDatabase(url, template);
  await runMigrations(templateUrl);
  await seed(templateUrl);
}

/**
 * Drop a database, evicting anything still attached to it.
 *
 * WITH (FORCE) exists from PG13 and is what makes this reliable: without it, a single leaked
 * connection from a previous suite turns the drop into "database is being accessed by other
 * users" and cascades into every later test failing for an unrelated reason.
 */
async function dropDatabase(admin: postgres.Sql, name: string): Promise<void> {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

export interface TestDatabase {
  /** Connection string for the throwaway database. */
  url: string;
  /** postgres.js client against it. Closed by `drop()`. */
  sql: postgres.Sql;
  /** Close the client and delete the database. Safe to call twice. */
  drop(): Promise<void>;
}

/**
 * Clone the template into a throwaway database owned by a single test file.
 *
 * Call from `beforeAll`, and `drop()` from `afterAll`.
 */
export async function createTestDatabase(label = "t"): Promise<TestDatabase> {
  const url = requireDatabaseUrl();
  const template = templateDatabaseName();

  const suffix = randomBytes(6).toString("hex");
  const name = `${databaseName(url)}_test_${label.replace(/[^a-z0-9]/gi, "").toLowerCase()}_${suffix}`;
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Refusing to create unsafe database name "${name}"`);
  }

  const admin = adminConnection(url);
  try {
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  } finally {
    await admin.end();
  }

  /*
   * ⚠️ Connects as the RUNTIME role, not the owner that just created the database. See the note
   * at the top of this file — as the owner, every RLS assertion in the suite passes vacuously.
   *
   * max: 1 so every query in a suite runs on ONE session. With a larger pool, a test that sets a
   * transaction-local tenant context and a test that asserts on it could land on different
   * backends and disagree for reasons that have nothing to do with the code under test.
   */
  const appUrl = withDatabase(requireAppDatabaseUrl(), name);
  const sql = postgres(appUrl, { max: 1, onnotice: () => {} });

  let dropped = false;
  return {
    url: appUrl,
    sql,
    async drop(): Promise<void> {
      if (dropped) return;
      dropped = true;
      await sql.end({ timeout: 5 });
      const cleanup = adminConnection(url);
      try {
        await dropDatabase(cleanup, name);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Tenant context
 * ------------------------------------------------------------------ */

export interface TenantContext {
  organizationId?: string | null;
  isPlatformAdmin?: boolean;
}

/**
 * Run work inside a transaction with the RLS settings applied — the test-side mirror of
 * `DatabaseService.withTenant`.
 *
 * Kept as a small copy rather than importing DatabaseService, which would drag in Nest DI and the
 * app config schema to run one `set_config`. The copy is the point of comparison: if these ever
 * disagree about how context is applied, the tests are no longer testing production behaviour.
 */
export async function asTenant<T>(
  sql: postgres.Sql,
  context: TenantContext,
  work: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_org_id', ${context.organizationId ?? ""}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', ${
      context.isPlatformAdmin ? "true" : "false"
    }, true)`;
    return work(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}

/** An anonymous public visitor: no organisation, no admin flag. */
export const ANONYMOUS: TenantContext = { organizationId: null, isPlatformAdmin: false };
