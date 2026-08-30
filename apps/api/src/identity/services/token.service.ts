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
   *
   * ⚠️⚠️ …EXCEPT THAT STRICT ROTATION, ON ITS OWN, SIGNS LEGITIMATE USERS OUT CONSTANTLY, AND
   * THAT IS WHAT THE GRACE WINDOW BELOW IS FOR.
   *
   * A browser holds ONE cookie jar and several tabs. When the access cookie expires, every tab
   * that touches the server sends a request carrying the SAME refresh token, because none of them
   * has seen the response that replaces it yet. The second request is indistinguishable from a
   * replay, so strict rotation burns the family and signs the user out everywhere.
   *
   * This was not theoretical. Measured with a browser, before the fix:
   *
   *     N=2  1 of 2 requests bounced to the login page, session dead afterwards
   *     N=3  2 of 3 bounced,                            session dead
   *     N=6  5 of 6 bounced,                            session dead
   *
   * Two tabs and thirteen minutes of idling were enough. Note that a BFF-side fix — collapsing
   * concurrent refreshes in `apps/admin/src/proxy.ts` — cannot solve this: it only helps requests
   * that overlap the exchange, it does nothing for the consumer auth path, and the Next docs are
   * explicit that proxy may run where module memory is not shared. The lifecycle belongs to
   * whoever owns the tokens, so the fix lives here.
   *
   * Inside the window, a straggler is served a fresh token in the same family. Outside it,
   * behaviour is exactly as before. Same mechanism Auth0 calls a "reuse interval" and Okta a
   * "rotation grace period". `REFRESH_ROTATION_GRACE_SECONDS` documents the security trade.
   *
   * ⚠️ THE ROW IS LOCKED WITH `FOR UPDATE`, WHICH IS WHAT MAKES THIS DETERMINISTIC. Concurrent
   * rotations of the same token now queue instead of racing: the second transaction blocks, and
   * when it proceeds it reads a `used_at` the first just committed — freshly inside the window,
   * so it is graced. The previous code instead let both run, guarded the UPDATE with
   * `used_at IS NULL`, and treated the loser as theft. That is the same false positive again,
   * arrived at from the other direction, and it is why there is no longer a lost-race branch.
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

    /*
     * ⚠️ Checked BEFORE `used_at`, and the order matters. `auth_revoke_token_family` stamps
     * `revoked_at` on every unrevoked row in the family, used ones included — so a token whose
     * family was already burned by a genuine reuse arrives here with BOTH columns set. Testing
     * `used_at` first would put it on the grace path and hand a session back to the attacker the
     * revocation was protecting against.
     */
    if (record.revoked_at !== null) {
      throw new Error("Refresh token revoked");
    }

    if (record.expires_at.getTime() <= Date.now()) {
      throw new Error("Refresh token expired");
    }

    const graceMs = this.config.REFRESH_ROTATION_GRACE_SECONDS * 1000;
    const raw = this.generateRawToken();
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(
      Date.now() + this.config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    /*
     * Lock, decide, and mint the successor in ONE transaction. Split across statements, a crash
     * in between would either leave the old token replayable or leave the user with no valid
     * token at all.
     */
    const outcome = await this.database.withoutTenantForAuth(async (tx) => {
      const [locked] = await tx<{ used_at: Date | null; revoked_at: Date | null }[]>`
        SELECT used_at, revoked_at
          FROM refresh_token
         WHERE id = ${record.id}
           FOR UPDATE
      `;

      // Re-read under the lock rather than trusting the pre-lock snapshot: the transaction that
      // held this row may have been a `revokeFamily` that finished while we were waiting.
      if (!locked || locked.revoked_at !== null) return "revoked" as const;

      if (locked.used_at !== null && Date.now() - locked.used_at.getTime() > graceMs) {
        return "reused" as const;
      }

      const graced = locked.used_at !== null;

      /*
       * `coalesce` keeps the ORIGINAL rotation timestamp on the grace path. Refreshing it would
       * let a stream of requests walk the window forward indefinitely, turning a bounded few
       * seconds into an unbounded lifetime for a token that has already been spent.
       */
      await tx`
        UPDATE refresh_token
           SET used_at = coalesce(used_at, now())
         WHERE id = ${record.id}
      `;

      /*
       * The successor inherits the principal of the token it replaces — never re-derived, so a
       * rotation can never move a session from one principal to another.
       *
       * A graced straggler gets a NEW token rather than a copy of the winner's: only the hash of
       * that one is stored, deliberately, so it cannot be handed out again. The cost is a couple
       * of extra live members in one family during a burst, all belonging to the same real
       * session; the browser keeps whichever response lands last and the rest are never presented.
       */
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

      return graced ? ("graced" as const) : ("rotated" as const);
    });

    if (outcome === "revoked") {
      throw new Error("Refresh token revoked");
    }

    if (outcome === "reused") {
      const revoked = await this.revokeFamily(record.family_id);
      this.logger.warn(
        `Refresh token reuse detected for ${record.principal_kind} ` +
          `${record.user_id ?? record.contact_id}; ` +
          `revoked ${revoked} token(s) in family ${record.family_id}`,
      );
      throw new TokenReuseDetectedError(record.family_id);
    }

    if (outcome === "graced") {
      /*
       * Logged at debug, not warn. This is the expected shape of a multi-tab client and will
       * happen routinely; at warn it would train everyone to ignore the line that also reports
       * real theft. A sustained flood of these on one family is still worth alerting on, and the
       * family id is here for exactly that.
       */
      this.logger.debug(
        `Refresh token presented again inside the ${this.config.REFRESH_ROTATION_GRACE_SECONDS}s ` +
          `rotation grace window for ${record.principal_kind} ` +
          `${record.user_id ?? record.contact_id}; family ${record.family_id}`,
      );
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
