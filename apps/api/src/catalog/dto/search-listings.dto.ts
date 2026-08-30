import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type {
  BoundsDto,
  ListingSearchParamsDto,
  LocalityRefDto,
  PolygonDto,
} from "@tricity/contracts";

// ⚠️ Local, NOT the identical function in @tricity/contracts — a value import from that package
// cannot survive this app's CommonJS build. See the note in utils/locality-ref.ts.
import { parseLocalityRef } from "../utils/locality-ref";

/**
 * Query-string DTO for the public search endpoint.
 *
 * ⚠️ THIS IS THE MOST EXPOSED SURFACE ON THE PLATFORM: unauthenticated, cacheable, and reachable
 * by anyone. Everything here exists to bound the work a stranger can ask the database to do.
 *
 * Two things the type system cannot express and that bite in query strings specifically:
 *
 *  1. **Everything arrives as a string.** `?minPrice=5000000` is `"5000000"`, and
 *     `"5000000" > 1000000` compares lexically. Every numeric field is `@Type(() => Number)`.
 *  2. **A repeated key is an array, a single one is a scalar.** `?propertyTypes=flat` gives a
 *     string, `?propertyTypes=flat&propertyTypes=plot` gives an array. Code that assumes an array
 *     gets `"flat".map is not a function` — in production, on one specific filter combination.
 *     `asArray` below normalises that once so nothing downstream has to think about it.
 */

/** Normalise "one value or many" into always-many. */
function asArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** Parse a JSON-encoded parameter, returning undefined rather than throwing on malformed input. */
function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    // A hand-mangled URL must not 500 the search page. Dropping the filter degrades to a broader
    // result set, which is visibly wrong to the user and harmless to the server.
    return undefined;
  }
}

const PROPERTY_TYPES = [
  "plot", "kothi", "builder-floor", "flat", "villa", "sco", "scf", "booth", "farmhouse",
] as const;
const STATUSES = ["active", "under-offer", "sold", "rented", "coming-soon"] as const;
const POSSESSION = ["ready-to-move", "under-construction", "new-launch"] as const;
const FURNISHING = ["unfurnished", "semi-furnished", "fully-furnished"] as const;
const SORTS = ["newest", "price-asc", "price-desc", "beds-desc", "area-desc"] as const;

export class SearchListingsDto {
  @IsOptional()
  @IsString()
  // Length cap, not a character whitelist: the value is a bind parameter, so injection is not the
  // risk. Unbounded text handed to to_tsquery is — the cost of parsing it is the attack.
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => asArray(value))
  @IsArray()
  citySlugs?: string[];

  /**
   * `?area=mohali/sector-70`, repeated.
   *
   * ⚠️ THE PROPERTY IS NAMED `area`, NOT `localities`, AND IT HAS TO BE.
   *
   * The global ValidationPipe runs with `forbidNonWhitelisted`, so a query key that does not
   * match a property name on this class is a 400 — not an ignored parameter. Naming the field
   * `localities` while the wire says `area` made every locality-filtered search fail with
   * "property area should not exist", which reads like a validator bug rather than a naming
   * mismatch. `toParams()` renames it once, at the boundary, where the mapping is visible.
   *
   * ⚠️ Deliberately a PAIR, not a bare locality slug. Slugs are unique per city, and the tricity
   * has three municipalities that number their sectors — a bare "sector-70" is ambiguous, and
   * resolving it wrong tells a buyer a property is in a different town. Malformed values are
   * dropped rather than half-matched.
   */
  @IsOptional()
  @Transform(({ value }) =>
    (asArray(value) ?? [])
      .map(parseLocalityRef)
      .filter((ref): ref is LocalityRefDto => ref !== null),
  )
  area?: LocalityRefDto[];

  @IsOptional()
  @Transform(({ value }) => asArray(value)?.filter((v) => STATUSES.includes(v as never)))
  @IsArray()
  status?: (typeof STATUSES)[number][];

  @IsOptional()
  @IsIn(["sale", "rent", "lease"])
  transactionType?: "sale" | "rent" | "lease";

  /*
   * Money bounds. `Min(0)` because a negative price is not a filter anyone means, and
   * `Max` keeps a typo from becoming a full-table scan with no useful upper bound —
   * ₹10,000 crore is far beyond any tricity transaction.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100_000_000_000)
  minPrice?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100_000_000_000)
  maxPrice?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  minBeds?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  minBaths?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  minSqft?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  maxSqft?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2100)
  minYearBuilt?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maxMaintenance?: number;

  @IsOptional()
  @Transform(({ value }) => asArray(value)?.filter((v) => PROPERTY_TYPES.includes(v as never)))
  @IsArray()
  propertyTypes?: (typeof PROPERTY_TYPES)[number][];

  @IsOptional()
  @Transform(({ value }) => asArray(value)?.filter((v) => POSSESSION.includes(v as never)))
  @IsArray()
  possession?: (typeof POSSESSION)[number][];

  @IsOptional()
  @Transform(({ value }) => asArray(value)?.filter((v) => FURNISHING.includes(v as never)))
  @IsArray()
  furnishing?: (typeof FURNISHING)[number][];

  /** Capped in count and length — features are matched with jsonb containment, not free text. */
  @IsOptional()
  @Transform(({ value }) => asArray(value)?.slice(0, 20).map((f) => f.slice(0, 60)))
  @IsArray()
  features?: string[];

  /**
   * Map-drawn areas, JSON-encoded.
   *
   * ⚠️ HARD-CAPPED at 10 polygons of 200 points. Each becomes an `ST_Intersects` against the
   * GiST index, and an unbounded list is a trivially cheap request that turns into arbitrarily
   * expensive server work — the classic asymmetric DoS on a spatial endpoint. A real drawn area
   * is well inside these limits.
   */
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = parseJson<PolygonDto[]>(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((poly) => Array.isArray(poly) && poly.length >= 3)
      .slice(0, 10)
      .map((poly) =>
        poly
          .slice(0, 200)
          .filter(
            (pt) =>
              typeof pt?.lat === "number" &&
              typeof pt?.lng === "number" &&
              Number.isFinite(pt.lat) &&
              Number.isFinite(pt.lng),
          ),
      )
      .filter((poly) => poly.length >= 3);
  })
  polygons?: PolygonDto[];

  @IsOptional()
  @Transform(({ value }) => {
    const b = parseJson<BoundsDto>(value);
    if (!b) return undefined;
    const finite = [b.north, b.south, b.east, b.west].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    );
    return finite ? b : undefined;
  })
  bounds?: BoundsDto;

  @IsOptional()
  @IsIn(SORTS)
  sort?: (typeof SORTS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  page?: number;

  /**
   * ⚠️ Max 100. The service clamps too — this is the front line, that is the backstop.
   *
   * A large page is expensive twice over: the query, and then the JSON assembly of ~60 fields per
   * listing. Also `Max(500)` on `page`: deep offsets make Postgres walk every preceding row, so
   * page 40,000 is a slow query anyone can request. Real users never go past page 10.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;

  /** Narrow to the shared contract, so the service never sees the transport shape. */
  toParams(): ListingSearchParamsDto {
    return {
      q: this.q,
      citySlugs: this.citySlugs,
      localities: this.area,
      status: this.status,
      transactionType: this.transactionType,
      minPrice: this.minPrice,
      maxPrice: this.maxPrice,
      minBeds: this.minBeds,
      minBaths: this.minBaths,
      minSqft: this.minSqft,
      maxSqft: this.maxSqft,
      minYearBuilt: this.minYearBuilt,
      maxMaintenance: this.maxMaintenance,
      propertyTypes: this.propertyTypes,
      possession: this.possession,
      furnishing: this.furnishing,
      features: this.features,
      polygons: this.polygons,
      bounds: this.bounds,
      sort: this.sort,
      page: this.page,
      pageSize: this.pageSize,
    };
  }
}
