import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Database client.
 *
 * Uses postgres.js rather than node-postgres: it has first-class support for the tagged-template
 * raw SQL we need for PostGIS predicates, and Drizzle's postgres-js driver is the better-supported
 * pairing.
 *
 * BULKHEAD: connection limits are set per consumer rather than sharing one global pool. A slow
 * ingestion batch must not be able to starve the API of connections — that is exactly the
 * cross-component failure the architecture is meant to prevent.
 *
 * ============================================================================================
 * ⚠️⚠️ DRIZZLE AND RAW SQL MUST NOT SHARE A postgres.js CLIENT. THIS IS NOT A STYLE CHOICE.
 * ============================================================================================
 *
 * `drizzle(sql)` REACHES INTO the client it is handed and overwrites `sql.options.serializers`
 * and `sql.options.parsers` in place, globally, for every query that client will ever run —
 * including raw tagged-template queries Drizzle knows nothing about. It replaces the handlers
 * for OIDs 114/3802 (json/jsonb), 1082/1083/1114/1184 (date/time/timestamp/timestamptz) and
 * their array variants with the identity function `(val) => val`, because Drizzle does its own
 * mapping and wants the wire values untouched.
 *
 * On a shared client that silently breaks raw SQL in BOTH directions:
 *
 *   WRITING — binding a JS `Date` no longer serialises. postgres.js hands the raw Date to
 *   Buffer.byteLength and throws `ERR_INVALID_ARG_TYPE: ... Received an instance of Date`, from
 *   inside the driver, with a stack that points at postgres.js internals rather than at the
 *   query. Same for binding a plain object to a jsonb column.
 *
 *   READING — timestamps come back as STRINGS, not Dates, while TypeScript still cheerfully
 *   types them `Date` because the row type is a hand-written assertion the compiler cannot check
 *   against the wire. Every `row.expires_at.getTime()` in the identity module — OTP expiry,
 *   refresh-token expiry, resend cooldown — is a runtime TypeError that no amount of `tsc` will
 *   catch.
 *
 * This is exactly how the OTP endpoint failed on its first ever call against a real database.
 * Reconciling the two regimes on one client is not possible: Drizzle REQUIRES the identity
 * parsers, and the raw layer requires the real ones. So they get separate clients.
 *
 * The Drizzle client is created lazily, on first access, because nothing uses it yet — the
 * identity module is entirely raw SQL. Until something does, this costs zero connections.
 */

export type Database = PostgresJsDatabase<Record<string, never>>;
export type RawSql = ReturnType<typeof postgres>;

export interface DbConfig {
  connectionString: string;
  /** Pool size. Keep low for workers, higher for the API. */
  max?: number;
  /** Seconds a connection may idle before being released. */
  idleTimeout?: number;
}

function connect(config: DbConfig): RawSql {
  return postgres(config.connectionString, {
    max: config.max ?? 10,
    idle_timeout: config.idleTimeout ?? 30,
    // Fail fast rather than hanging a request behind an unreachable database.
    connect_timeout: 10,
    // postgres.js parses NUMERIC to string by default to avoid float precision loss.
    // We keep that: money and area are numeric(16,2)/(12,2) and must not round-trip
    // through a JS float. Conversion happens explicitly in the repository layer.
    transform: undefined,
    onnotice: () => {},
  });
}

export interface DbClient {
  /** Raw postgres.js, with postgres.js's own type handling intact. Everything uses this today. */
  readonly sql: RawSql;
  /** Drizzle, on its own connection. Created on first access — see the warning above. */
  readonly db: Database;
  close(): Promise<void>;
}

export function createDbClient(config: DbConfig): DbClient {
  const sql = connect(config);

  let drizzleSql: RawSql | undefined;
  let drizzleDb: Database | undefined;

  return {
    sql,

    get db(): Database {
      if (drizzleDb === undefined) {
        // A second, deliberately small pool: Drizzle is for typed reads, not bulk work, and the
        // total connection count across both pools is what the server actually sees.
        drizzleSql = connect({ ...config, max: Math.max(2, Math.floor((config.max ?? 10) / 2)) });
        drizzleDb = drizzle(drizzleSql);
      }
      return drizzleDb;
    },

    async close(): Promise<void> {
      await Promise.all([
        sql.end({ timeout: 5 }),
        drizzleSql ? drizzleSql.end({ timeout: 5 }) : Promise.resolve(),
      ]);
    },
  };
}
