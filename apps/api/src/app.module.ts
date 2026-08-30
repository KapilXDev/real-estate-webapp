import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { CatalogModule } from "./catalog/catalog.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { IdentityModule } from "./identity/identity.module";
import { LeadsModule } from "./leads/leads.module";

/**
 * Root module.
 *
 * ⚠️ The throttler IS registered globally (APP_GUARD) while the auth guard deliberately is not.
 * The asymmetry is intentional: forgetting rate limiting on a new endpoint is a silent
 * availability and cost risk that nobody notices until a bill arrives, whereas forgetting auth
 * fails loudly the first time anyone calls it. Default the dangerous-to-omit one on.
 *
 * The limits below are a global backstop. Auth endpoints override them with much tighter values —
 * see the @Throttle decorators in the auth, catalog and lead controllers.
 *
 * NOTE: storage is in-memory. That is per-instance, so N replicas means N times the limit.
 * Acceptable for local Compose; move to the Redis storage adapter before running more than one
 * instance. Redis is deliberately not installed yet (BUILD_LOG step 9).
 */
@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([
      { name: "short", ttl: 1_000, limit: 10 },
      { name: "default", ttl: 60_000, limit: 120 },
    ]),
    IdentityModule,
    CatalogModule,
    LeadsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
