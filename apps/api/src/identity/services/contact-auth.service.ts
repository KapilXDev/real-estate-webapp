import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";

import { DatabaseService } from "../../database/database.service";
import { OtpService } from "./otp.service";
import { PasswordService } from "./password.service";
import { TokenReuseDetectedError, TokenService } from "./token.service";

/**
 * Consumer authentication — buyers and sellers.
 *
 * ⚠️ CONTACTS ARE NOT `app_user`. They belong to no organisation, so they are outside RLS
 * entirely. Their access tokens carry `org: null`, which means a contact token can never satisfy
 * a tenant-scoped policy — a buyer cannot read a brokerage's private inventory even if they
 * somehow reached a staff endpoint. That is the design, not an oversight.
 *
 * LINKED IDENTITY MODEL (the "like fb/insta" requirement): one `contact` row is the person; each
 * `contact_identity` row is a way of proving they are that person. Phone OTP today, email and
 * password once they set one, Google tomorrow — all resolving to the same account, with no schema
 * change needed to add a provider.
 *
 * Phone is the primary identifier because that is what this market uses. Email is secondary and
 * optional.
 */

interface ContactRow {
  id: string;
  full_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  whatsapp_opt_in: boolean;
}

interface IdentityRow {
  id: string;
  contact_id: string;
  provider: string;
  provider_uid: string;
  secret_hash: string | null;
  verified_at: Date | null;
}

export interface ContactAuthResult {
  accessToken: string;
  refreshToken: string;
  contact: {
    id: string;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    whatsappOptIn: boolean;
  };
}

@Injectable()
export class ContactAuthService {
  private readonly logger = new Logger(ContactAuthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Send a login code.
   *
   * ⚠️ Deliberately does NOT check whether the number belongs to an existing contact, and the
   * controller returns the same shape either way. Two reasons:
   *   1. Login and signup are one flow here — a new number simply creates an account on verify,
   *      which is the expected UX for phone-first auth.
   *   2. Answering differently for known and unknown numbers is a free enumeration oracle.
   */
  async requestLoginOtp(phone: string) {
    return this.otp.request({ destination: phone, purpose: "LOGIN" });
  }

  /**
   * Verify the code and issue tokens, creating the contact on first use.
   *
   * The whole thing runs in ONE transaction. A crash between "create contact" and "create
   * identity" would otherwise leave a contact that can never log in again — its phone would be
   * taken by the unique index, but with no identity row to authenticate against.
   */
  async verifyLoginOtp(params: {
    phone: string;
    code: string;
    fullName?: string;
    whatsappOptIn?: boolean;
    userAgent?: string;
    ip?: string;
  }): Promise<ContactAuthResult> {
    const result = await this.otp.verify({
      destination: params.phone,
      purpose: "LOGIN",
      code: params.code,
    });

    if (!result.ok) {
      // One message for every failure mode. "Expired" vs "wrong code" tells a brute-forcer
      // whether to keep guessing this code or request a fresh one.
      throw new UnauthorizedException("That code is not valid. Request a new one.");
    }

    const contact = await this.database.withoutTenantForAuth(async (tx) => {
      const existing = await tx<ContactRow[]>`
        SELECT c.id, c.full_name, c.primary_phone, c.primary_email, c.whatsapp_opt_in
          FROM contact c
          JOIN contact_identity ci ON ci.contact_id = c.id
         WHERE ci.provider = 'PHONE_OTP'
           AND ci.provider_uid = ${params.phone}
      `;

      if (existing[0]) {
        const row = existing[0];

        await tx`
          UPDATE contact_identity
             SET last_used_at = now(),
                 verified_at = coalesce(verified_at, now())
           WHERE provider = 'PHONE_OTP' AND provider_uid = ${params.phone}
        `;

        /*
         * Fill in the name only if we do not already have one, and never clear an existing value
         * from an optional field on a login request. Opt-in is only ever moved to true here —
         * withdrawing consent is a settings action, not a side effect of signing in.
         */
        if (params.fullName || params.whatsappOptIn) {
          await tx`
            UPDATE contact
               SET full_name = coalesce(full_name, ${params.fullName ?? null}),
                   whatsapp_opt_in = whatsapp_opt_in OR ${params.whatsappOptIn ?? false},
                   updated_at = now()
             WHERE id = ${row.id}
          `;
        }

        return row;
      }

      const created = await tx<ContactRow[]>`
        INSERT INTO contact (full_name, primary_phone, phone_verified_at, whatsapp_opt_in)
        VALUES (
          ${params.fullName ?? null},
          ${params.phone},
          now(),
          ${params.whatsappOptIn ?? false}
        )
        RETURNING id, full_name, primary_phone, primary_email, whatsapp_opt_in
      `;

      const row = created[0]!;

      await tx`
        INSERT INTO contact_identity (contact_id, provider, provider_uid, verified_at, last_used_at)
        VALUES (${row.id}, 'PHONE_OTP', ${params.phone}, now(), now())
      `;

      return row;
    });

    return this.issueTokens(contact, params.userAgent, params.ip);
  }

  /**
   * Email + password login for a contact who has linked those credentials.
   *
   * Same uniform-failure and timing discipline as staff login — see StaffAuthService.login.
   */
  async loginWithPassword(params: {
    email: string;
    password: string;
    userAgent?: string;
    ip?: string;
  }): Promise<ContactAuthResult> {
    const rows = await this.database.withoutTenantForAuth(
      async (tx) => tx<(IdentityRow & ContactRow)[]>`
        SELECT ci.id, ci.contact_id, ci.provider, ci.provider_uid, ci.secret_hash, ci.verified_at,
               c.full_name, c.primary_phone, c.primary_email, c.whatsapp_opt_in
          FROM contact_identity ci
          JOIN contact c ON c.id = ci.contact_id
         WHERE ci.provider = 'PASSWORD'
           AND ci.provider_uid = ${params.email}
      `,
    );

    const row = rows[0];

    if (!row?.secret_hash) {
      await this.passwords.fakeVerify(params.password);
      throw new UnauthorizedException("Invalid email or password");
    }

    const ok = await this.passwords.verify(row.secret_hash, params.password);
    if (!ok) throw new UnauthorizedException("Invalid email or password");

    await this.database.withoutTenantForAuth(async (tx) => {
      await tx`UPDATE contact_identity SET last_used_at = now() WHERE id = ${row.id}`;
    });

    return this.issueTokens(
      {
        id: row.contact_id,
        full_name: row.full_name,
        primary_phone: row.primary_phone,
        primary_email: row.primary_email,
        whatsapp_opt_in: row.whatsapp_opt_in,
      },
      params.userAgent,
      params.ip,
    );
  }

  /**
   * Attach an email+password credential to an already-authenticated contact.
   *
   * This is what makes the identity model "linked" rather than "multiple accounts". The contact
   * must already be signed in (by OTP), so we are adding a credential to a proven identity rather
   * than trusting an unverified email to claim one.
   */
  async linkEmailPassword(params: {
    contactId: string;
    email: string;
    password: string;
  }): Promise<void> {
    const secretHash = await this.passwords.hash(params.password);

    await this.database.withoutTenantForAuth(async (tx) => {
      const taken = await tx<{ contact_id: string }[]>`
        SELECT contact_id FROM contact_identity
         WHERE provider = 'PASSWORD' AND provider_uid = ${params.email}
      `;

      if (taken[0] && taken[0].contact_id !== params.contactId) {
        throw new ConflictException("That email is already linked to another account");
      }

      await tx`
        INSERT INTO contact_identity (contact_id, provider, provider_uid, secret_hash, verified_at)
        VALUES (${params.contactId}, 'PASSWORD', ${params.email}, ${secretHash}, NULL)
        ON CONFLICT (provider, provider_uid)
        DO UPDATE SET secret_hash = EXCLUDED.secret_hash
      `;

      /*
       * The email is recorded but NOT marked verified — a VERIFY OTP still has to be completed.
       * Setting email_verified_at here would let someone claim an address they do not control and
       * then use it for password recovery.
       */
      await tx`
        UPDATE contact
           SET primary_email = coalesce(primary_email, ${params.email}),
               updated_at = now()
         WHERE id = ${params.contactId}
      `;
    });
  }

  /** Exchange a refresh token for a new pair. */
  async refresh(params: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const rotated = await this.tokens.rotate({
        raw: params.refreshToken,
        userAgent: params.userAgent,
        ip: params.ip,
      });

      const { record } = rotated;

      // Symmetric to the staff check: a staff token presented here must not be downgraded into
      // a contact token, which would quietly strip the org claim and confuse later authorisation.
      if (record.principal_kind !== "contact" || !record.contact_id) {
        await this.tokens.revokeFamily(record.family_id);
        throw new UnauthorizedException("Session expired, please sign in again");
      }

      const accessToken = await this.tokens.signAccessToken({
        sub: record.contact_id,
        org: null,
        role: "CONTACT",
        kind: "contact",
      });

      return { accessToken, refreshToken: rotated.refreshToken };
    } catch (error) {
      // Already the right shape — do not re-wrap and lose the distinction.
      if (error instanceof UnauthorizedException) throw error;
      if (error instanceof TokenReuseDetectedError) {
        throw new UnauthorizedException("Session expired, please sign in again");
      }
      throw new UnauthorizedException("Session expired, please sign in again");
    }
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }

  private async issueTokens(
    contact: ContactRow,
    userAgent?: string,
    ip?: string,
  ): Promise<ContactAuthResult> {
    const accessToken = await this.tokens.signAccessToken({
      sub: contact.id,
      // Null, always. A consumer belongs to no tenant and must never satisfy an org policy.
      org: null,
      role: "CONTACT",
      kind: "contact",
    });

    const { refreshToken } = await this.tokens.issueRefreshToken({
      contactId: contact.id,
      userAgent,
      ip,
    });

    return {
      accessToken,
      refreshToken,
      contact: {
        id: contact.id,
        fullName: contact.full_name,
        phone: contact.primary_phone,
        email: contact.primary_email,
        whatsappOptIn: contact.whatsapp_opt_in,
      },
    };
  }
}
