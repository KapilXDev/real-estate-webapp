import { Injectable } from "@nestjs/common";

import { DatabaseService, type TenantContext } from "../../database/database.service";
import { jsonb } from "../../database/json-param";
import type { StaffListingRow, StaffListingSummaryRow } from "../dao/staff-listing.row";

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
      /*
       * ⚠️ tx.json(...), NOT JSON.stringify(...)::jsonb.
       *
       * postgres.js JSON-encodes a string parameter bound to a json/jsonb column. Passing an
       * already-stringified value therefore encodes it TWICE, and the column ends up holding a
       * JSON *string* rather than an object or array — jsonb_typeof returns 'string'. Nothing
       * errors: the write succeeds, and every read gets a string back where the code expects a
       * structure. Defensive Array.isArray checks then quietly turn it into an empty array, so
       * the data looks merely absent rather than corrupt. Shipped once here; see BUILD_LOG.
       */
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
          ${jsonb(tx, input.features ?? [])},
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
  /*
   * ⚠️⚠️ EVERY `patch.status` PARAMETER BELOW IS CAST TO `::listing_status`, AND THE ONE IN
   * `IS NOT NULL` IS WHY. DO NOT REMOVE THEM AS REDUNDANT.
   *
   * Postgres infers a parameter's type from the context it appears in, and `$n IS NOT NULL`
   * supplies no context at all. The statement therefore failed to PARSE — `42P18: could not
   * determine data type of parameter $17` — before touching a row and regardless of what was
   * being updated. Every listing update was a 500. Not "sometimes": always.
   *
   * It survived because nothing reached it. The admin's own form validation rejected every edit
   * before the request was sent (see the long note in `apps/admin/src/app/listings/actions.ts`),
   * and no integration test covers `update()`. Two independent bugs, the first hiding the second,
   * until a browser test changed a price and then looked at the public site.
   *
   * The comparisons are cast too, not just the `IS NOT NULL`: it costs nothing and it stops the
   * next reader from tidying away the "unnecessary" ones and bringing this back.
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
          features     = coalesce(${patch.features ? jsonb(tx, patch.features) : null}, features),
          close_price  =
            CASE WHEN ${patch.closePrice !== undefined}
                 THEN ${patch.closePrice ?? null}
                 ELSE close_price END,
          -- Closing timestamp is derived, never supplied: a status of SOLD/RENTED without a
          -- closed_at would break every trailing-90-day market statistic silently.
          closed_at =
            CASE WHEN ${patch.status ?? null}::listing_status IN ('SOLD', 'RENTED')
                      AND closed_at IS NULL
                 THEN now()
                 WHEN ${patch.status ?? null}::listing_status IS NOT NULL
                      AND ${patch.status ?? null}::listing_status NOT IN ('SOLD', 'RENTED')
                 THEN NULL
                 ELSE closed_at END,
          published_at =
            CASE WHEN ${patch.status ?? null}::listing_status = 'ACTIVE' AND published_at IS NULL
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
  ): Promise<StaffListingSummaryRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<StaffListingSummaryRow[]>`
        SELECT
          l.id, l.reference_code, l.status::text AS status, l.price, l.title,
          l.visibility::text AS visibility, l.possession::text AS possession,
          l.updated_at,
          loc.slug AS locality_slug, c.slug AS city_slug,
          -- Photo count drives the "needs photos" nudge on the list screen. A listing with no
          -- pictures converts so badly that surfacing it is worth the subquery.
          (SELECT count(*) FROM listing_media m
            WHERE m.listing_id = l.id AND m.processing_status = 'READY')::int AS photo_count
        FROM listing l
        JOIN property p   ON p.id = l.property_id
        JOIN locality loc ON loc.id = p.locality_id
        JOIN city c       ON c.id = loc.city_id
        WHERE (${options.status ?? null}::text IS NULL OR l.status::text = ${options.status ?? null})
        ORDER BY l.updated_at DESC
        LIMIT ${options.limit ?? 100}
      `;
    });
  }

  /**
   * One listing with every field the edit form needs.
   *
   * ⚠️ Deliberately NOT reusing `ListingRepository.selection()`. That projection is shaped for the
   * PUBLIC wire contract — it resolves RERA registrations, joins the agent name, and is filtered
   * by `publicScope` to exclude drafts. The edit form needs the opposite: raw stored values,
   * drafts included, and no derived presentation. Sharing one projection between "what a buyer
   * sees" and "what an agent edits" is how a draft eventually leaks into a public response.
   *
   * Tenant-scoped by RLS; returns null for another organisation's listing, which the service
   * reports as 404 rather than 403.
   */
  async findOneForEdit(
    listingId: string,
    context: TenantContext,
  ): Promise<StaffListingRow | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<StaffListingRow[]>`
        SELECT
          l.id, l.reference_code, l.status::text AS status,
          l.transaction_type::text AS transaction_type, l.visibility::text AS visibility,
          l.possession::text AS possession, l.possession_date,
          l.price, l.price_on_request, l.close_price, l.maintenance_monthly,
          l.furnishing::text AS furnishing, l.title, l.description, l.features,
          l.published_at, l.created_at, l.updated_at,

          p.id AS property_id, p.property_type::text AS property_type,
          p.address_line, p.plot_number, p.pincode,
          ST_Y(p.location::geometry) AS lat,
          ST_X(p.location::geometry) AS lng,
          p.plot_area_sqft, p.built_up_area_sqft, p.carpet_area_sqft,
          p.area_input_value, p.area_input_unit::text AS area_input_unit,
          p.area_conversion_factor, p.area_input_basis::text AS area_input_basis,
          p.bedrooms, p.bathrooms, p.balconies, p.total_floors, p.floor_number,
          p.facing::text AS facing, p.year_built,

          loc.slug AS locality_slug, c.slug AS city_slug, c.state AS city_state,
          (SELECT count(*) FROM listing_media m
            WHERE m.listing_id = l.id AND m.processing_status = 'READY')::int AS photo_count
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
