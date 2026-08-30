import postgres from "postgres";

import { CITIES, LOCALITIES, circlePolygon } from "@tricity/geo";

import { loadEnvFile } from "../../config/load-env";

/**
 * Seed runner.
 *
 * Idempotent: safe to run repeatedly. Uses ON CONFLICT on the natural keys (city slug,
 * city+locality slug) so re-running updates rather than duplicating — important because this
 * will be re-run every time the geography data is refined.
 *
 * Deliberately does NOT overwrite editorial content (tagline/intro/lifestyle/faqs) on conflict.
 * Those are hand-written SEO copy; a re-seed must never wipe them.
 */

async function seed(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    console.log("Seeding cities...");
    for (const city of CITIES) {
      await sql`
        INSERT INTO city (name, state, slug, centroid)
        VALUES (
          ${city.name},
          ${city.state},
          ${city.slug},
          ST_SetSRID(ST_MakePoint(${city.lng}, ${city.lat}), 4326)::geography
        )
        ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name,
              state = EXCLUDED.state,
              centroid = EXCLUDED.centroid
      `;
    }
    console.log(`  ${CITIES.length} cities`);

    console.log("Seeding localities...");
    const cityRows = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM city`;
    const cityIdBySlug = new Map(cityRows.map((row) => [row.slug, row.id]));

    let inserted = 0;
    for (const locality of LOCALITIES) {
      const cityId = cityIdBySlug.get(locality.citySlug);
      if (!cityId) {
        throw new Error(
          `Locality "${locality.slug}" references unknown city "${locality.citySlug}"`,
        );
      }

      const boundary = JSON.stringify(
        circlePolygon(locality.lat, locality.lng, locality.radiusM),
      );

      await sql`
        INSERT INTO locality (
          city_id, name, slug, kind, centroid, boundary,
          is_approximate, boundary_source, radius_m
        )
        VALUES (
          ${cityId},
          ${locality.name},
          ${locality.slug},
          ${locality.kind}::locality_kind,
          ST_SetSRID(ST_MakePoint(${locality.lng}, ${locality.lat}), 4326)::geography,
          ST_SetSRID(ST_GeomFromGeoJSON(${boundary}), 4326)::geography,
          true,
          'GENERATED_RADIUS',
          ${locality.radiusM}
        )
        ON CONFLICT (city_id, slug) DO UPDATE
          SET name = EXCLUDED.name,
              kind = EXCLUDED.kind,
              -- Only refresh geometry while it is still a generated approximation. Once a
              -- real OSM/surveyed boundary has been imported, a re-seed must not clobber it.
              centroid = CASE WHEN locality.is_approximate
                              THEN EXCLUDED.centroid ELSE locality.centroid END,
              boundary = CASE WHEN locality.is_approximate
                              THEN EXCLUDED.boundary ELSE locality.boundary END,
              updated_at = now()
      `;
      inserted++;
    }
    console.log(`  ${inserted} localities`);

    const summary = await sql<{ city: string; count: string; approx: string }[]>`
      SELECT c.name AS city,
             count(*)::text AS count,
             count(*) FILTER (WHERE l.is_approximate)::text AS approx
      FROM locality l
      JOIN city c ON c.id = l.city_id
      GROUP BY c.name
      ORDER BY c.name
    `;

    console.log("\nSeeded geography:");
    for (const row of summary) {
      console.log(`  ${row.city.padEnd(18)} ${row.count.padStart(3)} localities (${row.approx} approximate)`);
    }
    console.log(
      "\n⚠️  All boundaries are generated circles. Replace with OSM data before launch —" +
        "\n    see the Overpass query in packages/geo/src/tricity.ts",
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  loadEnvFile();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  seed(connectionString)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("\nSeed failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

export { seed };
