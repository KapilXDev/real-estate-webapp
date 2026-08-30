import { Injectable } from "@nestjs/common";

import { DatabaseService, type TenantContext } from "../../database/database.service";

export interface ListingWriteInput {
  organizationId: string;
  propertyId: string;
  listedByUserId?: string;
  transactionType: string;
  status: string;
  visibility: string;
  possession: string;
  possessionDate?: string;
  price: number;
  priceOnRequest?: boolean;
  priceNegotiable?: boolean;
  maintenanceMonthly?: number;
  bookingAmount?: number;
  furnishing?: string;
  title?: string;
  description?: string;
  features?: string[];
}

export interface ListingPatch {
  status?: string;
  visibility?: string;
  possession?: string;
  possessionDate?: string | null;
  price?: number;
  priceOnRequest?: boolean;
  maintenanceMonthly?: number | null;
  furnishing?: string | null;
  title?: string | null;
  description?: string | null;
  features?: string[];
  closePrice?: number | null;
}

/**
 * Listing writes, split from `ListingRepository` on purpose.
 *
 * Reads are anonymous, cacheable and by far the highest-traffic path on the platform. Writes are
 * authenticated, tenant-scoped and rare. Keeping them in one class would put the public search
 * projection and the moderation workflow in the same file and make "does this method mutate?" a
 * question you answer by reading the body.
 */
@Injectable()
export class ListingWriteRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * ⚠️ `organization_id` is taken from the AUTHENTICATED PRINCIPAL, never from the request body.
   *
   * The caller cannot name the organisation it is writing for. Even if it tried, the
   * `listing_write_policy` WITH CHECK would reject a mismatched value — but relying on that alone
   * would mean a policy bug becomes an authorisation bug, and the two locks are cheaper than
   * finding out which one was holding.
   */
  async create(input: ListingWriteInput, context: TenantContext): Promise<string> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO listing (
          organization_id, property_id, listed_by_user_id,
          transaction_type, status, visibility, possession, possession_date,
          price, price_on_request, price_negotiable,
          maintenance_monthly, booking_amount, furnishing,
          title, description, features, published_at
        ) VALUES (
          ${input.organizationId},
          ${input.propertyId},
          ${input.listedByUserId ?? null},
          ${input.transactionType}::transaction_type,
          ${input.status}::listing_status,
          ${input.visibility}::listing_visibility,
          ${input.possession}::possession_status,
          ${input.possessionDate ?? null}::date,
          ${input.price},
          ${input.priceOnRequest ?? false},
          ${input.priceNegotiable ?? true},
          ${input.maintenanceMonthly ?? null},
          ${input.bookingAmount ?? null},
          ${input.furnishing ?? null}::furnishing,
          ${input.title ?? null},
          ${input.description ?? null},
          ${JSON.stringify(input.features ?? [])}::jsonb,
          -- listing_active_has_published_at forbids an ACTIVE listing with a null published_at.
          -- Set here rather than by the caller so the constraint can never be tripped by a write
          -- path that forgot about it.
          ${input.status === "ACTIVE" ? new Date() : null}
        )
        RETURNING id
      `;
      if (!rows[0]) throw new Error("listing insert returned no row");
      return rows[0].id;
    });
  }

  /**
   * Partial update.
   *
   * ⚠️ Written as one statement with `coalesce(${value}, column)` rather than a dynamically
   * assembled SET list. The dynamic version needs a "no fields supplied" branch, and forgetting it
   * produces `UPDATE listing SET WHERE id = ...` — a syntax error at best, and at worst a
   * carefully-built string that updates more than intended.
   *
   * The cost is that this cannot distinguish "not supplied" from "explicitly set to null" for
   * nullable columns. Fields where clearing is meaningful (`possession_date`, `close_price`)
   * therefore take an explicit sentinel below rather than relying on coalesce.
   */
  async update(listingId: string, patch: ListingPatch, context: TenantContext): Promise<boolean> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        UPDATE listing SET
          status       = coalesce(${patch.status ?? null}::listing_status, status),
          visibility   = coalesce(${patch.visibility ?? null}::listing_visibility, visibility),
          possession   = coalesce(${patch.possession ?? null}::possession_status, possession),
          possession_date =
            CASE WHEN ${patch.possessionDate !== undefined}
                 THEN ${patch.possessionDate ?? null}::date
                 ELSE possession_date END,
          price        = coalesce(${patch.price ?? null}, price),
          price_on_request = coalesce(${patch.priceOnRequest ?? null}, price_on_request),
          maintenance_monthly =
            CASE WHEN ${patch.maintenanceMonthly !== undefined}
                 THEN ${patch.maintenanceMonthly ?? null}
                 ELSE maintenance_monthly END,
          furnishing   = coalesce(${patch.furnishing ?? null}::furnishing, furnishing),
          title        = coalesce(${patch.title ?? null}, title),
          description  = coalesce(${patch.description ?? null}, description),
          features     = coalesce(${patch.features ? JSON.stringify(patch.features) : null}::jsonb, features),
          close_price  =
            CASE WHEN ${patch.closePrice !== undefined}
                 THEN ${patch.closePrice ?? null}
                 ELSE close_price END,
          -- Closing timestamp is derived, never supplied: a status of SOLD/RENTED without a
          -- closed_at would break every trailing-90-day market statistic silently.
          closed_at =
            CASE WHEN ${patch.status ?? null} IN ('SOLD', 'RENTED') AND closed_at IS NULL
                 THEN now()
                 WHEN ${patch.status ?? null} IS NOT NULL
                      AND ${patch.status ?? null} NOT IN ('SOLD', 'RENTED')
                 THEN NULL
                 ELSE closed_at END,
          published_at =
            CASE WHEN ${patch.status ?? null} = 'ACTIVE' AND published_at IS NULL
                 THEN now()
                 ELSE published_at END,
          updated_at = now()
        WHERE id = ${listingId}
        RETURNING id
      `;
      // Zero rows means the listing belongs to someone else — RLS filtered it. Reported as
      // "not found" by the service rather than "forbidden", so the endpoint does not confirm the
      // existence of a competitor's listing to someone probing for ids.
      return rows.length > 0;
    });
  }

  /**
   * Record a price change.
   *
   * "Reduced by ₹5L last week" is a strong buyer signal and cannot be reconstructed after the
   * fact, so it is captured as it happens rather than derived later from an audit log.
   */
  async recordPriceChange(
    listingId: string,
    price: number,
    userId: string | undefined,
    context: TenantContext,
  ): Promise<void> {
    await this.database.withTenant(context, async (tx) => {
      await tx`
        INSERT INTO listing_price_history (listing_id, price, changed_by_user_id)
        VALUES (${listingId}, ${price}, ${userId ?? null})
      `;
    });
  }

  /** Listing rows an authenticated org may administer, including drafts. */
  async findForOrg(
    context: TenantContext,
    options: { status?: string; limit?: number } = {},
  ): Promise<{ id: string; reference_code: string; status: string; price: string; title: string | null }[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<
        { id: string; reference_code: string; status: string; price: string; title: string | null }[]
      >`
        SELECT id, reference_code, status::text AS status, price, title
        FROM listing
        WHERE (${options.status ?? null}::text IS NULL OR status::text = ${options.status ?? null})
        ORDER BY updated_at DESC
        LIMIT ${options.limit ?? 100}
      `;
    });
  }

  /** Current status and price, for deciding what a patch actually changes. */
  async findState(
    listingId: string,
    context: TenantContext,
  ): Promise<{ status: string; price: string; city_state: string } | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ status: string; price: string; city_state: string }[]>`
        SELECT l.status::text AS status, l.price, c.state AS city_state
        FROM listing l
        JOIN property p   ON p.id = l.property_id
        JOIN locality loc ON loc.id = p.locality_id
        JOIN city c       ON c.id = loc.city_id
        WHERE l.id = ${listingId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
  }
}
