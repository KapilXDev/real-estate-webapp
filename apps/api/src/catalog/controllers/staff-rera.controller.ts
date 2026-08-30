import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Req, UseGuards } from "@nestjs/common";

import {
  JwtAuthGuard,
  StaffOnly,
  type AuthenticatedRequest,
} from "../../identity/guards/jwt-auth.guard";
import { UpsertReraDto } from "../dto/rera.dto";
import { ReraRepository } from "../repositories/rera.repository";

/**
 * RERA registrations — one per jurisdiction.
 *
 * ⚠️ THE REPOSITORY EXISTED WITH NO WAY TO REACH IT. `ReraRepository.upsert` and `.listForOrg`
 * were written for the publication gate, but nothing exposed them, so the only way to register a
 * number was a manual INSERT — which is why the catalog smoke test shells out to psql. An agent
 * cannot publish anything without this, so it is not optional plumbing.
 *
 * The tricity spans Punjab RERA, Chandigarh (a UT with its own authority) and Haryana. A
 * registration is per (organisation, state) and the publication gate resolves it from the
 * listing's city — see ListingAdminService.
 */
@Controller("staff/rera")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffReraController {
  constructor(private readonly rera: ReraRepository) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const organizationId = request.principal!.org!;
    return this.rera.listForOrg({ organizationId }, organizationId);
  }

  /**
   * Add or replace the registration for one jurisdiction.
   *
   * PUT keyed on the state rather than POST: there is exactly one registration per authority, so
   * the operation is idempotent by nature and the URL names the thing being replaced. The DB
   * enforces the same with `UNIQUE (organization_id, state)`.
   */
  @Put(":state")
  @HttpCode(HttpStatus.NO_CONTENT)
  async upsert(
    @Param("state") state: string,
    @Body() dto: UpsertReraDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const organizationId = request.principal!.org!;
    await this.rera.upsert(
      { organizationId },
      {
        organizationId,
        state,
        registrationNo: dto.registrationNo,
        authorityName: dto.authorityName,
        validUntil: dto.validUntil ?? null,
      },
    );
  }
}
