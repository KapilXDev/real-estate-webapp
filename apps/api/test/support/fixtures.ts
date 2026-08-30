import type postgres from "postgres";

import { asTenant } from "./database";

/**
 * Row builders for integration tests.
 *
 * ⚠️ EVERY WRITE HERE GOES THROUGH `asTenant`, not through a raw client with RLS bypassed. A
 * fixture that cheats past the policies to insert its rows can set up a world that the
 * application could never have produced, and then "prove" something about it. The setup being
 * subject to the same policies as production is part of what the tests are asserting.
 *
 * `organization`, `city`, `locality` and `property` are deliberately NOT under RLS (see 0010:
 * they describe shared reality, not tenant-owned offers), so those inserts need no context.
 */

let counter = 0;
/** Unique per process — email and slug both carry UNIQUE constraints. */
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}

export interface TestOrg {
  id: string;
  slug: string;
}

export async function createOrg(
  sql: postgres.Sql,
  options: { name?: string; type?: "BROKERAGE" | "PARTNER" | "BUILDER" } = {},
): Promise<TestOrg> {
  const slug = unique("org");
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO organization (name, slug, type, status)
    VALUES (
      ${options.name ?? slug},
      ${slug},
      ${options.type ?? "PARTNER"}::org_type,
      'ACTIVE'
    )
    RETURNING id
  `;
  if (!row) throw new Error("organization insert returned no row");
  return { id: row.id, slug };
}

export async function createUser(
  sql: postgres.Sql,
  orgId: string,
  options: { role?: "OWNER" | "ADMIN" | "AGENT" | "STAFF"; email?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = options.email ?? `${unique("user")}@example.test`;
  return asTenant(sql, { organizationId: orgId }, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO app_user (organization_id, email, password_hash, full_name, role, status)
      VALUES (
        ${orgId}, ${email},
        -- Not a real Argon2 digest. Nothing in these tests verifies a password; putting a
        -- plausible-looking hash here would only invite someone to try.
        ${"not-a-real-hash"},
        ${"Test User"},
        ${options.role ?? "AGENT"}::user_role,
        'ACTIVE'
      )
      RETURNING id
    `;
    if (!row) throw new Error("app_user insert returned no row");
    return { id: row.id, email };
  });
}

/** Any seeded locality — the tests care about tenancy, not about which sector a property is in. */
export async function anyLocalityId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM locality ORDER BY id LIMIT 1`;
  if (!row) throw new Error("No localities found — the template database was not seeded");
  return row.id;
}

export async function createProperty(sql: postgres.Sql, localityId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO property (locality_id, property_type, location, plot_area_sqft)
    VALUES (
      ${localityId},
      'KOTHI'::property_type,
      ST_SetSRID(ST_MakePoint(76.7794, 30.7333), 4326)::geography,
      ${2722.5}
    )
    RETURNING id
  `;
  if (!row) throw new Error("property insert returned no row");
  return row.id;
}

export type ListingStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "UNDER_OFFER"
  | "SOLD"
  | "RENTED"
  | "WITHDRAWN"
  | "REJECTED"
  | "EXPIRED";

export type ListingVisibility = "PUBLIC" | "NETWORK_ONLY" | "PRIVATE";

export async function createListing(
  sql: postgres.Sql,
  options: {
    orgId: string;
    propertyId: string;
    status?: ListingStatus;
    visibility?: ListingVisibility;
    title?: string;
    price?: number;
  },
): Promise<string> {
  const status = options.status ?? "ACTIVE";
  // listing_active_has_published_at forbids an ACTIVE listing with a null published_at, so the
  // fixture has to satisfy the same constraint the application does.
  const publishedAt = status === "ACTIVE" ? new Date() : null;

  return asTenant(sql, { organizationId: options.orgId }, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO listing (
        organization_id, property_id, transaction_type,
        status, visibility, price, title, published_at
      )
      VALUES (
        ${options.orgId}, ${options.propertyId}, 'SALE',
        ${status}::listing_status,
        ${options.visibility ?? "PUBLIC"}::listing_visibility,
        ${options.price ?? 12_500_000},
        ${options.title ?? "Test listing"},
        ${publishedAt}
      )
      RETURNING id
    `;
    if (!row) throw new Error("listing insert returned no row");
    return row.id;
  });
}

export type PartnerTier = "OWN_ONLY" | "PUBLIC_PLUS_OWN" | "NETWORK" | "FULL";
export type PartnerStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";

/**
 * Grant `partnerOrgId` a viewing tier over `hostOrgId`'s inventory.
 *
 * Written as the HOST, because partner_write_policy only lets the host side create the row —
 * asserting that constraint here rather than working around it.
 */
export async function grantPartnership(
  sql: postgres.Sql,
  options: {
    hostOrgId: string;
    partnerOrgId: string;
    tier: PartnerTier;
    status?: PartnerStatus;
  },
): Promise<string> {
  return asTenant(sql, { organizationId: options.hostOrgId }, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO partner_relationship (host_org_id, partner_org_id, tier, status)
      VALUES (
        ${options.hostOrgId}, ${options.partnerOrgId},
        ${options.tier}::partner_tier,
        ${options.status ?? "ACTIVE"}::partner_status
      )
      RETURNING id
    `;
    if (!row) throw new Error("partner_relationship insert returned no row");
    return row.id;
  });
}
