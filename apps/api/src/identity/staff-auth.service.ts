import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";

import { DatabaseService } from "../database/database.service";
import type { UserRole, UserStatus, OrgStatus } from "../database/schema/enums";
import { PasswordService } from "./password.service";
import { TokenReuseDetectedError, TokenService } from "./token.service";

/**
 * Staff authentication — the agent and their team, scoped to an organisation.
 *
 * Distinct from consumer auth (see ContactAuthService) because the two have genuinely different
 * shapes: staff belong to a tenant and carry a role, consumers belong to nobody and carry none.
 * Merging them would mean a nullable org on every token and a permission check that has to ask
 * "which kind of principal is this?" on every call.
 */

interface StaffLookupRow {
  id: string;
  organization_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  org_status: OrgStatus;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    organizationId: string;
  };
}

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Email + password login.
   *
   * ⚠️ EVERY FAILURE PATH RETURNS THE SAME ERROR. Unknown email, wrong password, disabled user
   * and suspended organisation are indistinguishable to the caller. Distinguishing them would
   * hand an attacker a working account-enumeration oracle, and "your account is disabled" is
   * information they have not yet earned the right to.
   *
   * The unknown-email branch also burns a hash comparison — see PasswordService.fakeVerify — so
   * the two paths take comparable time. Without that, response latency alone reveals which
   * addresses exist.
   */
  async login(params: {
    email: string;
    password: string;
    userAgent?: string;
    ip?: string;
  }): Promise<AuthResult> {
    const rows = await this.database.withoutTenantForAuth(
      async (tx) => tx<StaffLookupRow[]>`SELECT * FROM auth_lookup_staff(${params.email})`,
    );

    const user = rows[0];

    if (!user) {
      await this.passwords.fakeVerify(params.password);
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordOk = await this.passwords.verify(user.password_hash, params.password);
    if (!passwordOk) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Checked AFTER the password, so status is never revealed to someone who cannot authenticate.
    if (user.status !== "ACTIVE" || user.org_status !== "ACTIVE") {
      this.logger.warn(
        `Login blocked for ${user.id}: user=${user.status} org=${user.org_status}`,
      );
      throw new UnauthorizedException("Invalid email or password");
    }

    // Transparent upgrade if the stored hash predates the current Argon2 parameters.
    if (this.passwords.needsRehash(user.password_hash)) {
      const rehashed = await this.passwords.hash(params.password);
      await this.database.withTenant(
        { organizationId: user.organization_id, isPlatformAdmin: false },
        async (tx) => {
          await tx`UPDATE app_user SET password_hash = ${rehashed} WHERE id = ${user.id}`;
        },
      );
    }

    await this.database.withTenant(
      { organizationId: user.organization_id, isPlatformAdmin: false },
      async (tx) => {
        await tx`UPDATE app_user SET last_login_at = now() WHERE id = ${user.id}`;
      },
    );

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      org: user.organization_id,
      role: user.role,
      kind: "staff",
    });

    const { refreshToken } = await this.tokens.issueRefreshToken({
      userId: user.id,
      userAgent: params.userAgent,
      ip: params.ip,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        organizationId: user.organization_id,
      },
    };
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * Reuse detection surfaces as a plain 401 to the caller. The family has already been revoked by
   * TokenService, and telling the presenter "we detected theft" only informs an attacker that
   * they have been caught.
   */
  async refresh(params: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    let rotated;
    try {
      rotated = await this.tokens.rotate({
        raw: params.refreshToken,
        userAgent: params.userAgent,
        ip: params.ip,
      });
    } catch (error) {
      if (error instanceof TokenReuseDetectedError) {
        throw new UnauthorizedException("Session expired, please sign in again");
      }
      throw new UnauthorizedException("Session expired, please sign in again");
    }

    const { record } = rotated;

    /*
     * Staff and consumers share the refresh_token table, so a consumer token can physically be
     * presented to this endpoint. Refusing it here — rather than letting the null org fall
     * through — stops a buyer's session from ever being upgraded into a staff token.
     */
    if (record.principal_kind !== "staff" || !record.user_id || !record.organization_id) {
      await this.tokens.revokeFamily(record.family_id);
      throw new UnauthorizedException("Session expired, please sign in again");
    }

    if (record.user_status !== "ACTIVE" || record.org_status !== "ACTIVE") {
      // Status changed since the token was issued — revoke rather than silently re-issuing.
      await this.tokens.revokeFamily(record.family_id);
      throw new ForbiddenException("Account is not active");
    }

    const organizationId = record.organization_id;
    const userId = record.user_id;

    const roleRows = await this.database.withTenant(
      { organizationId, isPlatformAdmin: false },
      async (tx) => tx<{ role: UserRole }[]>`SELECT role FROM app_user WHERE id = ${userId}`,
    );

    const role = roleRows[0]?.role;
    if (!role) throw new UnauthorizedException("Session expired, please sign in again");

    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      org: organizationId,
      role,
      kind: "staff",
    });

    return { accessToken, refreshToken: rotated.refreshToken };
  }

  /** Log out one session. Idempotent — an unknown token is not an error worth reporting. */
  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }
}
