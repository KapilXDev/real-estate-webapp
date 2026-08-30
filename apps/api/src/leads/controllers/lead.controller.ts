import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import {
  JwtAuthGuard,
  Public,
  StaffOnly,
  type AuthenticatedRequest,
} from "../../identity/guards/jwt-auth.guard";
import { CreateLeadDto } from "../dto/create-lead.dto";
import { LeadService } from "../services/lead.service";

/**
 * Public lead intake.
 *
 * ⚠️ THROTTLING THIS IS A GENUINE TRADE-OFF, not a default. Every rejected request here is
 * potentially a real buyer. But an unthrottled public write endpoint is a spam sink that fills the
 * agent's follow-up queue with garbage until the real leads are unfindable — which loses more
 * customers than the limit does.
 *
 * 10/minute per IP: far above any human filling in a form, far below a script. Note the limit is
 * per IP, so a shared office or mobile carrier NAT is the case to watch if legitimate submissions
 * ever start failing.
 */
@Controller("leads")
export class LeadController {
  constructor(private readonly leads: LeadService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }
}

/**
 * The agent-facing follow-up queue. Separate controller because the auth posture is the opposite:
 * everything here is staff-only, and mixing the two in one class means the class-level guard has
 * to be absent, which is exactly the mistake that let a consumer token reach `/auth/staff/me`.
 */
@Controller("staff/leads")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffLeadController {
  constructor(private readonly leads: LeadService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return this.leads.listForOrg({ organizationId: request.principal!.org! });
  }
}
