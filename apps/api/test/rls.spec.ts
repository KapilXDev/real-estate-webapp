import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ANONYMOUS, asTenant, createTestDatabase, type TestDatabase } from "./support/database";
import {
  anyLocalityId,
  createListing,
  createOrg,
  createProperty,
  createUser,
  grantPartnership,
  type TestOrg,
} from "./support/fixtures";

/**
 * THE MOST IMPORTANT TEST IN THE REPO.
 *
 * Partner brokers are competing businesses sharing one database. The entire commercial premise of
 * the platform depends on org A being unable to read org B's inventory, and that guarantee rests
 * on row-level security rather than on every future `WHERE organization_id = ...` being
 * remembered.
 *
 * ⚠️ THIS ALREADY SHIPPED BROKEN ONCE. Migration 0010 originally used `ENABLE ROW LEVEL SECURITY`
 * alone. Postgres exempts a table's OWNER from its own policies, and the API connects as the role
 * that ran the migrations — so every policy in that file was a silent no-op. No error, no
 * warning, and every partner able to read every rival's listings. It was caught by reading the
 * SQL, which is not a control that scales.
 *
 * ⚠️ SO: THESE TESTS MUST CONNECT AS THE TABLE OWNER. That is what makes them able to detect a
 * missing FORCE. Running them as a lesser role would make them pass against the broken schema,
 * which is worse than not having them — see the `pg_class` assertion at the bottom, which pins
 * the mechanism itself rather than only its effect.
 */

let db: TestDatabase;
let hostOrg: TestOrg;
let rivalOrg: TestOrg;
let hostListing: string;
let rivalListing: string;

beforeAll(async () => {
  db = await createTestDatabase("rls");

  hostOrg = await createOrg(db.sql, { name: "Host Brokerage", type: "BROKERAGE" });
  rivalOrg = await createOrg(db.sql, { name: "Rival Brokerage", type: "PARTNER" });

  const localityId = await anyLocalityId(db.sql);
  const hostProperty = await createProperty(db.sql, localityId);
  const rivalProperty = await createProperty(db.sql, localityId);

  // PRIVATE + DRAFT: not visible to anyone but the owning org under any tier. If these leak,
  // everything leaks.
  hostListing = await createListing(db.sql, {
    orgId: hostOrg.id,
    propertyId: hostProperty,
    status: "DRAFT",
    visibility: "PRIVATE",
    title: "Host private draft",
  });
  rivalListing = await createListing(db.sql, {
    orgId: rivalOrg.id,
    propertyId: rivalProperty,
    status: "DRAFT",
    visibility: "PRIVATE",
    title: "Rival private draft",
  });
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

async function visibleListingIds(orgId: string | null): Promise<string[]> {
  return asTenant(db.sql, { organizationId: orgId }, async (tx) => {
    const rows = await tx<{ id: string }[]>`SELECT id FROM listing ORDER BY id`;
    return rows.map((r) => r.id);
  });
}

describe("FORCE ROW LEVEL SECURITY", () => {
  it("⚠️ runs as a role that CANNOT bypass RLS — without this every test below is vacuous", async () => {
    /*
     * THE PRECONDITION FOR THIS ENTIRE FILE, asserted first so a misconfiguration reports itself
     * as one failure with a clear name rather than as a suite that passes and proves nothing.
     *
     * A superuser, or any role with BYPASSRLS, skips row-level security before policies are ever
     * consulted. FORCE does not apply to it. Connected as such a role, every assertion below
     * about isolation would still pass on a schema with no isolation whatsoever — which is what
     * the first run of this file discovered, because the postgres Docker image makes
     * POSTGRES_USER a superuser and the API was reusing that connection.
     */
    const [row] = await db.sql<{ name: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT r.rolname AS name, r.rolsuper, r.rolbypassrls
      FROM pg_roles r
      WHERE r.oid = current_user::regrole::oid
    `;

    expect(row!.rolsuper, `connected as superuser "${row!.name}" — RLS is not enforced`).toBe(
      false,
    );
    expect(row!.rolbypassrls, `role "${row!.name}" has BYPASSRLS — RLS is not enforced`).toBe(
      false,
    );
  });

  it("is enabled AND forced on every tenant-scoped table", async () => {
    /*
     * relrowsecurity  = ENABLE ROW LEVEL SECURITY
     * relforcerowsecurity = FORCE ROW LEVEL SECURITY
     *
     * Asserted directly on the catalog, not merely inferred from behaviour: a future migration
     * that adds a policy to a new table and forgets FORCE would produce a table whose policies
     * do nothing, and no behavioural test written today would notice.
     */
    const rows = await db.sql<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('listing', 'lead', 'app_user', 'partner_relationship')
      ORDER BY relname
    `;

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} is missing ENABLE ROW LEVEL SECURITY`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} is missing FORCE ROW LEVEL SECURITY`).toBe(
        true,
      );
    }
  });

  it("hides a rival's private listing from another organisation", async () => {
    const visible = await visibleListingIds(rivalOrg.id);

    expect(visible).toContain(rivalListing);
    expect(visible).not.toContain(hostListing);
  });

  it("is symmetric — the host cannot read the rival's inventory either", async () => {
    const visible = await visibleListingIds(hostOrg.id);

    expect(visible).toContain(hostListing);
    expect(visible).not.toContain(rivalListing);
  });

  it("shows an anonymous visitor no non-public listing at all", async () => {
    const visible = await visibleListingIds(null);

    expect(visible).toEqual([]);
  });

  it("counts, not just row lists, are filtered — no leak through an aggregate", async () => {
    // A policy that filtered SELECT but let COUNT(*) through would leak inventory volume, which
    // is itself commercially sensitive. RLS applies to the scan, so this should hold — assert it.
    const [row] = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) => tx<{ count: string }[]>`SELECT count(*) AS count FROM listing`,
    );

    expect(Number(row!.count)).toBe(1);
  });

  it("blocks a cross-tenant UPDATE rather than silently matching zero rows in a way that looks fine", async () => {
    const affected = await asTenant(db.sql, { organizationId: rivalOrg.id }, async (tx) => {
      const rows = await tx`
        UPDATE listing SET title = 'defaced' WHERE id = ${hostListing} RETURNING id
      `;
      return rows.length;
    });

    expect(affected).toBe(0);

    // And the row is genuinely untouched, read back as its owner.
    const [row] = await asTenant(
      db.sql,
      { organizationId: hostOrg.id },
      async (tx) => tx<{ title: string }[]>`SELECT title FROM listing WHERE id = ${hostListing}`,
    );
    expect(row!.title).toBe("Host private draft");
  });

  it("refuses an INSERT that claims another organisation's id", async () => {
    const localityId = await anyLocalityId(db.sql);
    const propertyId = await createProperty(db.sql, localityId);

    // WITH CHECK on listing_write_policy should reject this outright.
    await expect(
      asTenant(
        db.sql,
        { organizationId: rivalOrg.id },
        async (tx) => tx`
          INSERT INTO listing (organization_id, property_id, transaction_type, price)
          VALUES (${hostOrg.id}, ${propertyId}, 'SALE', ${9_900_000})
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("keeps app_user scoped to its own organisation", async () => {
    await createUser(db.sql, hostOrg.id, { role: "OWNER" });
    await createUser(db.sql, rivalOrg.id, { role: "AGENT" });

    const rivalView = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) => tx<{ organization_id: string }[]>`SELECT organization_id FROM app_user`,
    );

    expect(rivalView.length).toBeGreaterThan(0);
    for (const row of rivalView) {
      expect(row.organization_id).toBe(rivalOrg.id);
    }
  });

  it("lets a platform admin see across organisations", async () => {
    // The host brokerage moderates partner inventory, so this path must work — it is the reason
    // is_platform_admin exists, and the reason it must never be set for an unauthenticated caller.
    const visible = await asTenant(
      db.sql,
      { organizationId: hostOrg.id, isPlatformAdmin: true },
      async (tx) => {
        const rows = await tx<{ id: string }[]>`SELECT id FROM listing`;
        return rows.map((r) => r.id);
      },
    );

    expect(visible).toContain(hostListing);
    expect(visible).toContain(rivalListing);
  });

  it("treats an unset tenant context as anonymous, not as unrestricted", async () => {
    /*
     * `current_org_id()` returns NULL rather than erroring when the setting is absent, which is
     * deliberate (migrations and background jobs need it). The risk is that a query which forgot
     * `withTenant()` would then run with no restriction at all. It must degrade to *fewer* rows,
     * never more.
     */
    const rows = await db.sql<{ id: string }[]>`SELECT id FROM listing`;

    expect(rows).toEqual([]);
  });
});

describe("partner_relationship visibility", () => {
  it("is readable by both sides but writable only by the host", async () => {
    const relationshipId = await grantPartnership(db.sql, {
      hostOrgId: hostOrg.id,
      partnerOrgId: rivalOrg.id,
      tier: "PUBLIC_PLUS_OWN",
    });

    const partnerCanRead = await asTenant(
      db.sql,
      { organizationId: rivalOrg.id },
      async (tx) =>
        tx<{ id: string }[]>`SELECT id FROM partner_relationship WHERE id = ${relationshipId}`,
    );
    expect(partnerCanRead).toHaveLength(1);

    // The partner must not be able to promote its own tier — that would be self-service access
    // to a rival's full inventory.
    const escalated = await asTenant(db.sql, { organizationId: rivalOrg.id }, async (tx) => {
      const rows = await tx`
        UPDATE partner_relationship SET tier = 'FULL' WHERE id = ${relationshipId} RETURNING id
      `;
      return rows.length;
    });
    expect(escalated).toBe(0);

    const [row] = await asTenant(
      db.sql,
      { organizationId: hostOrg.id },
      async (tx) =>
        tx<{ tier: string }[]>`SELECT tier FROM partner_relationship WHERE id = ${relationshipId}`,
    );
    expect(row!.tier).toBe("PUBLIC_PLUS_OWN");
  });

  it("is invisible to an unrelated third organisation", async () => {
    const outsider = await createOrg(db.sql, { name: "Unrelated Brokerage" });

    const visible = await asTenant(
      db.sql,
      { organizationId: outsider.id },
      async (tx) => tx<{ id: string }[]>`SELECT id FROM partner_relationship`,
    );

    expect(visible).toEqual([]);
  });
});

describe("shared reference data is deliberately NOT tenant-scoped", () => {
  it("lets an anonymous visitor read the geography", async () => {
    // locality/city describe physical reality. Putting them behind RLS would break public search
    // and duplicate detection; assert the intent so nobody "tightens" it later by mistake.
    const [row] = await asTenant(
      db.sql,
      ANONYMOUS,
      async (tx) => tx<{ count: string }[]>`SELECT count(*) AS count FROM locality`,
    );

    expect(Number(row!.count)).toBe(102);
  });
});
