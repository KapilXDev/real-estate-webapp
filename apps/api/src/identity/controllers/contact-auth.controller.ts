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
  VerifyOtpDto,
} from "../dto/auth.dto";
import {
  ContactOnly,
  JwtAuthGuard,
  Public,
  type AuthenticatedRequest,
} from "../guards/jwt-auth.guard";
import { ContactAuthService } from "../services/contact-auth.service";
import { requestMeta } from "../utils/request-meta";

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
