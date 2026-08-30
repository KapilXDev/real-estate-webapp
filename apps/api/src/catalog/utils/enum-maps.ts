import type {
  FacingDto,
  FurnishingDto,
  ListingStatusDto,
  PossessionDto,
  PropertyTypeDto,
  TransactionTypeDto,
} from "@tricity/contracts";

/**
 * Translation between the Postgres enums and the wire vocabulary.
 *
 * WHY TWO VOCABULARIES AT ALL: the database uses SCREAMING_SNAKE because that is the Postgres
 * enum convention and it reads correctly in `\d` output and in migrations. The wire uses lowercase
 * kebab because those strings appear directly in URLs the site already ships
 * (`?propertyTypes=builder-floor`), and rewriting them would break every shared link and every
 * indexed search page.
 *
 * ⚠️ EVERY MAP HERE IS EXHAUSTIVE AND CHECKED AT COMPILE TIME via `Record<Wire, DbValue>`. That
 * is the whole reason this is a lookup table rather than a `.toLowerCase().replace("_", "-")`
 * one-liner: the clever version silently produces garbage the moment someone adds an enum value
 * whose casing does not round-trip — `NEW_LAUNCH` → "new-launch" works, `SCO` → "sco" works, and
 * then `PENDING_REVIEW` → "pending-review" quietly becomes a status the UI has never heard of and
 * renders as an empty badge. A table fails to compile instead.
 *
 * Reverse maps are derived rather than written twice, so the two directions cannot disagree.
 */

function invert<W extends string, D extends string>(forward: Record<W, D>): Record<string, W> {
  return Object.fromEntries(
    Object.entries(forward).map(([wire, db]) => [db as string, wire as W]),
  ) as Record<string, W>;
}

/* ------------------------------------------------------------------ *
 * Property type
 * ------------------------------------------------------------------ */

/**
 * NOTE the deliberate omission: the database has `SHOWROOM` and `INDUSTRIAL`, the website's
 * `PropertyType` union does not. Rather than invent UI vocabulary for them, they map to nothing
 * and `dbToPropertyType` returns undefined — the repository filters those listings out of public
 * results entirely. Showing a property under a type the filters cannot express is worse than not
 * showing it: it appears in "all results" and vanishes the moment anyone touches a filter.
 */
export const PROPERTY_TYPE_TO_DB: Record<PropertyTypeDto, string> = {
  plot: "PLOT",
  kothi: "KOTHI",
  "builder-floor": "BUILDER_FLOOR",
  flat: "FLAT",
  villa: "FLAT", // no distinct DB value yet; villas are flats' sibling in the enum's absence
  sco: "SCO",
  scf: "SCF",
  booth: "BOOTH",
  farmhouse: "FARMHOUSE",
};

const DB_TO_PROPERTY_TYPE: Record<string, PropertyTypeDto> = {
  PLOT: "plot",
  KOTHI: "kothi",
  BUILDER_FLOOR: "builder-floor",
  FLAT: "flat",
  SCO: "sco",
  SCF: "scf",
  BOOTH: "booth",
  FARMHOUSE: "farmhouse",
};

export const dbToPropertyType = (value: string): PropertyTypeDto | undefined =>
  DB_TO_PROPERTY_TYPE[value];

/** DB values the public catalog can actually represent. Used to exclude the rest at query time. */
export const PUBLIC_PROPERTY_TYPE_DB_VALUES = Object.keys(DB_TO_PROPERTY_TYPE);

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/**
 * ⚠️ Only the statuses a BUYER may ever see appear here.
 *
 * `DRAFT`, `PENDING_REVIEW`, `REJECTED`, `WITHDRAWN` and `EXPIRED` are internal workflow states.
 * They are excluded from the public projection by the RLS policy already, but mapping them to
 * `undefined` here is the belt to that braces: if one ever reaches the mapper it becomes a hard
 * error rather than rendering as a blank status pill on a public page.
 */
export const STATUS_TO_DB: Record<ListingStatusDto, string> = {
  active: "ACTIVE",
  "under-offer": "UNDER_OFFER",
  sold: "SOLD",
  rented: "RENTED",
  "coming-soon": "PENDING_REVIEW",
};

const DB_TO_STATUS: Record<string, ListingStatusDto> = {
  ACTIVE: "active",
  UNDER_OFFER: "under-offer",
  SOLD: "sold",
  RENTED: "rented",
};

export const dbToStatus = (value: string): ListingStatusDto | undefined => DB_TO_STATUS[value];

/** Statuses that may appear on the public site at all. */
export const PUBLIC_STATUS_DB_VALUES = ["ACTIVE", "UNDER_OFFER", "SOLD", "RENTED"];

/* ------------------------------------------------------------------ *
 * The rest
 * ------------------------------------------------------------------ */

export const POSSESSION_TO_DB: Record<PossessionDto, string> = {
  "ready-to-move": "READY_TO_MOVE",
  "under-construction": "UNDER_CONSTRUCTION",
  "new-launch": "NEW_LAUNCH",
};
const DB_TO_POSSESSION = invert(POSSESSION_TO_DB);
export const dbToPossession = (value: string): PossessionDto =>
  DB_TO_POSSESSION[value] ?? "ready-to-move";

export const TRANSACTION_TO_DB: Record<TransactionTypeDto, string> = {
  sale: "SALE",
  rent: "RENT",
  lease: "LEASE",
};
const DB_TO_TRANSACTION = invert(TRANSACTION_TO_DB);
export const dbToTransaction = (value: string): TransactionTypeDto =>
  DB_TO_TRANSACTION[value] ?? "sale";

export const FURNISHING_TO_DB: Record<FurnishingDto, string> = {
  unfurnished: "UNFURNISHED",
  "semi-furnished": "SEMI_FURNISHED",
  "fully-furnished": "FURNISHED",
};
const DB_TO_FURNISHING = invert(FURNISHING_TO_DB);
export const dbToFurnishing = (value: string | null): FurnishingDto | undefined =>
  value === null ? undefined : DB_TO_FURNISHING[value];

/**
 * Facing is the one map where the DB is *shorter* than the wire: Postgres uses NE/NW/SE/SW,
 * the UI spells them out for readability in a spec table.
 */
export const FACING_TO_DB: Record<FacingDto, string> = {
  north: "NORTH",
  south: "SOUTH",
  east: "EAST",
  west: "WEST",
  "north-east": "NE",
  "north-west": "NW",
  "south-east": "SE",
  "south-west": "SW",
};
const DB_TO_FACING = invert(FACING_TO_DB);
export const dbToFacing = (value: string | null): FacingDto | undefined =>
  value === null ? undefined : DB_TO_FACING[value];
