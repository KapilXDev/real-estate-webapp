import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { ContactAuthController } from "./controllers/contact-auth.controller";
import { StaffAuthController } from "./controllers/staff-auth.controller";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { ContactAuthService } from "./services/contact-auth.service";
import { OtpService } from "./services/otp.service";
import { PasswordService } from "./services/password.service";
import { StaffAuthService } from "./services/staff-auth.service";
import { TokenService } from "./services/token.service";

/**
 * Identity — staff credentials, consumer phone-OTP sessions, and token issuance.
 *
 * LAYOUT (the convention every module in this app follows):
 *   controllers/  HTTP shape only — parse, delegate, translate a domain result into a status code
 *   services/     decisions and orchestration; the only layer that knows business rules
 *   guards/       cross-cutting request admission
 *   dto/          inbound validation, at the edge
 *   utils/        pure helpers with no dependencies of their own
 *
 * ⚠️ NOTE ONE DEVIATION, DELIBERATE AND TEMPORARY: identity has no `repositories/` layer yet — its
 * services still hold their own SQL. `catalog/` and `leads/` are the reference implementation of
 * the full pattern. Extracting identity's data access is a real refactor rather than a file move
 * (refresh-token rotation and reuse detection are subtle, and the smoke coverage for them lives in
 * a throwaway script), so it is queued rather than bundled into a structural change.
 *
 * ⚠️ `JwtAuthGuard` is exported, not registered as an APP_GUARD. Global registration would make
 * every future route authenticated by default — which sounds safer and is wrong here: the entire
 * public catalog must be anonymous and crawlable, and a globally-guarded app would have every
 * catalog route opting out with `@Public()`, so one forgotten decorator takes a page off Google
 * rather than exposing anything. Guarding is applied per controller, where it is visible.
 */
@Module({
  imports: [
    // Secrets are supplied per-call by TokenService: access and refresh tokens are signed with
    // DIFFERENT keys, so a module-level default would be wrong for one of them.
    JwtModule.register({}),
  ],
  controllers: [StaffAuthController, ContactAuthController],
  providers: [
    StaffAuthService,
    ContactAuthService,
    TokenService,
    PasswordService,
    OtpService,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class IdentityModule {}
