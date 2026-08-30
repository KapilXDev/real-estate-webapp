import type postgres from "postgres";

/**
 * Bind a plain JS value to a `json`/`jsonb` column.
 *
 * ⚠️ ALWAYS USE THIS. NEVER `${JSON.stringify(value)}::jsonb`.
 *
 * postgres.js JSON-encodes a *string* parameter that is bound to a json/jsonb column. Passing an
 * already-stringified value therefore encodes it TWICE: the column ends up holding a JSON string
 * rather than an object or array, and `jsonb_typeof` returns 'string'.
 *
 * Nothing errors. The write succeeds, and every subsequent read gets a string back where the code
 * expects a structure — at which point a defensive `Array.isArray(...) ? ... : []` turns it into
 * an empty array and the data looks merely absent rather than corrupt. That is exactly how it
 * shipped for `listing.features`, `lead.requirement`, `lead.source` and `listing_media.variants`
 * before anything read them closely enough to notice.
 *
 * The cast exists because postgres.js types `sql.json()` against a recursive `JSONValue` union
 * that includes `Date`, and TypeScript resolves a plain `Record<string, T>` against the `Date`
 * arm and reports 40 missing methods. The values passed here are, by construction, JSON-safe.
 */
export function jsonb(
  sql: postgres.Sql,
  value: unknown,
): ReturnType<postgres.Sql["json"]> {
  return sql.json(value as Parameters<postgres.Sql["json"]>[0]);
}
