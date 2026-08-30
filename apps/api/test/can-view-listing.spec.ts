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
 * Is this listing in the public catalog?
 *
 * Restated from the product requirement rather than transcribed from the SQL — that is what makes
 * this a genuine second opinion rather than a paraphrase of the implementation.
 *
 *  - PUBLIC + ACTIVE is world-readable. That is the catalog.
 *  - PUBLIC + UNDER_OFFER is too: buyers benefit from seeing it, it carries no settlement figure,
 *    and hiding it makes inventory silently vanish mid-negotiation.
 *  - PUBLIC + SOLD/RENTED is world-readable ONLY for the host organisation — its own track record
 *    is deliberate marketing. A partner's closed listings carry `close_price`, and publishing what
 *    a rival settled at, to that rival, is worse than the problem it solves. See 0017.
 */
function isPublicCatalog(
  visibility: ListingVisibility,
  status: ListingStatus,
  ownerIsHost: boolean,
): boolean {
  if (visibility !== "PUBLIC") return false;
  if (status === "ACTIVE" || status === "UNDER_OFFER") return true;
  return ownerIsHost && (status === "SOLD" || status === "RENTED");
}

/**
 * The tier rules, likewise restated:
 *
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
  // hostOrg in this suite is NOT flagged is_host — that case gets its own describe below.
  if (isPublicCatalog(visibility, status, false)) return true;

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
        const expected = isPublicCatalog(visibility, status, false);
        await expect(canView(strangerOrg.id, visibility, status)).resolves.toBe(expected);
      }
    }
  });

  it("an anonymous visitor sees only the public catalog", async () => {
    for (const visibility of VISIBILITIES) {
      for (const status of STATUSES) {
        const expected = isPublicCatalog(visibility, status, false);
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

describe("can_view_listing — sold history is public for the HOST only", () => {
  /*
   * ⚠️ THE ASYMMETRY IS THE POINT, and it is worth a dedicated suite because it is the one rule
   * here that is not "the same for everyone".
   *
   * The host's closed deals are its own advertised track record — the strongest credibility
   * signal on an agent site. Every other organisation's closed deals carry a `close_price` that
   * is nobody else's business, least of all a competitor's. If this ever collapses into "all
   * SOLD listings are public", partner settlement prices leak to their rivals.
   */
  let hostOwned: TestOrg;

  beforeAll(async () => {
    hostOwned = await createOrg(db.sql, { name: "The Host Brokerage", type: "BROKERAGE" });
    await db.sql`UPDATE organization SET is_host = true WHERE id = ${hostOwned.id}`;
  });

  for (const status of ["SOLD", "RENTED"] as const) {
    it(`shows a host's PUBLIC ${status} listing to an anonymous visitor`, async () => {
      await expect(
        canView(null, "PUBLIC", status, { ownerOrgId: hostOwned.id }),
      ).resolves.toBe(true);
    });

    it(`HIDES a non-host's PUBLIC ${status} listing from an anonymous visitor`, async () => {
      await expect(canView(null, "PUBLIC", status, { ownerOrgId: hostOrg.id })).resolves.toBe(
        false,
      );
    });
  }

  it("does not widen anything beyond PUBLIC visibility, even for the host", async () => {
    for (const visibility of ["NETWORK_ONLY", "PRIVATE"] as const) {
      for (const status of ["SOLD", "RENTED", "DRAFT", "WITHDRAWN"] as const) {
        await expect(
          canView(null, visibility, status, { ownerOrgId: hostOwned.id }),
        ).resolves.toBe(false);
      }
    }
  });

  it("still hides the host's withdrawn and rejected listings", async () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "WITHDRAWN", "REJECTED", "EXPIRED"] as const) {
      await expect(
        canView(null, "PUBLIC", status, { ownerOrgId: hostOwned.id }),
      ).resolves.toBe(false);
    }
  });
});
