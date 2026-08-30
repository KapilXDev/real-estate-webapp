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

import {
  ContactPasswordLoginDto,
  LinkEmailPasswordDto,
  LogoutDto,
  RefreshDto,
  RequestOtpDto,
  StaffLoginDto,
  VerifyOtpDto,
} from "./dto/auth.dto";
import { ContactAuthService } from "./contact-auth.service";
import {
  ContactOnly,
  JwtAuthGuard,
  Public,
  StaffOnly,
  type AuthenticatedRequest,
} from "./jwt-auth.guard";
import { StaffAuthService } from "./staff-auth.service";

/**
 * Pull the client's address and user agent for the session record.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy we control — Express must be configured
 * with `trust proxy` for `req.ip` to honour it. Recorded for audit, never for authorisation.
 */
function requestMeta(request: Request) {
  return {
    userAgent: request.headers["user-agent"]?.slice(0, 512),
    ip: request.ip,
  };
}

/* ------------------------------------------------------------------ *
 * Staff
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Consumers
 * ------------------------------------------------------------------ */

/** Class-level for the same reason as StaffAuthController above — see that note. */
@Controller("auth/contact")
@UseGuards(JwtAuthGuard)
@ContactOnly()
export class ContactAuthController {
  constructor(private readonly auth: ContactAuthService) {}

  /**
   * ⚠️ THE MOST ABUSED ENDPOINT ON THE API. Every call can cost real money in SMS fees — see the
   * SMS-pumping note in OtpService. Three per minute per IP, on top of the per-destination
   * cooldown enforced in the service, which the throttler alone would not provide.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto) {
    const result = await this.auth.requestLoginOtp(dto.phone);

    /*
     * The response is identical whether or not this number has an account, and whether or not a
     * message was actually sent (a cooldown may have suppressed it). Anything else is an
     * enumeration oracle. `devCode` is present outside production only, so local development
     * does not need a live SMS provider.
     */
    return {
      sent: true,
      retryAfterSeconds: result.retryAfterSeconds,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() request: Request) {
    return this.auth.verifyLoginOtp({ ...dto, ...requestMeta(request) });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: ContactPasswordLoginDto, @Req() request: Request) {
    return this.auth.loginWithPassword({ ...dto, ...requestMeta(request) });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh({ ...dto, ...requestMeta(request) });
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /**
   * Attach email+password to the signed-in contact.
   *
   * Requires an authenticated CONTACT specifically — this adds a credential to an identity that
   * has already been proven by OTP, rather than letting an unverified email claim an account.
   */
  @ContactOnly()
  @Post("link/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkPassword(
    @Body() dto: LinkEmailPasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.auth.linkEmailPassword({
      contactId: request.principal!.sub,
      email: dto.email,
      password: dto.password,
    });
  }

  @ContactOnly()
  @Post("me")
  @HttpCode(HttpStatus.OK)
  me(@Req() request: AuthenticatedRequest) {
    return { id: request.principal?.sub, kind: request.principal?.kind };
  }
}
