import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ANONYMOUS, asTenant, createTestDatabase, type TestDatabase } from "./support/database";
import {
  anyLocalityId,
  createListing,
  createOrg,
  createProperty,
  type TestOrg,
} from "./support/fixtures";

/**
 * RLS on the CHILD tables — `lead_activity`, `listing_price_history`, `listing_media`.
 *
 * ⚠️ WHY THESE NEED THEIR OWN TESTS RATHER THAN BEING COVERED BY `rls.spec.ts`.
 *
 * Each of these has a foreign key to a table that is already protected, which makes them *look*
 * protected. They are not: a foreign key constrains what may be INSERTED, not who may SELECT.
 * `SELECT * FROM lead_activity` with no join reads every organisation's follow-up notes — and
 * that is not a contrived query, it is what any "recent activity" screen does.
 *
 * All three shipped without policies (media fixed in 0018, the other two in 0019) and none of it
 * was noticed, because nothing had written a row yet. These tests exist so the next child table
 * added does not repeat it.
 */

let db: TestDatabase;
let ownerOrg: TestOrg;
let rivalOrg: TestOrg;
let ownerListing: string;
let ownerLead: string;

beforeAll(async () => {
  db = await createTestDatabase("childrls");

  ownerOrg = await createOrg(db.sql, { name: "Owner Brokerage" });
  rivalOrg = await createOrg(db.sql, { name: "Rival Brokerage" });

  const localityId = await anyLocalityId(db.sql);
  const propertyId = await createProperty(db.sql, localityId);

  // PRIVATE + DRAFT: nothing about this listing is public, including its history and photos.
  ownerListing = await createListing(db.sql, {
    orgId: ownerOrg.id,
    propertyId,
    status: "DRAFT",
    visibility: "PRIVATE",
    title: "Owner private draft",
  });

  ownerLead = await asTenant(db.sql, { organizationId: ownerOrg.id }, async (tx) => {
    const [contact] = await tx<{ id: string }[]>`
      INSERT INTO contact (full_name) VALUES ('Child RLS Buyer') RETURNING id
    `;
    const [lead] = await tx<{ id: string }[]>`
      INSERT INTO lead (organization_id, contact_id, kind, channel, score)
      VALUES (${ownerOrg.id}, ${contact!.id}, 'TOUR_REQUEST', 'WEB', ${80})
      RETURNING id
    `;
    return lead!.id;
  });

  await asTenant(db.sql, { organizationId: ownerOrg.id }, async (tx) => {
    await tx`
      INSERT INTO lead_activity (lead_id, type, body)
      VALUES (${ownerLead}, 'NOTE', 'Budget is really 1.8 Cr, will stretch')
    `;
    await tx`
      INSERT INTO listing_price_history (listing_id, price)
      VALUES (${ownerListing}, ${18_000_000})
    `;
    await tx`
      INSERT INTO listing_media (listing_id, storage_key, kind, sort_order, processing_status, variants)
      VALUES (${ownerListing}, 'k', 'PHOTO', 0, 'READY', ${tx.json({ card: { key: "x", width: 800, height: 600, bytes: 1 } })})
    `;
  });
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("lead_activity — a rival cannot read your follow-up notes", () => {
  it("is enabled AND forced", async () => {
    const [row] = await db.sql<{ e: boolean; f: boolean }[]>`
      SELECT relrowsecurity AS e, relforcerowsecurity AS f
      FROM pg_class WHERE relname = 'lead_activity'
    `;
    expect(row!.e).toBe(true);
    expect(row!.f).toBe(true);
  });

  it("hides another organisation's activity from an unjoined SELECT", async () => {
    /*
     * The exact query the FK does nothing about. Follow-up notes are a sales pipeline in prose —
     * "budget is really 1.8 Cr" is precisely what a competitor would want.
     */
    const rows = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) => tx<{ id: string }[]>`SELECT id FROM lead_activity`,
    );
    expect(rows).toEqual([]);
  });

  it("shows it to the owning organisation", async () => {
    const rows = await asTenant(
      db.sql,
      { organizationId: ownerOrg.id },
      async (tx) => tx<{ body: string }[]>`SELECT body FROM lead_activity`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain("1.8 Cr");
  });

  it("refuses a write attached to another organisation's lead", async () => {
    await expect(
      asTenant(
        db.sql,
        { organizationId: rivalOrg.id },
        async (tx) => tx`
          INSERT INTO lead_activity (lead_id, type, body)
          VALUES (${ownerLead}, 'NOTE', 'injected')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("listing_price_history — draft repricing is not public", () => {
  it("is enabled AND forced", async () => {
    const [row] = await db.sql<{ e: boolean; f: boolean }[]>`
      SELECT relrowsecurity AS e, relforcerowsecurity AS f
      FROM pg_class WHERE relname = 'listing_price_history'
    `;
    expect(row!.e).toBe(true);
    expect(row!.f).toBe(true);
  });

  it("hides the history of a PRIVATE DRAFT from a rival", async () => {
    // Watching a competitor reprice unpublished inventory is exactly the commercial intelligence
    // the tenancy model exists to prevent.
    const rows = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) => tx<{ id: string }[]>`SELECT id FROM listing_price_history`,
    );
    expect(rows).toEqual([]);
  });

  it("hides it from an anonymous visitor too", async () => {
    const rows = await asTenant(
      db.sql,
      ANONYMOUS,
      async (tx) => tx<{ id: string }[]>`SELECT id FROM listing_price_history`,
    );
    expect(rows).toEqual([]);
  });

  it("but EXPOSES the history of a public active listing anonymously", async () => {
    /*
     * ⚠️ The half that a naive "owner only" policy would break. "Reduced by ₹5L last week" is a
     * real buyer signal and belongs on a public listing page, so the read delegates to
     * `can_view_listing` rather than to ownership. Getting this wrong makes the feature
     * unimplementable rather than merely restrictive.
     */
    const localityId = await anyLocalityId(db.sql);
    const propertyId = await createProperty(db.sql, localityId);
    const publicListing = await createListing(db.sql, {
      orgId: ownerOrg.id,
      propertyId,
      status: "ACTIVE",
      visibility: "PUBLIC",
    });

    await asTenant(db.sql, { organizationId: ownerOrg.id }, async (tx) => {
      await tx`
        INSERT INTO listing_price_history (listing_id, price)
        VALUES (${publicListing}, ${9_500_000})
      `;
    });

    const rows = await asTenant(
      db.sql,
      ANONYMOUS,
      async (tx) =>
        tx<{ price: string }[]>`
          SELECT price FROM listing_price_history WHERE listing_id = ${publicListing}
        `,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("listing_media — storage keys are as confidential as the listing", () => {
  it("is enabled AND forced", async () => {
    const [row] = await db.sql<{ e: boolean; f: boolean }[]>`
      SELECT relrowsecurity AS e, relforcerowsecurity AS f
      FROM pg_class WHERE relname = 'listing_media'
    `;
    expect(row!.e).toBe(true);
    expect(row!.f).toBe(true);
  });

  it("hides a private listing's photo rows — a storage key is the file's address", async () => {
    const rows = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) => tx<{ storage_key: string }[]>`SELECT storage_key FROM listing_media`,
    );
    expect(rows).toEqual([]);
  });

  it("refuses a write attached to another organisation's listing", async () => {
    await expect(
      asTenant(
        db.sql,
        { organizationId: rivalOrg.id },
        async (tx) => tx`
          INSERT INTO listing_media (listing_id, storage_key, kind, sort_order, processing_status)
          VALUES (${ownerListing}, 'stolen', 'PHOTO', 99, 'PENDING')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("every table with a tenant-owned parent is under RLS", () => {
  it("has no unprotected child tables left that carry tenant data", async () => {
    /*
     * ⚠️ Written over the catalog rather than as a hardcoded list, so a child table added later
     * is covered by this test the day it appears rather than the day someone remembers.
     *
     * `saved_search` is the deliberate exception: it is keyed on contact_id, so it is
     * consumer-owned rather than org-owned and needs a contact-session policy that does not exist
     * yet. Named explicitly so the exemption is a decision rather than an oversight.
     */
    const rows = await db.sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN (
          'listing', 'lead', 'app_user', 'partner_relationship',
          'listing_media', 'lead_activity', 'listing_price_history', 'organization_rera'
        )
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `;

    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
