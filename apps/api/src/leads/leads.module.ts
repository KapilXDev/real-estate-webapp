import { Module } from "@nestjs/common";

import { IdentityModule } from "../identity/identity.module";
import { LeadController, StaffLeadController } from "./controllers/lead.controller";
import { LeadRepository } from "./repositories/lead.repository";
import { LeadScoringService } from "./services/lead-scoring.service";
import { LeadService } from "./services/lead.service";

/**
 * Leads — the revenue path.
 *
 * Layered the same way as `catalog/`: controllers know HTTP, services decide, repositories are the
 * only place with SQL. `IdentityModule` is imported for `JwtAuthGuard` on the staff queue.
 */
@Module({
  imports: [IdentityModule],
  controllers: [LeadController, StaffLeadController],
  providers: [LeadService, LeadScoringService, LeadRepository],
  exports: [LeadService],
})
export class LeadsModule {}
