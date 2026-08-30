import { IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from "class-validator";

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "VIEWING",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const;

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  /**
   * Reassign, or `null` to unassign.
   *
   * ⚠️ `ValidateIf` rather than plain `IsOptional`: `IsOptional` skips validation for null AS WELL
   * AS undefined, which would silently accept any garbage as long as it were null-ish. Here null
   * is a meaningful value (unassign) and everything else must be a uuid, so the two cases have to
   * be told apart. The FK does the cross-org check — assigning to another organisation's user
   * fails on the constraint.
   */
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID("4")
  assignedUserId?: string | null;

  /** Free-text note appended to the activity trail alongside the change. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
