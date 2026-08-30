import { Injectable } from "@nestjs/common";
import type postgres from "postgres";
import type { ListingSearchParamsDto } from "@tricity/contracts";

import { ANONYMOUS, DatabaseService, type TenantContext } from "../../database/database.service";
import type { CountedRow, ListingMediaRow, ListingRow, MarketStatsRow } from "../dao/listing.row";
import {
  FURNISHING_TO_DB,
  POSSESSION_TO_DB,
  PROPERTY_TYPE_TO_DB,
  PUBLIC_PROPERTY_TYPE_DB_VALUES,
  PUBLIC_STATUS_DB_VALUES,
  STATUS_TO_DB,
  TRANSACTION_TO_DB,
} from "../utils/enum-maps";
import { and, boundsGeography, or, orderBy, polygonGeography, type Fragment } from "../utils/sql-filters";

/**
 * The ONLY place in the catalog module that writes SQL.
 *
 * Services above it deal in domain objects and never see a query; controllers above them never
 * see a database at all. That boundary is what makes the tenant rule enforceable by reading one
 * file: every method here goes through `withTenant()`, so a query that forgets its tenant context
 * cannot be written without deleting a line that is obviously load-bearing.
 *
 * ⚠️ WHY `withTenant(ANONYMOUS)` RATHER THAN `this.sql` FOR PUBLIC READS. It looks redundant —
 * anonymous means no organisation, so why open a transaction to set an empty string? Because
 * `current_org_id()` returns NULL when the setting was never set, and postgres.js POOLS
 * CONNECTIONS. A public query run on a raw connection inherits whatever `app.current_org_id` the
 * previous request left behind if anything ever used plain `SET`. Going through `withTenant`
 * makes every request explicitly declare its identity, including "nobody", inside a transaction
 * that cannot leak. The cost is one round trip; the alternative is a cross-tenant leak that is
 * essentially impossible to reproduce on demand.
 */
@Injectable()
export class ListingRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The projection every read shares.
   *
   * A fragment rather than a view: it needs the tenant-context-dependent RERA join, and a view
   * would fix the join at definition time. Kept in one place so the DAO row type has exactly one
   * query to correspond to.
   *
   * ⚠️ `ST_Y`/`ST_X` rather than selecting `location` directly — the raw column arrives as a WKB
   * hex string that would need parsing in JS for no reason.
   *
   * ⚠️ The `organization_rera` join is on `c.state`, NOT on the organisation's default
   * jurisdiction. A Chandigarh listing must carry the Chandigarh authority's registration and a
   * Mohali listing Punjab's — they are different regulators, and advertising the wrong number is
   * the same compliance failure as advertising none.
   */
  private selection(sql: postgres.Sql, opts: { withCount?: boolean } = {}): Fragment {
    /*
     * The window count rides along on every row of the page rather than being a second query.
     * A fragment, because it is only wanted for paginated reads — adding it unconditionally would
     * make Postgres compute a full window over the match set for single-row lookups too.
     */
    const count = opts.withCount ? sql`count(*) OVER () AS total_count,` : sql``;

    return sql`
      SELECT
        ${count}
        l.id, l.reference_code, l.organization_id, l.status::text AS status,
        l.transaction_type::text AS transaction_type, l.visibility::text AS visibility,
        l.source::text AS source,
        l.price, l.price_on_request, l.close_price, l.closed_at,
        l.maintenance_monthly, l.furnishing::text AS furnishing,
        l.title, l.description, l.features,
        l.possession::text AS possession, l.possession_date,
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

        loc.slug AS locality_slug, loc.name AS locality_name,
        c.slug AS city_slug, c.name AS city_name, c.state AS city_state,

        proj.name AS project_name, proj.rera_project_no AS project_rera_no,

        o.name AS org_name, o.is_host AS org_is_host,
        u.full_name AS agent_name,
        rera.registration_no AS rera_registration_no,
        rera.authority_name  AS rera_authority_name
      FROM listing l
      JOIN property p        ON p.id = l.property_id
      JOIN locality loc      ON loc.id = p.locality_id
      JOIN city c            ON c.id = loc.city_id
      JOIN organization o    ON o.id = l.organization_id
      LEFT JOIN project proj ON proj.id = p.project_id
      LEFT JOIN app_user u   ON u.id = l.listed_by_user_id
      LEFT JOIN organization_rera rera
             ON rera.organization_id = l.organization_id
            AND rera.state = c.state
    `;
  }

  /**
   * Predicates that keep internal workflow states off the public site.
   *
   * ⚠️ REDUNDANT WITH RLS, AND THAT IS THE POINT. `can_view_listing` already excludes drafts from
   * an anonymous caller. This is the second lock: RLS protects against a forgotten WHERE clause,
   * and this protects against a mistake in RLS. The two were written from different angles and
   * both have to fail before a draft reaches a buyer.
   */
  private publicScope(sql: postgres.Sql): Fragment {
    return sql`
      l.visibility = 'PUBLIC'
      AND l.status::text = ANY(${PUBLIC_STATUS_DB_VALUES})
      AND p.property_type::text = ANY(${PUBLIC_PROPERTY_TYPE_DB_VALUES})
    `;
  }

  /** Translate the search DTO into predicates. Every value stays a bind parameter. */
  private filters(sql: postgres.Sql, params: ListingSearchParamsDto): Fragment {
    const f: (Fragment | undefined)[] = [];

    if (params.q) {
      /*
       * Full-text over the generated `search_vector`, OR a reference-code prefix.
       *
       * The reference-code branch matters more than it looks: when someone types "TE-001042" they
       * are quoting a code from a WhatsApp message or a phone call and they want that exact
       * listing. `websearch_to_tsquery` would stem it into nothing and return an empty page,
       * which reads as "your property is gone".
       */
      f.push(sql`(
        l.search_vector @@ websearch_to_tsquery('english', ${params.q})
        OR l.reference_code ILIKE ${`${params.q}%`}
        OR loc.name ILIKE ${`%${params.q}%`}
        OR proj.name ILIKE ${`%${params.q}%`}
      )`);
    }

    if (params.citySlugs?.length) f.push(sql`c.slug = ANY(${params.citySlugs})`);

    if (params.localities?.length) {
      /*
       * ⚠️ MUST match on the (city, locality) PAIR. Locality slugs are unique per city only —
       * `UNIQUE (city_id, slug)`. Filtering on `loc.slug = ANY(...)` alone would return Mohali
       * Sector 70 for a buyer who asked for Chandigarh's, and telling someone a property is in a
       * different town is about the worst wrong answer this endpoint can give.
       */
      f.push(
        or(
          sql,
          params.localities.map(
            (ref) => sql`(c.slug = ${ref.citySlug} AND loc.slug = ${ref.localitySlug})`,
          ),
        ),
      );
    }

    if (params.status?.length) {
      const values = params.status.map((s) => STATUS_TO_DB[s]);
      f.push(sql`l.status::text = ANY(${values})`);
    }
    if (params.transactionType) {
      f.push(sql`l.transaction_type::text = ${TRANSACTION_TO_DB[params.transactionType]}`);
    }

    if (params.minPrice !== undefined) f.push(sql`l.price >= ${params.minPrice}`);
    if (params.maxPrice !== undefined) f.push(sql`l.price <= ${params.maxPrice}`);
    if (params.minBeds !== undefined) f.push(sql`p.bedrooms >= ${params.minBeds}`);
    if (params.minBaths !== undefined) f.push(sql`p.bathrooms >= ${params.minBaths}`);
    if (params.minYearBuilt !== undefined) f.push(sql`p.year_built >= ${params.minYearBuilt}`);
    if (params.maxMaintenance !== undefined) {
      // A listing with no maintenance figure passes a maintenance cap: "no society charges" is
      // strictly better than "charges under the cap", and excluding those rows would hide every
      // plot and kothi from anyone who touched this filter.
      f.push(sql`(l.maintenance_monthly IS NULL OR l.maintenance_monthly <= ${params.maxMaintenance})`);
    }

    /*
     * Area filters use the same precedence as the site's sort: carpet, then built-up, then plot.
     * Comparing against a single column would silently exclude every bare plot from a minimum-area
     * filter, because plots have no built-up area at all.
     */
    if (params.minSqft !== undefined) {
      f.push(sql`coalesce(p.carpet_area_sqft, p.built_up_area_sqft, p.plot_area_sqft) >= ${params.minSqft}`);
    }
    if (params.maxSqft !== undefined) {
      f.push(sql`coalesce(p.carpet_area_sqft, p.built_up_area_sqft, p.plot_area_sqft) <= ${params.maxSqft}`);
    }

    if (params.propertyTypes?.length) {
      const values = params.propertyTypes.map((t) => PROPERTY_TYPE_TO_DB[t]);
      f.push(sql`p.property_type::text = ANY(${values})`);
    }
    if (params.possession?.length) {
      const values = params.possession.map((p) => POSSESSION_TO_DB[p]);
      f.push(sql`l.possession::text = ANY(${values})`);
    }
    if (params.furnishing?.length) {
      const values = params.furnishing.map((v) => FURNISHING_TO_DB[v]);
      f.push(sql`l.furnishing::text = ANY(${values})`);
    }

    if (params.features?.length) {
      // `@>` containment: the listing must have ALL requested features, matching the UI's
      // "must have" chips. Any-of would make each extra chip widen the results, which is the
      // opposite of what a filter appears to promise.
      f.push(sql`l.features @> ${JSON.stringify(params.features)}::jsonb`);
    }

    if (params.bounds) {
      f.push(sql`ST_Intersects(p.location, ${boundsGeography(sql, params.bounds)})`);
    }
    if (params.polygons?.length) {
      // Multiple drawn areas are a UNION — it mirrors how buyers think ("this bit or that bit")
      // and matches the existing MockProvider semantics, so switching providers cannot change
      // what a saved search means.
      f.push(
        or(
          sql,
          params.polygons.map(
            (poly) => sql`ST_Intersects(p.location, ${polygonGeography(sql, poly)})`,
          ),
        ),
      );
    }

    return and(sql, f);
  }

  /* ---------------------------------------------------------------- *
   * Reads
   * ---------------------------------------------------------------- */

  async search(
    params: ListingSearchParamsDto,
    context: TenantContext = ANONYMOUS,
  ): Promise<{ rows: ListingRow[]; total: number }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));
    const offset = (page - 1) * pageSize;

    return this.database.withTenant(context, async (tx) => {
      /*
       * `count(*) OVER ()` rather than a second COUNT query: one round trip, one plan, and — more
       * importantly — one consistent snapshot. Two separate queries can straddle a commit and
       * report "24 of 137" on a page that has 23 rows, which shows up as an off-by-one in
       * pagination that nobody can reproduce.
       */
      const rows = await tx<(ListingRow & CountedRow)[]>`
        ${this.selection(tx, { withCount: true })}
        WHERE ${this.publicScope(tx)}
          AND ${this.filters(tx, params)}
        ${orderBy(tx, params.sort)}
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      // Zero rows means zero matches — there is no window row to read the count from, and
      // defaulting to anything else would render "137 results" above an empty page.
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      return { rows, total };
    });
  }

  async findByKey(
    listingKey: string,
    context: TenantContext = ANONYMOUS,
  ): Promise<ListingRow | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<ListingRow[]>`
        ${this.selection(tx)}
        WHERE l.id = ${listingKey}
          AND ${this.publicScope(tx)}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
  }

  /**
   * The host organisation's own inventory.
   *
   * Sold and rented rows are public for the host only — see migration 0017 for why that widening
   * is scoped rather than global (a partner's `close_price` is not ours to publish).
   */
  async findHostListings(
    options: { includeSold?: boolean; limit?: number } = {},
    context: TenantContext = ANONYMOUS,
  ): Promise<ListingRow[]> {
    const statuses = options.includeSold
      ? ["ACTIVE", "UNDER_OFFER", "SOLD", "RENTED"]
      : ["ACTIVE", "UNDER_OFFER"];

    return this.database.withTenant(context, async (tx) => {
      return tx<ListingRow[]>`
        ${this.selection(tx)}
        WHERE o.is_host
          AND l.visibility = 'PUBLIC'
          AND l.status::text = ANY(${statuses})
          AND p.property_type::text = ANY(${PUBLIC_PROPERTY_TYPE_DB_VALUES})
        ORDER BY
          -- Live inventory first, then the sold record beneath it: a page that opens on closed
          -- deals reads like an agent with nothing to sell.
          CASE WHEN l.status IN ('ACTIVE', 'UNDER_OFFER') THEN 0 ELSE 1 END,
          coalesce(l.closed_at, l.published_at, l.created_at) DESC,
          l.id ASC
        LIMIT ${options.limit ?? 60}
      `;
    });
  }

  async findByLocality(
    ref: { citySlug: string; localitySlug: string },
    limit: number,
    context: TenantContext = ANONYMOUS,
  ): Promise<ListingRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<ListingRow[]>`
        ${this.selection(tx)}
        WHERE c.slug = ${ref.citySlug}
          AND loc.slug = ${ref.localitySlug}
          AND ${this.publicScope(tx)}
        ${orderBy(tx, "newest")}
        LIMIT ${limit}
      `;
    });
  }

  async findByCity(
    citySlug: string,
    limit: number,
    context: TenantContext = ANONYMOUS,
  ): Promise<ListingRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<ListingRow[]>`
        ${this.selection(tx)}
        WHERE c.slug = ${citySlug}
          AND ${this.publicScope(tx)}
        ${orderBy(tx, "newest")}
        LIMIT ${limit}
      `;
    });
  }

  /** Media for a set of listings, in one query rather than N. */
  async findMedia(
    listingIds: string[],
    context: TenantContext = ANONYMOUS,
  ): Promise<Map<string, ListingMediaRow[]>> {
    if (listingIds.length === 0) return new Map();

    const rows = await this.database.withTenant(context, async (tx) => {
      return tx<ListingMediaRow[]>`
        SELECT listing_id, storage_key, caption, sort_order, kind, processing_status
        FROM listing_media
        WHERE listing_id = ANY(${listingIds}::uuid[])
          -- A photo still being resized would render as a broken image; the UI shows a
          -- placeholder for a listing with no media, which is the better failure.
          AND processing_status = 'READY'
        ORDER BY sort_order ASC, id ASC
      `;
    });

    const byListing = new Map<string, ListingMediaRow[]>();
    for (const row of rows) {
      const existing = byListing.get(row.listing_id);
      if (existing) existing.push(row);
      else byListing.set(row.listing_id, [row]);
    }
    return byListing;
  }

  /**
   * Aggregates for a locality.
   *
   * ⚠️ `percentile_cont` (median), not `avg`. One ₹12 crore farmhouse in a sector of ₹80 lakh
   * flats drags the mean far above anything a buyer could actually buy, and a market report that
   * overstates prices sends people away. The median is the number that describes the market.
   */
  async marketStats(
    ref: { citySlug: string; localitySlug: string },
    context: TenantContext = ANONYMOUS,
  ): Promise<MarketStatsRow | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<MarketStatsRow[]>`
        WITH scoped AS (
          SELECT l.*, p.carpet_area_sqft, p.built_up_area_sqft, p.plot_area_sqft
          FROM listing l
          JOIN property p   ON p.id = l.property_id
          JOIN locality loc ON loc.id = p.locality_id
          JOIN city ci      ON ci.id = loc.city_id
          WHERE ci.slug = ${ref.citySlug} AND loc.slug = ${ref.localitySlug}
        ),
        active AS (SELECT * FROM scoped WHERE status = 'ACTIVE' AND visibility = 'PUBLIC')
        SELECT
          (SELECT count(*) FROM active)::text AS active_count,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FROM active)::text
            AS median_list_price,
          (SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY price / NULLIF(coalesce(carpet_area_sqft, built_up_area_sqft, plot_area_sqft), 0)
           ) FROM active)::text AS median_price_per_sqft,
          (SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (now() - coalesce(published_at, created_at))) / 86400
           ) FROM active)::text AS median_days_on_market,
          (SELECT count(*) FROM scoped
            WHERE status IN ('SOLD','RENTED') AND closed_at >= now() - interval '90 days')::text
            AS closed_last_90,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price) FROM scoped
            WHERE status IN ('SOLD','RENTED') AND closed_at >= now() - interval '90 days')::text
            AS median_close_price,
          -- The prior 90-day window, for the trend figure. Comparing against "all history" would
          -- make every market look like it is rising forever.
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FROM scoped
            WHERE coalesce(published_at, created_at)
                  BETWEEN now() - interval '180 days' AND now() - interval '90 days')::text
            AS median_list_price_prior
      `;
      return rows[0] ?? null;
    });
  }
}
