import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import { loadEnvFile } from "../config/load-env";

/**
 * Migration runner.
 *
 * WHY HAND-WRITTEN SQL RATHER THAN drizzle-kit generate:
 * this schema needs PostGIS geography columns, generated tsvector columns, CHECK constraints,
 * SECURITY DEFINER functions, and RLS policies. Drizzle's generator models none of those well,
 * and fighting a generator into emitting correct security policy SQL is a bad trade — a wrong
 * RLS policy is a cross-tenant data leak. Explicit SQL keeps that under review.
 *
 * Drizzle is still used for type-safe queries; it just doesn't own the DDL.
 *
 * Properties of this runner:
 *  - Each migration runs inside a transaction, so a failure leaves no partial schema.
 *  - Applied migrations are recorded with a checksum; editing an already-applied file is an
 *    error rather than a silent no-op.
 *  - An advisory lock prevents two instances migrating concurrently (relevant the moment more
 *    than one API replica starts up together).
 */

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/** Arbitrary but fixed — any process running migrations must use the same key. */
const ADVISORY_LOCK_KEY = 947_213_558;

async function checksum(contents: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  // Normalise line endings so a Windows checkout doesn't disagree with CI on Linux.
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

export async function runMigrations(connectionString: string): Promise<void> {
  // max: 1 — migrations are strictly sequential and must share one session for the lock.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name        text PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `;

    // Blocks until any concurrent migrator finishes, rather than racing it.
    await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;

    try {
      const applied = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM schema_migration
      `;
      const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

      const files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith(".sql"))
        .sort(); // zero-padded numeric prefixes make lexical sort correct

      let ranCount = 0;

      for (const file of files) {
        const contents = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
        const hash = await checksum(contents);
        const previousHash = appliedByName.get(file);

        if (previousHash !== undefined) {
          if (previousHash !== hash) {
            // Editing an applied migration means dev and prod schemas have silently diverged.
            throw new Error(
              `Migration ${file} has already been applied but its contents changed.\n` +
                `Applied migrations are immutable — add a new migration instead.\n` +
                `  expected checksum: ${previousHash}\n` +
                `  actual checksum:   ${hash}`,
            );
          }
          continue;
        }

        process.stdout.write(`  applying ${file} ... `);
        await sql.begin(async (tx) => {
          await tx.unsafe(contents);
          await tx`
            INSERT INTO schema_migration (name, checksum) VALUES (${file}, ${hash})
          `;
        });
        process.stdout.write("ok\n");
        ranCount++;
      }

      console.log(
        ranCount === 0
          ? "Database is up to date — no migrations to apply."
          : `Applied ${ranCount} migration${ranCount === 1 ? "" : "s"}.`,
      );
    } finally {
      await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
    }
  } finally {
    await sql.end();
  }
}

// Allow `npm run db:migrate` to invoke this directly.
if (require.main === module) {
  loadEnvFile();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  runMigrations(connectionString)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("\nMigration failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
