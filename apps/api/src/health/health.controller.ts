import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

import { DatabaseService } from "../database/database.service";
import { Public } from "../identity/jwt-auth.guard";

/**
 * Health endpoints.
 *
 * Two, not one, because Kubernetes-style probes need different answers:
 *   - liveness  — is the process wedged? Restarting fixes it. Must NOT depend on the database,
 *                 or a brief DB blip triggers a restart storm that makes the outage worse.
 *   - readiness — can this instance serve traffic right now? It cannot without a database, so
 *                 this one does check, and a failure removes the instance from the pool instead
 *                 of killing it.
 *
 * Conflating them is the classic mistake: a single DB-dependent health check wired to liveness
 * turns a recoverable database hiccup into a full restart loop.
 */
@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Public()
  @Get("live")
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  async ready() {
    const databaseUp = await this.database.ping();
    return {
      status: databaseUp ? "ok" : "degraded",
      database: databaseUp ? "up" : "down",
    };
  }
}
