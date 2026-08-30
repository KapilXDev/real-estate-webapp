import postgres from "postgres";

import { loadEnvFile } from "../config/load-env";

/**
 * Enables login for the runtime role created by migration 0013, and verifies it is safe.
 *
 * WHY THIS IS NOT PART OF THE MIGRATION: a migration must be runnable in any environment and must
 * not invent or embed credentials. 0013 therefore creates `tricity_app` as NOLOGIN with its
 * grants; this command supplies the password out of band, reading it from APP_DATABASE_URL so
 * there is exactly one place the credential lives.
 *
 * Run as the OWNER (DATABASE_URL). Safe to re-run — it rotates the password.
 */

/** Must match the role name in 0013. */
export const RUNTIME_ROLE = "tricity_app";

export interface RoleSafety {
  role: string;
  isSuperuser: boolean;
  canBypassRls: boolean;
}

export async function inspectRole(sql: postgres.Sql, role: string): Promise<RoleSafety | null> {
  const [row] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${role}
  `;
  if (!row) return null;
  return { role, isSuperuser: row.rolsuper, canBypassRls: row.rolbypassrls };
}

/**
 * ⚠️ THE GUARD THAT MAKES THE WHOLE MULTI-TENANT DESIGN REAL. Called at API startup.
 *
 * A superuser — or any role with BYPASSRLS — skips row-level security entirely. Not "policies
 * evaluate permissively": the check is never reached. `FORCE ROW LEVEL SECURITY` does not apply
 * to them either. So every policy in 0010 is silently inert, and the failure is invisible: no
 * error, no log line, correct-looking results, and one brokerage reading another's inventory.
 *
 * That is exactly what shipped, because the Docker image makes POSTGRES_USER a superuser and the
 * API reused that connection string. Nothing in the schema could have caught it — which is why
 * this check lives in code and runs before the app serves a single request.
 *
 * Throws rather than warns. An API that cannot enforce tenant isolation must not accept traffic.
 */
export async function assertRuntimeRoleCannotBypassRls(sql: postgres.Sql): Promise<void> {
  const [row] = await sql<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT r.rolname AS current_user, r.rolsuper, r.rolbypassrls
    FROM pg_roles r
    WHERE r.oid = current_user::regrole::oid
  `;

  if (!row) {
    throw new Error("Could not determine the current database role — refusing to start.");
  }

  if (row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `FATAL: the API is connected to Postgres as "${row.current_user}", which ` +
        `${row.rolsuper ? "is a SUPERUSER" : "has BYPASSRLS"}.\n\n` +
        "Such a role IGNORES row-level security completely, so every tenant-isolation policy in " +
        "migration 0010 is inert and any organisation can read every other organisation's " +
        "listings and leads.\n\n" +
        `Point APP_DATABASE_URL at the "${RUNTIME_ROLE}" role instead of the owner role:\n` +
        "  npm run db:migrate     # creates the role (0013)\n" +
        "  npm run db:app-role    # gives it a password from APP_DATABASE_URL\n",
    );
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  loadEnvFile();

  const ownerUrl = process.env.DATABASE_URL;
  const appUrl = process.env.APP_DATABASE_URL;

  if (!ownerUrl) {
    console.error("DATABASE_URL (the owner connection) is not set.");
    process.exit(1);
  }
  if (!appUrl) {
    console.error(
      "APP_DATABASE_URL is not set. It carries the runtime role's name and password —\n" +
        "see .env.example.",
    );
    process.exit(1);
  }

  const parsed = new URL(appUrl);
  const role = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  if (role !== RUNTIME_ROLE) {
    console.error(
      `APP_DATABASE_URL names the role "${role}", but migration 0013 creates "${RUNTIME_ROLE}".\n` +
        "These must match, or the API will connect as a role that has no grants.",
    );
    process.exit(1);
  }
  if (!password) {
    console.error("APP_DATABASE_URL has no password. The runtime role must authenticate.");
    process.exit(1);
  }

  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    const before = await inspectRole(sql, role);
    if (!before) {
      console.error(`Role "${role}" does not exist. Run \`npm run db:migrate\` first (0013).`);
      process.exit(1);
    }

    /*
     * ⚠️ `ALTER ROLE` is a utility statement, so it accepts NO bind parameters — the password has
     * to reach the server inside the SQL text. Rather than hand-rolling the escaping, the
     * statement is BUILT BY POSTGRES: `format()` with %I/%L applies the server's own identifier
     * and literal quoting to values that are still ordinary bind parameters at that point. A
     * password containing a quote is then a non-event instead of a syntax error or an injection.
     */
    const [built] = await sql<{ statement: string }[]>`
      SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}::text, ${password}::text)
             AS statement
    `;
    await sql.unsafe(built!.statement);

    const after = await inspectRole(sql, role);
    if (after?.isSuperuser || after?.canBypassRls) {
      console.error(
        `\n✖ Role "${role}" is a superuser or has BYPASSRLS. It would ignore every RLS policy.\n` +
          "  Re-run `npm run db:migrate` — 0013 resets those attributes.",
      );
      process.exit(1);
    }

    // Prove the credential actually works, rather than reporting success and letting the API
    // discover otherwise on its first request.
    const probe = postgres(appUrl, { max: 1, onnotice: () => {} });
    try {
      const [row] = await probe<{ ok: string }[]>`SELECT current_user AS ok`;
      console.log(`\n✔ ${role} can log in (connected as "${row!.ok}")`);
    } finally {
      await probe.end();
    }

    console.log("✔ NOSUPERUSER, NOBYPASSRLS — row-level security applies to this role.\n");
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("\nFailed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
