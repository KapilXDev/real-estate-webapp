import { drizzle } from "drizzle-orm/postgres-js";
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
 */

export interface DbConfig {
  connectionString: string;
  /** Pool size. Keep low for workers, higher for the API. */
  max?: number;
  /** Seconds a connection may idle before being released. */
  idleTimeout?: number;
}

export function createDbClient(config: DbConfig) {
  const sql = postgres(config.connectionString, {
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

  return { sql, db: drizzle(sql) };
}

export type Database = ReturnType<typeof createDbClient>["db"];
export type RawSql = ReturnType<typeof createDbClient>["sql"];
