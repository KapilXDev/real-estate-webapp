import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/configuration";
import { createDbClient, type Database, type DbClient, type RawSql } from "./client";

/**
 * Tenant context carried into every scoped query.
 *
 * `organizationId` is null for anonymous public browsing (the public catalog is world-readable)
 * and for the pre-authentication paths, where the org is not yet known.
 */
export interface TenantContext {
  organizationId: string | null;
  isPlatformAdmin: boolean;
}

/** Anonymous browsing: no org, no admin. The public listing policy still applies. */
export const ANONYMOUS: TenantContext = {
  organizationId: null,
  isPlatformAdmin: false,
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly client: DbClient;
  readonly sql: RawSql;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createDbClient({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
    });
    this.sql = this.client.sql;
  }

  /**
   * Drizzle handle, for typed queries.
   *
   * A getter, not a constructor-assigned field: reading it opens Drizzle's own connection pool,
   * and Drizzle must never be given the raw client (it rewrites that client's date/json codecs in
   * place — see the warning in client.ts). Nothing uses this yet, so nothing pays for it yet.
   */
  get db(): Database {
    return this.client.db;
  }

  /**
   * Run work inside a transaction with the RLS tenant context applied.
   *
   * ⚠️ USE THIS FOR EVERY TENANT-SCOPED QUERY. Reading through `this.sql` directly bypasses the
   * context, and because `current_org_id()` returns NULL rather than erroring when unset, the
   * result is not a loud failure — it is a query that silently returns only public rows, or
   * writes a row that no policy will let anyone read back. Both look like application bugs and
   * neither points at the real cause.
   *
   * ⚠️ `SET LOCAL`, NEVER `SET`. postgres.js pools connections. A plain `SET` persists on the
   * connection after the request finishes, so the next request to borrow it would inherit the
   * previous tenant's org id — a cross-tenant data leak that would be almost impossible to
   * reproduce on demand. `SET LOCAL` is scoped to the transaction and dies with it.
   *
   * The values are passed as bound parameters rather than interpolated. `set_config` is used
   * instead of literal `SET LOCAL` precisely because SET does not accept parameters, and building
   * that statement by string concatenation would put a caller-influenced value into SQL text.
   */
  async withTenant<T>(
    context: TenantContext,
    work: (tx: RawSql) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin(async (tx) => {
      // `true` = local to the transaction, the set_config equivalent of SET LOCAL.
      await tx`SELECT set_config('app.current_org_id', ${context.organizationId ?? ""}, true)`;
      await tx`SELECT set_config('app.is_platform_admin', ${
        context.isPlatformAdmin ? "true" : "false"
      }, true)`;

      return work(tx as unknown as RawSql);
    }) as Promise<T>;
  }

  /**
   * Run work with NO tenant context, inside a transaction.
   *
   * Only for pre-authentication paths that go through the SECURITY DEFINER functions in
   * migration 0011 (login, token refresh). Those functions are the deliberate keyhole through
   * RLS; nothing else belongs here.
   *
   * Named to be conspicuous in review. If you find yourself reaching for it to make an ordinary
   * query work, the query is missing its tenant context — fix that instead.
   */
  async withoutTenantForAuth<T>(work: (tx: RawSql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => work(tx as unknown as RawSql)) as Promise<T>;
  }

  /** Liveness probe: cheap, and distinguishes "app up" from "app up but database unreachable". */
  async ping(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        `Database ping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Closes both pools — the raw one and Drizzle's, if it was ever opened.
    await this.client.close();
  }
}
