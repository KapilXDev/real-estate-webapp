import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jsonb } from "../src/database/json-param";
import { asTenant, createTestDatabase, type TestDatabase } from "./support/database";
import { anyLocalityId, createListing, createOrg, createProperty, type TestOrg } from "./support/fixtures";

/**
 * ⚠️ REGRESSION GUARD FOR A BUG THAT PRODUCED NO ERROR AT ALL.
 *
 * `${JSON.stringify(value)}::jsonb` looks obviously correct and is obviously wrong: postgres.js
 * JSON-encodes a *string* parameter bound to a json/jsonb column, so a pre-stringified value gets
 * encoded a second time and the column ends up holding a JSON **string** rather than an object or
 * an array.
 *
 * Nothing about that fails loudly. The INSERT succeeds. The read returns a string. And the
 * defensive `Array.isArray(raw) ? ... : []` in the listing mapper — written to survive a
 * hand-edited row — quietly converted it to an empty array, so features simply appeared to be
 * missing rather than corrupt. It shipped that way across `listing.features`, `lead.requirement`,
 * `lead.source` and `listing_media.variants`.
 *
 * These tests assert on `jsonb_typeof`, not on the round-tripped JS value. That distinction is the
 * whole point: a double-encoded column round-trips through `JSON.parse` perfectly well and looks
 * fine from the application side. Only the database can tell you what type it actually stored.
 */

let db: TestDatabase;
let org: TestOrg;

beforeAll(async () => {
  db = await createTestDatabase("jsonb");
  org = await createOrg(db.sql, { name: "Jsonb Test Brokerage" });
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("jsonb() binds real structures, not strings", () => {
  it("stores an array as a jsonb ARRAY", async () => {
    const [row] = await db.sql<{ t: string }[]>`
      SELECT jsonb_typeof(${jsonb(db.sql, ["Corner Plot", "Park Facing"])}) AS t
    `;
    expect(row!.t).toBe("array");
  });

  it("stores an object as a jsonb OBJECT", async () => {
    const [row] = await db.sql<{ t: string }[]>`
      SELECT jsonb_typeof(${jsonb(db.sql, { thumb: { key: "k", width: 400 } })}) AS t
    `;
    expect(row!.t).toBe("object");
  });

  it("demonstrates the bug it replaces — the broken form yields a jsonb STRING", async () => {
    /*
     * Kept as an executable counter-example rather than a comment. It documents precisely what
     * the wrong idiom does, so a future reader tempted to "simplify" back to JSON.stringify can
     * see the result rather than take it on trust.
     */
    const [row] = await db.sql<{ t: string }[]>`
      SELECT jsonb_typeof(${JSON.stringify(["Corner Plot"])}::jsonb) AS t
    `;
    expect(row!.t).toBe("string");
  });
});

describe("the columns that were affected store queryable structures", () => {
  it("listing.features is an array the @> containment filter can match", async () => {
    const localityId = await anyLocalityId(db.sql);
    const propertyId = await createProperty(db.sql, localityId);

    const listingId = await asTenant(db.sql, { organizationId: org.id }, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO listing (
          organization_id, property_id, transaction_type, status, visibility,
          price, features, published_at
        ) VALUES (
          ${org.id}, ${propertyId}, 'SALE', 'ACTIVE', 'PUBLIC',
          ${12_500_000}, ${jsonb(tx, ["Corner Plot", "Park Facing"])}, now()
        )
        RETURNING id
      `;
      return row!.id;
    });

    const [typed] = await asTenant(
      db.sql,
      { organizationId: org.id },
      async (tx) =>
        tx<{ t: string }[]>`SELECT jsonb_typeof(features) AS t FROM listing WHERE id = ${listingId}`,
    );
    expect(typed!.t).toBe("array");

    /*
     * The assertion that actually matters. `@>` against a double-encoded column matches nothing,
     * so the features filter on the public search silently returned an empty page — a filter that
     * appears to work and quietly excludes everything.
     */
    const matched = await asTenant(db.sql, { organizationId: org.id }, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM listing
        WHERE id = ${listingId} AND features @> ${jsonb(tx, ["Corner Plot"])}
      `;
      return rows.length;
    });
    expect(matched).toBe(1);
  });

  it("lead.source is an object whose keys are addressable with ->>", async () => {
    const contactId = await asTenant(db.sql, { organizationId: org.id }, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO contact (full_name) VALUES ('Jsonb Buyer') RETURNING id
      `;
      return row!.id;
    });

    const leadId = await asTenant(db.sql, { organizationId: org.id }, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO lead (organization_id, contact_id, kind, channel, score, source)
        VALUES (
          ${org.id}, ${contactId}, 'CONTACT', 'WEB', ${50},
          ${jsonb(tx, { utmSource: "google", page: "/listings/x" })}
        )
        RETURNING id
      `;
      return row!.id;
    });

    // Attribution is only worth capturing if it can be grouped and counted later, which needs a
    // real object — a JSON string is opaque to ->>.
    const [row] = await asTenant(
      db.sql,
      { organizationId: org.id },
      async (tx) => tx<{ t: string; utm: string | null }[]>`
        SELECT jsonb_typeof(source) AS t, source->>'utmSource' AS utm
        FROM lead WHERE id = ${leadId}
      `,
    );
    expect(row!.t).toBe("object");
    expect(row!.utm).toBe("google");
  });

  it("listing_media.variants is an object, and the READY check depends on it", async () => {
    const localityId = await anyLocalityId(db.sql);
    const propertyId = await createProperty(db.sql, localityId);
    const listingId = await createListing(db.sql, { orgId: org.id, propertyId });

    const variants = { card: { key: "listings/x/y/card.webp", width: 800, height: 600, bytes: 40 } };

    await asTenant(db.sql, { organizationId: org.id }, async (tx) => {
      await tx`
        INSERT INTO listing_media (listing_id, storage_key, kind, sort_order, processing_status, variants)
        VALUES (${listingId}, 'k', 'PHOTO', 0, 'READY', ${jsonb(tx, variants)})
      `;
    });

    const [row] = await asTenant(
      db.sql,
      { organizationId: org.id },
      async (tx) => tx<{ t: string; key: string | null }[]>`
        SELECT jsonb_typeof(variants) AS t, variants->'card'->>'key' AS key
        FROM listing_media WHERE listing_id = ${listingId}
      `,
    );
    expect(row!.t).toBe("object");
    expect(row!.key).toBe("listings/x/y/card.webp");
  });
});
