import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { APP_CONFIG, type AppConfig } from "../config/configuration";
import { DatabaseService } from "../database/database.service";

/**
 * One-time passcodes for phone login.
 *
 * ⚠️ THIS IS THE MOST ABUSED ENDPOINT ON ANY INDIAN CONSUMER APP.
 *
 * "SMS pumping" (a.k.a. artificially inflated traffic) is a real and common fraud: an attacker
 * drives a request loop against your send-OTP endpoint using numbers on a premium range they
 * control, and takes a cut of the termination fees. Every message costs you money. Unlike most
 * abuse, the damage is a direct bill rather than degraded service, and it can run to lakhs before
 * anyone notices.
 *
 * The defences here, all of which matter:
 *   - per-destination cooldown between sends (this file)
 *   - per-IP rate limiting (the throttler, in main.ts)
 *   - short expiry and hard attempt cap (this file + a CHECK constraint in 0003)
 *   - codes stored hashed, compared in constant time
 *
 * The one deliberately NOT here: silently swallowing requests for unknown numbers. See
 * `request()` — enumeration resistance beats the marginal cost saving.
 */

export type OtpPurpose = "LOGIN" | "VERIFY" | "RESET";

export interface OtpRequestResult {
  /** Seconds until another code may be requested for this destination. */
  retryAfterSeconds: number;
  /**
   * The generated code — ONLY populated outside production, so local development does not need a
   * live SMS provider. Never returned to a client; see the controller.
   */
  devCode?: string;
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "not-found" | "too-many-attempts" | "mismatch" };

interface ChallengeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Six digits, from a CSPRNG.
   *
   * `randomInt` rather than `Math.random()`: predictable codes would make the whole mechanism
   * decorative. Six digits is the Indian convention — deviating trains users to distrust it.
   */
  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  /**
   * SHA-256, salted with the destination.
   *
   * Argon2 would be wrong here for a different reason than usual: a six-digit code has only a
   * million possibilities, so no KDF makes an offline attack on the hash infeasible. What
   * actually protects the code is that it lives for five minutes and allows five attempts. The
   * hash exists so a database dump does not hand over live codes; binding it to the destination
   * stops a code issued for one number being replayed against another.
   */
  private hashCode(destination: string, code: string): string {
    return createHash("sha256").update(`${destination}:${code}`).digest("hex");
  }

  /**
   * Issue a code for a destination.
   *
   * ⚠️ Returns a cooldown rather than throwing when one is active, and the CALLER MUST RESPOND
   * IDENTICALLY whether or not a code was actually sent. Differentiating leaks which numbers are
   * registered, which is exactly the enumeration this is meant to resist.
   */
  async request(params: {
    destination: string;
    purpose: OtpPurpose;
  }): Promise<OtpRequestResult> {
    const { destination, purpose } = params;

    const cooldown = await this.remainingCooldown(destination, purpose);
    if (cooldown > 0) {
      return { retryAfterSeconds: cooldown };
    }

    const code = this.generateCode();
    const codeHash = this.hashCode(destination, code);
    const expiresAt = new Date(Date.now() + this.config.OTP_TTL_SECONDS * 1000);

    await this.database.withoutTenantForAuth(async (tx) => {
      /*
       * Consume any outstanding challenge for this destination+purpose before issuing a new one.
       * Without this, every resend would leave another live code valid, and requesting ten codes
       * would give an attacker ten simultaneous guesses against the attempt cap.
       */
      await tx`
        UPDATE otp_challenge
           SET consumed_at = now()
         WHERE destination = ${destination}
           AND purpose = ${purpose}
           AND consumed_at IS NULL
      `;

      await tx`
        INSERT INTO otp_challenge (destination, code_hash, purpose, expires_at)
        VALUES (${destination}, ${codeHash}, ${purpose}, ${expiresAt})
      `;
    });

    /*
     * TODO — wire a real SMS/WhatsApp provider here (MSG91, Gupshup, or WhatsApp Business API).
     * Deliberately not stubbed with a fake integration: it needs real credentials, a DLT template
     * registration (mandatory for transactional SMS in India), and sender-ID approval.
     *
     * Until then the code is logged in development only. Logging it in production would put live
     * credentials in the log pipeline.
     */
    if (!this.config.isProduction) {
      this.logger.debug(`OTP for ${destination} (${purpose}): ${code}`);
      return { retryAfterSeconds: this.config.OTP_RESEND_COOLDOWN_SECONDS, devCode: code };
    }

    return { retryAfterSeconds: this.config.OTP_RESEND_COOLDOWN_SECONDS };
  }

  /**
   * Verify a submitted code and consume the challenge on success.
   *
   * Attempts are incremented BEFORE the comparison, so a crash or a dropped connection mid-verify
   * still costs the attacker an attempt. Incrementing afterwards would let someone burn unlimited
   * guesses by disconnecting each time.
   */
  async verify(params: {
    destination: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<OtpVerifyResult> {
    const { destination, purpose, code } = params;

    return this.database.withoutTenantForAuth(async (tx) => {
      const rows = await tx<ChallengeRow[]>`
        SELECT id, code_hash, attempts, expires_at, consumed_at
          FROM otp_challenge
         WHERE destination = ${destination}
           AND purpose = ${purpose}
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE
      `;

      const challenge = rows[0];
      if (!challenge) return { ok: false, reason: "not-found" };

      if (challenge.expires_at.getTime() <= Date.now()) {
        await tx`UPDATE otp_challenge SET consumed_at = now() WHERE id = ${challenge.id}`;
        return { ok: false, reason: "expired" };
      }

      if (challenge.attempts >= this.config.OTP_MAX_ATTEMPTS) {
        await tx`UPDATE otp_challenge SET consumed_at = now() WHERE id = ${challenge.id}`;
        return { ok: false, reason: "too-many-attempts" };
      }

      await tx`
        UPDATE otp_challenge SET attempts = attempts + 1 WHERE id = ${challenge.id}
      `;

      if (!this.constantTimeEquals(challenge.code_hash, this.hashCode(destination, code))) {
        return { ok: false, reason: "mismatch" };
      }

      await tx`UPDATE otp_challenge SET consumed_at = now() WHERE id = ${challenge.id}`;
      return { ok: true };
    });
  }

  /** Seconds remaining before another code may be sent, or 0 if one may be sent now. */
  private async remainingCooldown(destination: string, purpose: OtpPurpose): Promise<number> {
    const rows = await this.database.withoutTenantForAuth(
      async (tx) =>
        tx<{ created_at: Date }[]>`
          SELECT created_at
            FROM otp_challenge
           WHERE destination = ${destination}
             AND purpose = ${purpose}
           ORDER BY created_at DESC
           LIMIT 1
        `,
    );

    const last = rows[0];
    if (!last) return 0;

    const elapsedSeconds = (Date.now() - last.created_at.getTime()) / 1000;
    const remaining = Math.ceil(this.config.OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Constant-time comparison.
   *
   * `timingSafeEqual` throws on length mismatch, which would itself leak, so lengths are checked
   * first — safe here because both sides are fixed-length hex digests of the same hash function.
   */
  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
