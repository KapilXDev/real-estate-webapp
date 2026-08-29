import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  identityProviderEnum,
  orgStatusEnum,
  orgTypeEnum,
  userRoleEnum,
  userStatusEnum,
} from "./enums";

/**
 * Identity tables — mirrors `migrations/0003_identity.sql`.
 *
 * ⚠️ These definitions do NOT create the schema; the hand-written SQL does. Change the SQL first,
 * then mirror it here. Never run `drizzle-kit generate` against this file.
 */

/**
 * `citext` — case-insensitive text, used for email.
 *
 * Drizzle has no built-in citext, and mapping it to plain `text` would be quietly wrong: the
 * TypeScript types would agree while Postgres applied different comparison semantics, so a
 * developer would reasonably expect `lower(email)` to matter when it does not. Declaring it
 * explicitly keeps the model honest about what the column actually is.
 */
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

/** `inet` — Drizzle has no native mapping; stored as text on the client side. */
const inet = customType<{ data: string; driverData: string }>({
  dataType: () => "inet",
});

/* ------------------------------------------------------------------ *
 * Organisations — the tenant boundary
 * ------------------------------------------------------------------ */

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: orgTypeEnum("type").notNull(),
  status: orgStatusEnum("status").notNull().default("PENDING"),

  /**
   * RERA registration. Must appear in ALL advertising including the website; penalty runs to
   * ₹10 lakh. Jurisdiction is a COLUMN rather than a constant because the tricity spans two
   * authorities — Punjab RERA for Mohali/Kharar, and Chandigarh's own UT authority.
   */
  reraRegistrationNo: text("rera_registration_no"),
  reraJurisdiction: text("rera_jurisdiction"),
  reraValidUntil: date("rera_valid_until"),

  phone: text("phone"),
  email: citext("email"),
  addressLine: text("address_line"),
  logoKey: text("logo_key"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Staff users
 * ------------------------------------------------------------------ */

/**
 * ⚠️ Under FORCE ROW LEVEL SECURITY (see 0010). Any read through a normal connection is scoped to
 * `current_org_id()`. Pre-authentication lookup therefore CANNOT use this table directly — it goes
 * through the `auth_lookup_staff` SECURITY DEFINER function in 0011.
 */
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    email: citext("email").notNull().unique(),
    phone: text("phone"),
    /** Argon2id. Never anything else, and never returned to a client. */
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull().default("AGENT"),
    status: userStatusEnum("status").notNull().default("INVITED"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("app_user_org_idx").on(table.organizationId, table.status)],
);

/* ------------------------------------------------------------------ *
 * Refresh tokens — rotating, with reuse detection
 * ------------------------------------------------------------------ */

/**
 * `familyId` groups one rotation chain.
 *
 * Presenting a token that has already been used means theft or replay, so the correct response is
 * to revoke the ENTIRE family rather than reject the single request — otherwise the attacker
 * simply keeps using the branch they stole. This is the OAuth 2.1 recommendation and it is the
 * single highest-value property of this table.
 */
export const refreshToken = pgTable(
  "refresh_token",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /**
     * ⚠️ EXACTLY ONE of userId / contactId is set — staff and consumers are different tables
     * with no common parent, and a DB CHECK makes "both" and "neither" unrepresentable.
     * Two nullable FKs were chosen over a polymorphic id with no FK, because losing referential
     * integrity means deleting a principal silently orphans live sessions.
     */
    userId: uuid("user_id").references(() => appUser.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contact.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    /** SHA-256 of the token. The raw token is never stored, so a DB dump cannot be replayed. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("refresh_token_family_idx").on(table.familyId),
    index("refresh_token_user_idx")
      .on(table.userId)
      .where(sql`user_id IS NOT NULL`),
    index("refresh_token_contact_idx")
      .on(table.contactId)
      .where(sql`contact_id IS NOT NULL`),
  ],
);

/* ------------------------------------------------------------------ *
 * Consumers
 * ------------------------------------------------------------------ */

/**
 * Buyers and sellers. Deliberately separate from `appUser` so tenant RLS stays simple to reason
 * about: a contact belongs to no organisation, so there is no org column to scope and no policy
 * to get wrong.
 *
 * Phone is the primary identifier in this market, not email.
 */
export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    fullName: text("full_name"),
    primaryPhone: text("primary_phone"),
    primaryEmail: citext("primary_email"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial uniques: many contacts may have a NULL phone or email, but a present value is unique.
    uniqueIndex("contact_phone_uniq")
      .on(table.primaryPhone)
      .where(sql`primary_phone IS NOT NULL`),
    uniqueIndex("contact_email_uniq")
      .on(table.primaryEmail)
      .where(sql`primary_email IS NOT NULL`),
  ],
);

/**
 * One row per way of proving identity.
 *
 * This is what makes "log in with phone OTP today, link a Google account tomorrow" a data change
 * rather than a schema change — the reason the user asked for a linked identity model.
 */
export const contactIdentity = pgTable(
  "contact_identity",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    provider: identityProviderEnum("provider").notNull(),
    /** Phone, email, or OAuth subject. */
    providerUid: text("provider_uid").notNull(),
    /** Argon2id for PASSWORD; NULL for OTP and OAuth, which carry no local secret. */
    secretHash: text("secret_hash"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("contact_identity_provider_uid_uniq").on(table.provider, table.providerUid),
    index("contact_identity_contact_idx").on(table.contactId),
  ],
);

/* ------------------------------------------------------------------ *
 * OTP challenges
 * ------------------------------------------------------------------ */

/**
 * ⚠️ OTP endpoints are the most abused surface on any Indian consumer app. SMS-pumping fraud costs
 * real money per message sent, so rate limiting on top of this table is mandatory, not optional —
 * see OtpService and the throttler config in main.ts.
 *
 * Codes are hashed (never stored raw), single-use, attempt-limited and short-lived.
 */
export const otpChallenge = pgTable(
  "otp_challenge",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Phone or email. */
    destination: text("destination").notNull(),
    codeHash: text("code_hash").notNull(),
    /** LOGIN | VERIFY | RESET */
    purpose: text("purpose").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_active_idx")
      .on(table.destination, table.purpose)
      .where(sql`consumed_at IS NULL`),
  ],
);

/* ------------------------------------------------------------------ *
 * Inferred row types
 * ------------------------------------------------------------------ */

export type Organization = typeof organization.$inferSelect;
export type AppUser = typeof appUser.$inferSelect;
export type NewAppUser = typeof appUser.$inferInsert;
export type RefreshTokenRow = typeof refreshToken.$inferSelect;
export type Contact = typeof contact.$inferSelect;
export type ContactIdentity = typeof contactIdentity.$inferSelect;
export type OtpChallenge = typeof otpChallenge.$inferSelect;
