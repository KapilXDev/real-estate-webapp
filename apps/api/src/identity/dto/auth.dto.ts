import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";

/**
 * Request DTOs.
 *
 * Validation posture differs by field on purpose: identifiers are validated strictly because a
 * malformed one cannot succeed anyway, while human-supplied text is only length-capped. The
 * length caps are the real defence on an unauthenticated public endpoint — they bound both memory
 * and the cost of hashing attacker-supplied input.
 */

/** Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX). */
function normalisePhone(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const digits = value.replace(/[^\d+]/g, "");

  // Already E.164.
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;
  // 10-digit local — Indian mobiles start 6-9.
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  // 0-prefixed STD form, still common when people type from memory.
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  // 91-prefixed without the plus.
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;

  // Anything else is returned unchanged and rejected by the validator below, so the user gets a
  // clear error rather than a silently mangled number.
  return digits;
}

export class StaffLoginDto {
  @IsEmail({}, { message: "A valid email address is required" })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  email!: string;

  /**
   * Only a minimum length is enforced. Composition rules (upper/lower/symbol) are not applied
   * deliberately — NIST SP 800-63B advises against them; they push people toward predictable
   * substitutions without measurably improving strength. The upper bound exists so nobody can
   * make us Argon2-hash a megabyte.
   */
  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters" })
  @MaxLength(256)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}

/* ------------------------------------------------------------------ *
 * Consumer (contact) auth
 * ------------------------------------------------------------------ */

export class RequestOtpDto {
  @Transform(({ value }) => normalisePhone(value))
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: "Enter a valid Indian mobile number",
  })
  phone!: string;
}

export class VerifyOtpDto {
  @Transform(({ value }) => normalisePhone(value))
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: "Enter a valid Indian mobile number",
  })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: "Enter the 6-digit code" })
  @Matches(/^\d{6}$/, { message: "Enter the 6-digit code" })
  code!: string;

  /** Optional: captured on first login so we do not need a separate profile step. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  fullName?: string;

  /**
   * WhatsApp is the dominant channel here, so opt-in is offered at signup rather than buried in
   * settings. Explicit and default-false — consent has to be given, not assumed.
   */
  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;
}

export class ContactPasswordLoginDto {
  @IsEmail({}, { message: "A valid email address is required" })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters" })
  @MaxLength(256)
  password!: string;
}

/**
 * Add an email+password credential to an existing (phone-verified) contact.
 *
 * This is the "like fb/insta" linked-identity flow the user asked for: one person, several ways
 * in. It requires an authenticated contact, so it attaches to the account already proven by OTP
 * rather than creating a second one.
 */
export class LinkEmailPasswordDto {
  @IsEmail({}, { message: "A valid email address is required" })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters" })
  @MaxLength(256)
  password!: string;
}

export class RegisterStaffDto {
  @IsEmail({}, { message: "A valid email address is required" })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(256)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  fullName!: string;

  @IsIn(["OWNER", "ADMIN", "AGENT", "STAFF"])
  role!: "OWNER" | "ADMIN" | "AGENT" | "STAFF";
}
