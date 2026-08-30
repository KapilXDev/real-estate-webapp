import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Staff write DTOs.
 *
 * Validation is stricter here than on the public search endpoint, for the opposite reason to what
 * you might expect: search filters a stranger's *query*, but this is the data a buyer will read
 * and act on. A wrong price or a wrong locality here becomes a wrong statement on a public page.
 *
 * ⚠️ THERE IS NO `organizationId` FIELD ON EITHER DTO, DELIBERATELY. The tenant comes from the
 * authenticated principal. Accepting it from the body — even "just for admins" — is how a write
 * endpoint becomes a cross-tenant write endpoint.
 */

const PROPERTY_TYPES = [
  "plot", "kothi", "builder-floor", "flat", "villa", "sco", "scf", "booth", "farmhouse",
] as const;
const POSSESSION = ["ready-to-move", "under-construction", "new-launch"] as const;
const FURNISHING = ["unfurnished", "semi-furnished", "fully-furnished"] as const;
const FACING = [
  "north", "south", "east", "west", "north-east", "north-west", "south-east", "south-west",
] as const;
const AREA_UNITS = ["SQ_FT", "SQ_YD", "MARLA", "KANAL", "ACRE", "BIGHA", "SQ_M"] as const;
const WRITABLE_STATUSES = ["active", "under-offer", "sold", "rented", "coming-soon"] as const;

export class CreateListingDto {
  /* --- Location ------------------------------------------------------------------------ */

  /** Slug pair, never a bare locality — see the note in SearchListingsDto. */
  @IsString() @MaxLength(60)
  citySlug!: string;

  @IsString() @MaxLength(80)
  localitySlug!: string;

  /**
   * ⚠️ Bounded to the tricity, not to the planet.
   *
   * A transposed lat/lng — the single most common PostGIS data-entry error — turns Chandigarh
   * (30.73, 76.77) into (76.77, 30.73), a valid coordinate in the Barents Sea. Both pass a
   * -90..90 / -180..180 check and the listing simply never appears in a map search. A regional
   * bound catches it at the door, where the error message can say what is wrong.
   */
  @Type(() => Number) @IsNumber() @Min(29.5) @Max(32.0)
  lat!: number;

  @Type(() => Number) @IsNumber() @Min(75.5) @Max(77.5)
  lng!: number;

  @IsOptional() @IsString() @MaxLength(200)
  addressLine?: string;

  @IsOptional() @IsString() @MaxLength(40)
  plotNumber?: string;

  @IsOptional() @Matches(/^\d{6}$/, { message: "Pincode must be 6 digits" })
  pincode?: string;

  /* --- Property ------------------------------------------------------------------------ */

  @IsIn(PROPERTY_TYPES)
  propertyType!: (typeof PROPERTY_TYPES)[number];

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  plotAreaSqft?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  builtUpAreaSqft?: number;

  /** Carpet area — the RERA basis for under-construction sale. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  carpetAreaSqft?: number;

  /**
   * The figure the seller actually typed, and which area it refers to.
   *
   * ⚠️ All four move together — `property_area_input_complete` enforces it at the database level.
   * A value with no unit, or a unit with no basis, is unusable data that surfaces as a wrong
   * number on a page. `areaInputBasis` is what stops "10 marla" being echoed beside the carpet
   * area when the seller meant the plot.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  areaInputValue?: number;

  @IsOptional() @IsIn(AREA_UNITS)
  areaInputUnit?: (typeof AREA_UNITS)[number];

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  areaConversionFactor?: number;

  @IsOptional() @IsIn(["PLOT", "BUILT_UP", "CARPET"])
  areaInputBasis?: "PLOT" | "BUILT_UP" | "CARPET";

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  bedrooms?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  bathrooms?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  balconies?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(200)
  totalFloors?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(-5) @Max(200)
  floorNumber?: number;

  @IsOptional() @IsIn(FACING)
  facing?: (typeof FACING)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1850) @Max(2100)
  yearBuilt?: number;

  /* --- Offer --------------------------------------------------------------------------- */

  @IsOptional() @IsIn(["sale", "rent", "lease"])
  transactionType?: "sale" | "rent" | "lease";

  /**
   * ⚠️ RUPEES. Not lakh, not crore, not a formatted string.
   *
   * `85` here means eighty-five rupees, and a caller that means 85 lakh must send 8500000.
   * Misreading this is a 10⁵ error that would render as "₹85" on a kothi. `parsePriceInput` in
   * @tricity/domain is what converts an agent's "85 lakh" at the UI edge; by the time it reaches
   * this DTO it must already be a plain rupee figure.
   */
  @Type(() => Number) @IsNumber() @Min(1) @Max(100_000_000_000)
  price!: number;

  @IsOptional() @IsBoolean()
  priceOnRequest?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maintenanceCharges?: number;

  @IsIn(POSSESSION)
  possession!: (typeof POSSESSION)[number];

  /** ISO date. The DB rejects one on a ready-to-move listing — a contradiction, not a warning. */
  @IsOptional() @IsISO8601()
  possessionDate?: string;

  @IsOptional() @IsIn(FURNISHING)
  furnishing?: (typeof FURNISHING)[number];

  @IsOptional() @IsIn(WRITABLE_STATUSES)
  status?: (typeof WRITABLE_STATUSES)[number];

  /**
   * ⚠️ Defaults to PUBLIC, matching the column default.
   *
   * Worth stating because the safer-looking default would be PRIVATE — but a listing nobody can
   * see is a listing an agent believes they published. The visible failure is the right one here;
   * publication is gated on RERA registration instead, which is the control that actually matters.
   */
  @IsOptional() @IsIn(["PUBLIC", "NETWORK_ONLY", "PRIVATE"])
  visibility?: "PUBLIC" | "NETWORK_ONLY" | "PRIVATE";

  @IsOptional() @IsString() @MaxLength(200)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  title?: string;

  @IsOptional() @IsString() @MaxLength(8000)
  description?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(40)
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.filter((f) => typeof f === "string").map((f: string) => f.trim().slice(0, 60))
      : value,
  )
  features?: string[];
}

/**
 * Partial update. Every field optional; absent means "leave alone".
 *
 * Location and property attributes are deliberately NOT updatable here — changing the locality or
 * coordinates of an existing listing means it is a different property, and silently rewriting the
 * row would drag its leads, price history and any partner's view of it along with it.
 */
export class UpdateListingDto {
  @IsOptional() @IsIn(WRITABLE_STATUSES)
  status?: (typeof WRITABLE_STATUSES)[number];

  @IsOptional() @IsIn(["PUBLIC", "NETWORK_ONLY", "PRIVATE"])
  visibility?: "PUBLIC" | "NETWORK_ONLY" | "PRIVATE";

  @IsOptional() @IsIn(POSSESSION)
  possession?: (typeof POSSESSION)[number];

  @IsOptional() @IsISO8601()
  possessionDate?: string | null;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100_000_000_000)
  price?: number;

  @IsOptional() @IsBoolean()
  priceOnRequest?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maintenanceCharges?: number | null;

  @IsOptional() @IsIn(FURNISHING)
  furnishing?: (typeof FURNISHING)[number] | null;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string | null;

  @IsOptional() @IsString() @MaxLength(8000)
  description?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(40)
  features?: string[];

  /** Only meaningful with a SOLD/RENTED status — the DB rejects the combination otherwise. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  closePrice?: number | null;
}
