import type postgres from "postgres";

/**
 * Composable SQL predicate helpers.
 *
 * WHY A HELPER LAYER RATHER THAN STRING CONCATENATION: the search endpoint has ~18 optional
 * filters. The obvious implementation builds a WHERE clause by appending strings, and that is the
 * single most reliable way to introduce SQL injection into an otherwise-parameterised codebase —
 * one `${value}` that should have been a bind parameter, in a public unauthenticated endpoint.
 *
 * Everything here returns a postgres.js **fragment**, so values remain bind parameters all the way
 * down. Nothing in this file ever puts a caller-supplied value into SQL text.
 */

export type Fragment = postgres.PendingQuery<postgres.Row[]>;

/**
 * AND a list of optional predicates together.
 *
 * ⚠️ The empty case returns `true`, not an empty string. A missing WHERE clause and a WHERE that
 * matches everything look identical in a search endpoint — both return all rows — but they differ
 * catastrophically for UPDATE and DELETE. Making the identity element explicit means this helper
 * is safe to reuse anywhere.
 */
export function and(sql: postgres.Sql, fragments: (Fragment | undefined)[]): Fragment {
  const present = fragments.filter((f): f is Fragment => f !== undefined);
  if (present.length === 0) return sql`true`;
  return present.reduce((acc, next) => sql`${acc} AND ${next}`);
}

/** OR a list together. Identity is `false` — an empty OR must match nothing, not everything. */
export function or(sql: postgres.Sql, fragments: (Fragment | undefined)[]): Fragment {
  const present = fragments.filter((f): f is Fragment => f !== undefined);
  if (present.length === 0) return sql`false`;
  return present.reduce((acc, next) => sql`(${acc} OR ${next})`);
}

/**
 * Turn a polygon of lat/lng points into a PostGIS geography.
 *
 * ⚠️ TWO THINGS THAT SILENTLY PRODUCE ZERO RESULTS INSTEAD OF AN ERROR:
 *
 *  1. **Coordinate order.** GeoJSON is [lng, lat]. Every UI, every map library and every human
 *     says "lat, lng". Swapping them puts Chandigarh (30.73N, 76.77E) at 76.73N 30.77E, which is
 *     in the Barents Sea — a perfectly valid point that simply contains nothing.
 *  2. **Ring closure.** A GeoJSON polygon's first and last positions must be identical. A
 *     map-draw UI does not emit the closing point, and an unclosed ring makes ST_GeomFromGeoJSON
 *     throw. Closed here rather than trusting the client.
 */
export function polygonGeography(sql: postgres.Sql, points: { lat: number; lng: number }[]) {
  const ring = points.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0]!, first[1]!]);
  }

  const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
  return sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography`;
}

/**
 * A viewport rectangle.
 *
 * ST_MakeEnvelope takes (xmin, ymin, xmax, ymax) — that is (west, south, east, north). Passing
 * them in the north/south/east/west order the UI uses produces an inverted box that matches
 * nothing, again with no error.
 */
export function boundsGeography(
  sql: postgres.Sql,
  bounds: { north: number; south: number; east: number; west: number },
) {
  return sql`ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)::geography`;
}

/**
 * The ORDER BY clause, chosen from a fixed table.
 *
 * ⚠️ A sort column CANNOT be a bind parameter — `ORDER BY $1` sorts every row by the same
 * constant, which Postgres accepts and which returns rows in an arbitrary order that looks
 * plausible in testing. So it has to be SQL text, which means it must never come from user input.
 * A lookup keyed on a closed union is the whole defence.
 *
 * Every ordering ends with `l.id` as a tiebreak. Without it, two listings at the same price can
 * swap places between page 1 and page 2 of the same search — one row shown twice, another never
 * shown at all. Postgres gives no stability guarantee for equal keys, and the bug only appears
 * once there is enough inventory to paginate.
 */
export function orderBy(sql: postgres.Sql, sort: string | undefined): Fragment {
  switch (sort) {
    case "price-asc":
      return sql`ORDER BY l.price ASC, l.id ASC`;
    case "price-desc":
      return sql`ORDER BY l.price DESC, l.id ASC`;
    case "beds-desc":
      return sql`ORDER BY p.bedrooms DESC NULLS LAST, l.id ASC`;
    case "area-desc":
      // Mirrors the site's own precedence: carpet is the RERA basis and the most honest figure,
      // built-up is the common fallback, plot area covers bare land with no interior.
      return sql`ORDER BY coalesce(p.carpet_area_sqft, p.built_up_area_sqft, p.plot_area_sqft) DESC NULLS LAST, l.id ASC`;
    case "newest":
    default:
      return sql`ORDER BY coalesce(l.published_at, l.created_at) DESC, l.id ASC`;
  }
}
