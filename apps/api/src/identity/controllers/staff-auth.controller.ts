import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { LogoutDto, RefreshDto, StaffLoginDto } from "../dto/auth.dto";
import {
  JwtAuthGuard,
  Public,
  StaffOnly,
  type AuthenticatedRequest,
} from "../guards/jwt-auth.guard";
import { StaffAuthService } from "../services/staff-auth.service";
import { requestMeta } from "../utils/request-meta";

/*
 * ⚠️ `@StaffOnly()` is applied to the CLASS, not to individual routes.
 *
 * The guard only enforces a principal kind when the route asks for one, so a staff route that
 * forgets the decorator accepts a CONSUMER's access token — a signed, unexpired, entirely valid
 * token belonging to a buyer who signed in by phone OTP. That is not a theoretical gap: `/me`
 * shipped without it and happily answered a contact token with `role: "CONTACT"`, and the next
 * staff route added would have inherited the same default.
 *
 * At class level the safe answer is the default and a new route has to opt OUT to be wrong.
 * The `@Public()` routes below still work: the guard resolves handler metadata ahead of class
 * metadata and returns early for public routes before the kind check is reached.
 */
@Controller("auth/staff")
@UseGuards(JwtAuthGuard)
@StaffOnly()
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  /**
   * ⚠️ Tighter throttle than the global default. Login is the credential-stuffing target, and the
   * global limit is sized for ordinary API traffic rather than for an attacker with a password
   * list. Ten attempts a minute per IP is generous for a human and useless for a botnet.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: StaffLoginDto, @Req() request: Request) {
    return this.auth.login({ ...dto, ...requestMeta(request) });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh({ ...dto, ...requestMeta(request) });
  }

  /**
   * Public because a client whose access token has already expired must still be able to log out.
   * Requiring a valid access token here would leave revocable sessions stranded.
   */
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /** Who am I — used by the client to rehydrate session state on load. */
  @Post("me")
  @HttpCode(HttpStatus.OK)
  me(@Req() request: AuthenticatedRequest) {
    return {
      id: request.principal?.sub,
      organizationId: request.principal?.org,
      role: request.principal?.role,
    };
  }
}
