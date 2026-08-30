import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * Lead intake DTO.
 *
 * ⚠️ VALIDATION HERE IS DELIBERATELY FORGIVING, and that is a commercial decision rather than
 * sloppiness. A lead rejected over a formatting quibble is a lost customer; a slightly messy row
 * is thirty seconds of an agent's time to tidy. So the rule is: reject only what is genuinely
 * unusable, and cap everything else.
 *
 * The length caps are the real defence on an unauthenticated public endpoint — they bound both
 * memory and how much text an attacker can make us store.
 */

/** Normalise an Indian mobile to E.164. Mirrors the OTP DTO so one person is one contact row. */
function normalisePhone(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const digits = value.replace(/[^\d+]/g, "");
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return digits;
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

class RequirementDto {
  @IsOptional() @IsString() @MaxLength(60) citySlug?: string;
  @IsOptional() @IsString() @MaxLength(80) localitySlug?: string;
  @IsOptional() @IsString() @MaxLength(40) propertyType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bedrooms?: number;
}

class LeadSourceDtoIn {
  @IsOptional() @IsString() @MaxLength(500) page?: string;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @IsOptional() @IsString() @MaxLength(120) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(120) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(120) utmCampaign?: string;
}

export class CreateLeadDto {
  @IsIn(["tour-request", "home-valuation", "contact", "saved-search"])
  kind!: "tour-request" | "home-valuation" | "contact" | "saved-search";

  @IsString()
  @MinLength(1, { message: "Please tell us your name" })
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  /**
   * ⚠️ Loose on purpose — `something@something.tld` and nothing more.
   *
   * Strict RFC-ish regexes reject valid addresses (apostrophes, long TLDs, subaddressing), and
   * every one of those rejections is a real person who wanted to buy a house being told their
   * email is wrong. The cost of accepting a typo is a bounced email; the cost of rejecting a
   * valid address is the whole customer.
   */
  @IsEmail({}, { message: "Please enter a valid email address" })
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  email!: string;

  /**
   * Optional, and it is the field that matters most — see the weighting in LeadScoringService.
   * Accepted in any format an Indian buyer might type and normalised to E.164; a number that
   * cannot be normalised is rejected rather than stored mangled, because an unreachable number is
   * worse than none (it looks contactable).
   */
  @IsOptional()
  @Transform(({ value }) => normalisePhone(value))
  @Matches(/^\+91[6-9]\d{9}$/, { message: "Enter a valid Indian mobile number" })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(2000) @Transform(trim)
  message?: string;

  /**
   * WhatsApp consent, captured at the point of collection.
   *
   * Explicit and default-false. Consent has to be given, not inferred from the fact that someone
   * typed a phone number into a form — and the audit trail for that lives on the contact row.
   */
  @IsOptional() @IsBoolean()
  whatsappOptIn?: boolean;

  /** Listing this enquiry is about. An unknown key drops the context, never the lead. */
  @IsOptional() @IsString() @MaxLength(64)
  listingKey?: string;

  @IsOptional() @IsISO8601()
  preferredDate?: string;

  @IsOptional() @IsString() @MaxLength(300) @Transform(trim)
  propertyAddress?: string;

  @IsOptional() @IsString() @MaxLength(120) @Transform(trim)
  timeframe?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => RequirementDto)
  requirement?: RequirementDto;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => LeadSourceDtoIn)
  source?: LeadSourceDtoIn;
}
