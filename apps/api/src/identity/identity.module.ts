import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { ContactAuthController, StaffAuthController } from "./auth.controller";
import { ContactAuthService } from "./contact-auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OtpService } from "./otp.service";
import { PasswordService } from "./password.service";
import { StaffAuthService } from "./staff-auth.service";
import { TokenService } from "./token.service";

/**
 * Identity module — the first vertical slice.
 *
 * JwtModule is registered without a global secret on purpose: access and refresh concerns use
 * different secrets, and both are passed explicitly at sign/verify time in TokenService. A module
 * default would be the one that silently gets used if a call site forgets, which is exactly the
 * mistake worth making impossible.
 *
 * JwtAuthGuard is exported rather than registered globally (APP_GUARD) so that adding a new
 * feature module is an explicit decision about its auth posture, instead of everything being
 * protected-by-default until someone adds @Public and quietly opens a hole.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [StaffAuthController, ContactAuthController],
  providers: [
    PasswordService,
    TokenService,
    OtpService,
    StaffAuthService,
    ContactAuthService,
    JwtAuthGuard,
  ],
  exports: [TokenService, PasswordService, JwtAuthGuard],
})
export class IdentityModule {}
