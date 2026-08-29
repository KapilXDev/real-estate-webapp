/**
 * Area units for the Indian property market.
 *
 * Punjab (and therefore Chandigarh / Mohali / Kharar) transacts in **marla** and **kanal**;
 * buyers also commonly say **gaj** (square yards). None of these divide cleanly into square feet,
 * which is why the schema stores BOTH a canonical `area_sqft` and the value/unit as entered.
 * A seller who typed "10 marla" must never be shown "2722.5 sq ft" echoed back at them.
 */

export type AreaUnit =
  | "SQ_FT"
  | "SQ_YD" // gaj
  | "MARLA"
  | "KANAL"
  | "ACRE"
  | "BIGHA"
  | "SQ_M";

/**
 * Conversion factors to square feet.
 *
 * ⚠️ MARLA IS REGIONALLY AMBIGUOUS. The Punjab/Haryana standard is 1 marla = 30.25 sq yd =
 * 272.25 sq ft, and 1 kanal = 20 marla = 5,445 sq ft. Other regions use a 25 sq yd marla
 * (225 sq ft). We use the Punjab standard because that is our market — but every stored row
 * also records the factor used, so a future correction cannot silently rewrite historical data.
 *
 * ⚠️ BIGHA VARIES EVEN MORE — it differs by state and sometimes by district. The Punjab value
 * below is a working default; treat any bigha figure as approximate and prefer capturing the
 * area in sq ft or marla at data entry where possible.
 */
export const SQ_FT_PER_UNIT: Record<AreaUnit, number> = {
  SQ_FT: 1,
  SQ_YD: 9,
  MARLA: 272.25, // Punjab standard: 30.25 sq yd
  KANAL: 5445, // 20 marla
  ACRE: 43560,
  BIGHA: 9070, // Punjab; varies by state — see warning above
  SQ_M: 10.7639,
};

export const AREA_UNIT_LABELS: Record<AreaUnit, { singular: string; plural: string }> = {
  SQ_FT: { singular: "sq ft", plural: "sq ft" },
  SQ_YD: { singular: "gaj", plural: "gaj" },
  MARLA: { singular: "marla", plural: "marla" },
  KANAL: { singular: "kanal", plural: "kanal" },
  ACRE: { singular: "acre", plural: "acres" },
  BIGHA: { singular: "bigha", plural: "bigha" },
  SQ_M: { singular: "sq m", plural: "sq m" },
};

/** Units offered at data entry, ordered by how often they're actually used in the tricity. */
export const COMMON_AREA_UNITS: AreaUnit[] = [
  "SQ_YD",
  "MARLA",
  "SQ_FT",
  "KANAL",
  "ACRE",
  "SQ_M",
  "BIGHA",
];

/**
 * An area as entered by a user, plus its canonical square-foot value.
 *
 * Immutable. Construct via `Area.of()` so the conversion factor is always recorded.
 */
export class Area {
  private constructor(
    /** The value the user actually typed. */
    readonly inputValue: number,
    /** The unit the user chose. */
    readonly inputUnit: AreaUnit,
    /** Canonical square feet — use this for search, sort, and comparison. */
    readonly sqft: number,
    /** The factor used for this conversion, persisted so history stays correct. */
    readonly conversionFactor: number,
  ) {}

  static of(value: number, unit: AreaUnit): Area {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Area value must be a positive number, received: ${value}`);
    }
    const factor = SQ_FT_PER_UNIT[unit];
    if (factor === undefined) {
      throw new RangeError(`Unknown area unit: ${unit}`);
    }
    return new Area(value, unit, round2(value * factor), factor);
  }

  /**
   * Rehydrate from stored columns. Uses the STORED factor rather than the current constant, so
   * rows written under an older conversion continue to render exactly as they were entered.
   */
  static fromStored(
    inputValue: number,
    inputUnit: AreaUnit,
    sqft: number,
    conversionFactor: number,
  ): Area {
    return new Area(inputValue, inputUnit, sqft, conversionFactor);
  }

  /** Convert to another unit. Returns a number, not an Area — the input unit is what was typed. */
  to(unit: AreaUnit): number {
    return round2(this.sqft / SQ_FT_PER_UNIT[unit]);
  }

  /** "10 marla" — how it should appear to the user who entered it. */
  format(): string {
    const label = AREA_UNIT_LABELS[this.inputUnit];
    const noun = this.inputValue === 1 ? label.singular : label.plural;
    return `${trimZeros(this.inputValue)} ${noun}`;
  }

  /** "10 marla (2,722 sq ft)" — for listing pages where both are useful. */
  formatWithSqft(): string {
    if (this.inputUnit === "SQ_FT") return this.format();
    return `${this.format()} (${formatSqft(this.sqft)})`;
  }
}

export function formatSqft(sqft: number): string {
  return `${Math.round(sqft).toLocaleString("en-IN")} sq ft`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 10.00 -> "10", 10.50 -> "10.5" */
const trimZeros = (n: number): string => String(Number(n.toFixed(2)));
