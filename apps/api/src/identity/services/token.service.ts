import { Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { SignOptions } from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { APP_CONFIG, type AppConfig } from "../../config/configuration";
import { DatabaseService } from "../../database/database.service";
import type { UserRole } from "../../database/schema/enums";

/**
 * Access-token claims.
 *
 * `org` is carried in the token so every request can set its RLS context without a database
 * round-trip. It is signed, so a client cannot alter it to read another tenant's data — this is
 * the whole reason the org lives in the token rather than in a header.
 */
export interface AccessTokenClaims {
  /** Subject — app_user.id, or contact.id for consumers. */
  sub: string;
  /** Organisation id. Null for consumer tokens: contacts belong to no tenant. */
  org: string | null;
  role: UserRole | "CONTACT";
  /** Distinguishes a staff token from a consumer token — they authorise different surfaces. */
  kind: "staff" | "contact";
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/**
 * A refresh token row as returned by `auth_lookup_refresh_token`.
 *
 * ⚠️ Exactly one of `user_id` / `contact_id` is set — staff and consumers share this table but are
 * different principals (see the CHECK constraint in migration 0003). `principal_kind` says which,
 * so callers never infer it from which column happens to be null.
 *
 * `organization_id`, `user_status` and `org_status` are NULL for consumer tokens: a contact
 * belongs to no tenant and has no org to be suspended.
 */
export interface RefreshTokenRecord {
  id: string;
  principal_kind: "staff" | "contact";
  user_id: string | null;
  contact_id: string | null;
  family_id: string;
  organization_id: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  user_status: string | null;
  org_status: string | null;
}

/** Raised when a refresh token is presented that has already been used — i.e. probable theft. */
export class TokenReuseDetectedError extends Error {
  constructor(readonly familyId: string) {
    super("Refresh token reuse detected; family revoked");
    this.name = "TokenReuseDetectedError";
  }
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /* ---------------------------------------------------------------- *
   * Access tokens
   * ---------------------------------------------------------------- */

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync({ ...claims }, {
      secret: this.config.JWT_ACCESS_SECRET,
      /*
       * jsonwebtoken types `expiresIn` as a `ms` template-literal union rather than plain string,
       * so a validated config value still will not structurally match. The regex in
       * configuration.ts is what actually guarantees the format; this cast just tells TypeScript
       * that check already happened.
       */
      expiresIn: this.config.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, {
      secret: this.config.JWT_ACCESS_SECRET,
    });
  }

  /* ---------------------------------------------------------------- *
   * Refresh tokens
   * ---------------------------------------------------------------- */

  /**
   * Refresh tokens are opaque random strings, NOT JWTs.
   *
   * A JWT refresh token is self-validating, which is exactly wrong here: we need every refresh to
   * hit the database anyway to check rotation state and detect reuse, so the JWT buys nothing and
   * costs the ability to revoke. 256 bits of randomness from a CSPRNG.
   */
  private generateRawToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /**
   * SHA-256, not Argon2.
   *
   * Deliberate and different from passwords: this value is already 256 bits of uniform randomness,
   * so there is no dictionary to attack and no need for a slow KDF. Using Argon2 here would add
   * ~50ms to every token refresh for no security gain. Hashing at all is what stops a database
   * dump from being directly replayable.
   */
  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Issue a refresh token, starting a NEW rotation family. Used at login.
   *
   * The family id is generated here rather than defaulted in SQL so the caller can log it and so
   * the insert stays a single flat statement with no nested fragments.
   */
  async issueRefreshToken(params: {
    /** Exactly one of these. The DB CHECK rejects both-or-neither. */
    userId?: string;
    contactId?: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ refreshToken: string; familyId: string }> {
    if ((params.userId == null) === (params.contactId == null)) {
      // Caught here rather than as a constraint violation so the stack trace points at the caller.
      throw new Error("issueRefreshToken requires exactly one of userId or contactId");
    }

    const raw = this.generateRawToken();
    const tokenHash = this.hashToken(raw);
    const familyId = randomUUID();

    const expiresAt = new Date(
      Date.now() + this.config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.database.withoutTenantForAuth(async (tx) => {
      await tx`
        INSERT INTO refresh_token
          (user_id, contact_id, family_id, token_hash, expires_at, user_agent, ip)
        VALUES (
          ${params.userId ?? null},
          ${params.contactId ?? null},
          ${familyId},
          ${tokenHash},
          ${expiresAt},
          ${params.userAgent ?? null},
          ${params.ip ?? null}::inet
        )
      `;
    });

    return { refreshToken: raw, familyId };
  }

  /** Look a refresh token up by its hash. Returns null when the token is unknown. */
  async findRefreshToken(raw: string): Promise<RefreshTokenRecord | null> {
    const tokenHash = this.hashToken(raw);

    const rows = await this.database.withoutTenantForAuth(
      async (tx) =>
        tx<RefreshTokenRecord[]>`SELECT * FROM auth_lookup_refresh_token(${tokenHash})`,
    );

    return rows[0] ?? null;
  }

  /**
   * Rotate a refresh token.
   *
   * ⚠️ THE REUSE BRANCH IS THE POINT OF THIS WHOLE DESIGN.
   *
   * A token that has already been used means one of two things: the legitimate client retried,
   * or someone stole the token and is replaying it. We cannot tell which, and treating it as
   * merely "invalid" would let a thief keep using whichever branch of the chain they hold.
   *
   * So on reuse we revoke the ENTIRE family. Both the attacker and the real user are logged out,
   * and the real user simply logs in again. That is the correct trade: a rare, recoverable
   * inconvenience in exchange for shutting down a live session hijack. This is the OAuth 2.1
   * recommendation.
   */
  async rotate(params: {
    raw: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ record: RefreshTokenRecord; refreshToken: string }> {
    const record = await this.findRefreshToken(params.raw);

    if (!record) {
      throw new Error("Unknown refresh token");
    }

    if (record.used_at !== null) {
      // Already used. Assume theft and burn the family down.
      const revoked = await this.revokeFamily(record.family_id);
      this.logger.warn(
        `Refresh token reuse detected for ${record.principal_kind} ` +
          `${record.user_id ?? record.contact_id}; ` +
          `revoked ${revoked} token(s) in family ${record.family_id}`,
      );
      throw new TokenReuseDetectedError(record.family_id);
    }

    if (record.revoked_at !== null) {
      throw new Error("Refresh token revoked");
    }

    if (record.expires_at.getTime() <= Date.now()) {
      throw new Error("Refresh token expired");
    }

    /*
     * Mark used and mint the successor in ONE transaction. If these were separate, a crash
     * between them would either leave the old token replayable or leave the user with no valid
     * token at all.
     *
     * The UPDATE is guarded with `used_at IS NULL` so two concurrent refreshes cannot both
     * succeed — the loser sees zero affected rows and is treated as reuse, which is the correct
     * reading of two clients presenting the same token at once.
     */
    const raw = this.generateRawToken();
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(
      Date.now() + this.config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const claimed = await this.database.withoutTenantForAuth(async (tx) => {
      const updated = await tx`
        UPDATE refresh_token
           SET used_at = now()
         WHERE id = ${record.id}
           AND used_at IS NULL
           AND revoked_at IS NULL
        RETURNING id
      `;

      if (updated.length === 0) return false;

      // The successor inherits the principal of the token it replaces — never re-derived, so a
      // rotation can never move a session from one principal to another.
      await tx`
        INSERT INTO refresh_token
          (user_id, contact_id, family_id, token_hash, expires_at, user_agent, ip)
        VALUES (
          ${record.user_id},
          ${record.contact_id},
          ${record.family_id},
          ${tokenHash},
          ${expiresAt},
          ${params.userAgent ?? null},
          ${params.ip ?? null}::inet
        )
      `;

      return true;
    });

    if (!claimed) {
      const revoked = await this.revokeFamily(record.family_id);
      this.logger.warn(
        `Concurrent refresh lost the race for ${record.principal_kind} ` +
          `${record.user_id ?? record.contact_id}; ` +
          `revoked ${revoked} token(s) in family ${record.family_id}`,
      );
      throw new TokenReuseDetectedError(record.family_id);
    }

    return { record, refreshToken: raw };
  }

  /** Revoke every unrevoked token in a family. Returns how many were revoked. */
  async revokeFamily(familyId: string): Promise<number> {
    const rows = await this.database.withoutTenantForAuth(
      async (tx) =>
        tx<{ auth_revoke_token_family: number }[]>`
          SELECT auth_revoke_token_family(${familyId})
        `,
    );
    return rows[0]?.auth_revoke_token_family ?? 0;
  }

  /** Log out one session: revoke just the family the presented token belongs to. */
  async revokeByToken(raw: string): Promise<void> {
    const record = await this.findRefreshToken(raw);
    if (record) await this.revokeFamily(record.family_id);
  }
}
