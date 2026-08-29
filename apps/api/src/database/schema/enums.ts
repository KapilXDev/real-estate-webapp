import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enum types.
 *
 * ⚠️ THESE MIRROR `migrations/0002_enums.sql` — they do not create it.
 *
 * DDL is hand-written SQL by deliberate decision (see BUILD_LOG step 9): the schema needs PostGIS
 * geography columns, generated tsvectors, CHECK constraints, SECURITY DEFINER functions and RLS
 * policies, none of which Drizzle's generator models well. Drizzle is here for query typing only.
 *
 * Never run `drizzle-kit generate` against these. If you change an enum, change the SQL first and
 * mirror it here — the reverse will silently drift.
 */

export const orgTypeEnum = pgEnum("org_type", ["BROKERAGE", "PARTNER", "BUILDER"]);
export const orgStatusEnum = pgEnum("org_status", ["PENDING", "ACTIVE", "SUSPENDED"]);

export const userRoleEnum = pgEnum("user_role", ["OWNER", "ADMIN", "AGENT", "STAFF"]);
export const userStatusEnum = pgEnum("user_status", ["INVITED", "ACTIVE", "DISABLED"]);

export const identityProviderEnum = pgEnum("identity_provider", [
  "PHONE_OTP",
  "PASSWORD",
  "GOOGLE",
  "FACEBOOK",
]);

export const localityKindEnum = pgEnum("locality_kind", [
  "SECTOR",
  "PHASE",
  "ENCLAVE",
  "COLONY",
  "VILLAGE",
  "ROAD_BELT",
]);

export const propertyTypeEnum = pgEnum("property_type", [
  "PLOT",
  "KOTHI",
  "BUILDER_FLOOR",
  "FLAT",
  "SCO",
  "SCF",
  "BOOTH",
  "SHOWROOM",
  "FARMHOUSE",
  "INDUSTRIAL",
]);

export const transactionTypeEnum = pgEnum("transaction_type", ["SALE", "RENT", "LEASE"]);
export const furnishingEnum = pgEnum("furnishing", [
  "UNFURNISHED",
  "SEMI_FURNISHED",
  "FURNISHED",
]);
export const facingEnum = pgEnum("facing", [
  "NORTH",
  "SOUTH",
  "EAST",
  "WEST",
  "NE",
  "NW",
  "SE",
  "SW",
]);
export const areaUnitEnum = pgEnum("area_unit", [
  "SQ_FT",
  "SQ_YD",
  "MARLA",
  "KANAL",
  "ACRE",
  "BIGHA",
  "SQ_M",
]);

export const listingStatusEnum = pgEnum("listing_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "UNDER_OFFER",
  "SOLD",
  "RENTED",
  "WITHDRAWN",
  "REJECTED",
  "EXPIRED",
]);
export const listingSourceEnum = pgEnum("listing_source", [
  "OWN",
  "PARTNER",
  "BUILDER",
  "IMPORT",
]);
export const listingVisibilityEnum = pgEnum("listing_visibility", [
  "PUBLIC",
  "NETWORK_ONLY",
  "PRIVATE",
]);

export const partnerTierEnum = pgEnum("partner_tier", [
  "OWN_ONLY",
  "PUBLIC_PLUS_OWN",
  "NETWORK",
  "FULL",
]);
export const partnerStatusEnum = pgEnum("partner_status", [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
]);

export const leadChannelEnum = pgEnum("lead_channel", [
  "WEB",
  "WHATSAPP",
  "CALL",
  "WALK_IN",
  "REFERRAL",
]);
export const leadStatusEnum = pgEnum("lead_status", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "VIEWING",
  "NEGOTIATING",
  "WON",
  "LOST",
]);

/* Convenience unions for use outside Drizzle queries. */
export type OrgType = (typeof orgTypeEnum.enumValues)[number];
export type OrgStatus = (typeof orgStatusEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type IdentityProvider = (typeof identityProviderEnum.enumValues)[number];
