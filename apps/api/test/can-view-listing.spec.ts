import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asTenant, createTestDatabase, type TestDatabase } from "./support/database";
import {
  createOrg,
  type ListingStatus,
  type ListingVisibility,
  type PartnerTier,
  type TestOrg,
} from "./support/fixtures";

/**
 * `can_view_listing(org, visibility, status)` across the ENTIRE input space.
 *
 * This function is the single most security-critical piece of SQL in the schema: it is the USING
 * clause of the listing SELECT policy, so a wrong branch is not a rendering bug, it is one
 * brokerage reading a competitor's off-market inventory.
 *
 * WHY EXHAUSTIVE RATHER THAN A FEW CASES: the input space is 4 tiers × 3 visibilities × 9
 * statuses = 108 combinations, plus the owner / anonymous / platform-admin paths. That is small
 * enough to enumerate completely, and the failure mode of sampling it is precisely the one that
 * matters — the leak will be in the combination nobody thought to write down.
 *
 * The expectation is computed from an INDEPENDENT restatement of the rule below rather than from
 * the SQL, so this is a genuine second opinion. If the two disagree, one of them is wrong and
 * that is worth a human deciding.
 *
 * ⚠️ The function is called DIRECTLY here rather than through a listing row. That is deliberate:
 * it isolates the policy's decision logic from row plumbing, so a failure names the exact
 * (tier, visibility, status) triple instead of "a query returned the wrong number of rows".
 * `rls.spec.ts` covers the end-to-end path.
 */

const TIERS: PartnerTier[] = ["OWN_ONLY", "PUBLIC_PLUS_OWN", "NETWORK", "FULL"];
const VISIBILITIES: ListingVisibility[] = ["PUBLIC", "NETWORK_ONLY", "PRIVATE"];
const STATUSES: ListingStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "UNDER_OFFER",
  "SOLD",
  "RENTED",
  "WITHDRAWN",
  "REJECTED",
  "EXPIRED",
];

/**
 * The rule, restated from the product requirement rather than transcribed from 0010:
 *
 *  - Anything PUBLIC + ACTIVE is world-readable. That is the catalog.
 *  - FULL means a trusted partner sees everything the host has, at any status or visibility.
 *  - NETWORK adds network-only inventory, but still only when it is ACTIVE — a rival must never
 *    see a draft or a rejected listing.
 *  - PUBLIC_PLUS_OWN grants nothing beyond the public catalog.
 *  - OWN_ONLY likewise: it only describes what the partner may post, not what they may read.
 */
function expectedForPartner(
  tier: PartnerTier,
  visibility: ListingVisibility,
  status: ListingStatus,
): boolean {
  const isPublicCatalog = visibility === "PUBLIC" && status === "ACTIVE";
  if (isPublicCatalog) return true;

  switch (tier) {
    case "FULL":
      return true;
    case "NETWORK":
      return visibility === "NETWORK_ONLY" && status === "ACTIVE";
    case "PUBLIC_PLUS_OWN":
    case "OWN_ONLY":
      return false;
  }
}

let db: TestDatabase;
let hostOrg: TestOrg;
/** One partner org per tier, so a single database covers the whole matrix. */
const partnerByTier = new Map<PartnerTier, TestOrg>();
let strangerOrg: TestOrg;

beforeAll(async () => {
  db = await createTestDatabase("canview");

  hostOrg = await createOrg(db.sql, { name: "Host Brokerage", type: "BROKERAGE" });
  strangerOrg = await createOrg(db.sql, { name: "No Relationship" });

  for (const tier of TIERS) {
    const partner = await createOrg(db.sql, { name: `Partner ${tier}` });
    partnerByTier.set(tier, partner);
    await asTenant(db.sql, { organizationId: hostOrg.id }, async (tx) => {
      await tx`
        INSERT INTO partner_relationship (host_org_id, partner_org_id, tier, status)
        VALUES (${hostOrg.id}, ${partner.id}, ${tier}::partner_tier, 'ACTIVE')
      `;
    });
  }
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

/** Ask the database directly, as `viewerOrgId`, whether it may view a host listing. */
async function canView(
  viewerOrgId: string | null,
  visibility: ListingVisibility,
  status: ListingStatus,
  options: { isPlatformAdmin?: boolean; ownerOrgId?: string } = {},
): Promise<boolean> {
  const ownerOrgId = options.ownerOrgId ?? hostOrg.id;
  return asTenant(
    db.sql,
    { organizationId: viewerOrgId, isPlatformAdmin: options.isPlatformAdmin },
    async (tx) => {
      const [row] = await tx<{ allowed: boolean }[]>`
        SELECT can_view_listing(
          ${ownerOrgId}::uuid,
          ${visibility}::listing_visibility,
          ${status}::listing_status
        ) AS allowed
      `;
      return row!.allowed;
    },
  );
}

describe("can_view_listing — full tier x visibility x status matrix", () => {
  for (const tier of TIERS) {
    describe(`tier ${tier}`, () => {
      for (const visibility of VISIBILITIES) {
        for (const status of STATUSES) {
          const expected = expectedForPartner(tier, visibility, status);
          it(`${visibility} + ${status} -> ${expected ? "visible" : "hidden"}`, async () => {
            const partner = partnerByTier.get(tier)!;
            await expect(canView(partner.id, visibility, status)).resolves.toBe(expected);
          });
        }
      }
    });
  }
});

describe("can_view_listing — principals outside the partner matrix", () => {
  it("an organisation always sees its OWN listings, at every visibility and status", async () => {
    for (const visibility of VISIBILITIES) {
      for (const status of STATUSES) {
        await expect(
          canView(hostOrg.id, visibility, status, { ownerOrgId: hostOrg.id }),
        ).resolves.toBe(true);
      }
    }
  });

  it("an unrelated organisation sees only the public catalog", async () => {
    for (const visibility of VISIBILITIES) {
      for (const status of STATUSES) {
        const expected = visibility === "PUBLIC" && status === "ACTIVE";
        await expect(canView(strangerOrg.id, visibility, status)).resolves.toBe(expected);
      }
    }
  });

  it("an anonymous visitor sees only the public catalog", async () => {
    for (const visibility of VISIBILITIES) {
      for (const status of STATUSES) {
        const expected = visibility === "PUBLIC" && status === "ACTIVE";
        await expect(canView(null, visibility, status)).resolves.toBe(expected);
      }
    }
  });

  it("a platform admin sees everything", async () => {
    for (const visibility of VISIBILITIES) {
      for (const status of STATUSES) {
        await expect(
          canView(strangerOrg.id, visibility, status, { isPlatformAdmin: true }),
        ).resolves.toBe(true);
      }
    }
  });
});

describe("can_view_listing — a partnership only counts while it is ACTIVE", () => {
  /*
   * Revocation has to actually revoke. A suspended or revoked partner keeping FULL read access
   * would make the whole tier system decorative — and this is the branch most likely to be got
   * wrong, because `status = 'ACTIVE'` is one easily-omitted line in the EXISTS clause.
   */
  for (const status of ["PENDING", "SUSPENDED", "REVOKED"] as const) {
    it(`drops a FULL partner back to the public catalog when the relationship is ${status}`, async () => {
      const partner = await createOrg(db.sql, { name: `Full but ${status}` });
      await asTenant(db.sql, { organizationId: hostOrg.id }, async (tx) => {
        await tx`
          INSERT INTO partner_relationship (host_org_id, partner_org_id, tier, status)
          VALUES (${hostOrg.id}, ${partner.id}, 'FULL', ${status}::partner_status)
        `;
      });

      await expect(canView(partner.id, "PRIVATE", "DRAFT")).resolves.toBe(false);
      await expect(canView(partner.id, "NETWORK_ONLY", "ACTIVE")).resolves.toBe(false);
      // ...but the public catalog is still public.
      await expect(canView(partner.id, "PUBLIC", "ACTIVE")).resolves.toBe(true);
    });
  }
});

describe("can_view_listing — hardening", () => {
  it("is SECURITY DEFINER with a pinned search_path", async () => {
    /*
     * An unpinned SECURITY DEFINER function resolves its own identifiers through the CALLER's
     * search_path, so anyone who can create objects in an earlier-resolving schema can shadow
     * `partner_relationship` and answer this question themselves — with owner rights.
     *
     * Not hypothetical on this image: postgis sets a database-level
     * search_path of "$user", public, topology, tiger. Fixed in 0012; pinned here so it stays fixed.
     */
    const [row] = await db.sql<{ prosecdef: boolean; proconfig: string[] | null }[]>`
      SELECT p.prosecdef, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'can_view_listing'
    `;

    expect(row!.prosecdef).toBe(true);
    expect(row!.proconfig ?? []).toContain("search_path=pg_catalog, public");
  });

  it("every SECURITY DEFINER function in public pins its search_path", async () => {
    // Deliberately not a list of known names: a function added later is exactly the one that
    // will be missed, so the assertion is over whatever is actually there.
    const rows = await db.sql<{ proname: string; proconfig: string[] | null }[]>`
      SELECT p.proname, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
    `;

    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(
        (row.proconfig ?? []).some((c) => c.startsWith("search_path=")),
        `SECURITY DEFINER function ${row.proname}() does not pin search_path`,
      ).toBe(true);
    }
  });

  it("is not executable by PUBLIC", async () => {
    const [row] = await db.sql<{ granted: boolean }[]>`
      SELECT has_function_privilege(
        'public',
        'can_view_listing(uuid, listing_visibility, listing_status)',
        'EXECUTE'
      ) AS granted
    `;

    expect(row!.granted).toBe(false);
  });
});
