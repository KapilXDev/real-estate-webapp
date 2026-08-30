import { Transform } from "class-transformer";
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpsertReraDto {
  /**
   * The registration number exactly as issued.
   *
   * ⚠️ No format validation, deliberately. The three authorities use different and undocumented
   * formats, they change them, and this number's whole purpose is to be checkable against the
   * public register — so it has to be stored verbatim. A regex that rejected a valid number would
   * block the agent from publishing anything in that state, which is far worse than storing a
   * typo they can see and correct on screen.
   */
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  registrationNo!: string;

  /** Displayed beside the number so a buyer knows which regulator to check it against. */
  @IsString()
  @MinLength(4)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  authorityName!: string;

  /**
   * Expiry. Optional, but note `ReraRepository.findValid` treats an expired registration as
   * ABSENT — an expired number in an advertisement is a false claim of registration, which is
   * worse than none because it looks verified until someone checks.
   */
  @IsOptional()
  @IsISO8601()
  validUntil?: string;
}
