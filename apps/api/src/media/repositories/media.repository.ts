import { Injectable } from "@nestjs/common";

import { ANONYMOUS, DatabaseService, type TenantContext } from "../../database/database.service";
import { jsonb } from "../../database/json-param";
import type { MediaRow, VariantRecord } from "../dao/media.row";

@Injectable()
export class MediaRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Confirm the listing exists and belongs to the caller's organisation.
   *
   * ⚠️ CALLED BEFORE EVERY UPLOAD, and it is not redundant with the RLS policy on
   * `listing_media`. The policy would reject the INSERT — but only after the request has already
   * been read into memory, decoded, resized into three variants and written to object storage.
   * Checking first means an upload aimed at a competitor's listing costs one indexed lookup
   * instead of a full pipeline run plus orphaned objects nobody will ever clean up.
   */
  async assertListingWritable(listingId: string, context: TenantContext): Promise<boolean> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM listing
        WHERE id = ${listingId}
          AND (organization_id = current_org_id() OR is_platform_admin())
        LIMIT 1
      `;
      return rows.length > 0;
    });
  }

  /**
   * A previously-processed upload of the identical bytes on the same listing.
   *
   * Agents re-upload the same photo constantly — from the camera roll, from a WhatsApp forward,
   * from a listing they copied. Returning the existing row skips a decode, three resizes and four
   * object writes, and avoids showing the same picture twice in the gallery.
   */
  async findByChecksum(
    listingId: string,
    checksum: string,
    context: TenantContext,
  ): Promise<MediaRow | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<MediaRow[]>`
        SELECT id, listing_id, storage_key, kind::text AS kind, sort_order, caption,
               width, height, processing_status::text AS processing_status, variants,
               mime_type, byte_size, checksum, error_detail, created_at
        FROM listing_media
        WHERE listing_id = ${listingId}
          AND checksum = ${checksum}
          AND processing_status = 'READY'
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
  }

  /**
   * Reserve a row before any bytes are written.
   *
   * ⚠️ THE ROW COMES FIRST, AS 'PENDING', AND THAT ORDERING MATTERS. The storage keys embed the
   * media id, so the id has to exist before anything can be written — and doing it this way round
   * means a crash mid-upload leaves a PENDING row pointing at the objects that were written,
   * which is recoverable. The other order leaves objects in the bucket with nothing referencing
   * them: invisible, unbilled-for-nothing, and impossible to find later.
   */
  async reserve(
    input: { listingId: string; kind: string; caption?: string },
    context: TenantContext,
  ): Promise<{ id: string; sortOrder: number }> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string; sort_order: number }[]>`
        INSERT INTO listing_media (listing_id, storage_key, kind, caption, sort_order, processing_status)
        VALUES (
          ${input.listingId},
          -- Placeholder: the real key needs the id this INSERT is generating. Rewritten by
          -- markReady() below. NOT NULL on the column, so it cannot simply be left empty.
          'pending',
          ${input.kind}::media_kind,
          ${input.caption ?? null},
          -- Append to the end. coalesce handles the first photo, where max() is NULL.
          (SELECT coalesce(max(sort_order), -1) + 1 FROM listing_media WHERE listing_id = ${input.listingId}),
          'PENDING'
        )
        RETURNING id, sort_order
      `;
      if (!rows[0]) throw new Error("listing_media insert returned no row");
      return { id: rows[0].id, sortOrder: rows[0].sort_order };
    });
  }

  async markReady(
    input: {
      id: string;
      storageKey: string;
      variants: Record<string, VariantRecord>;
      mimeType: string;
      byteSize: number;
      checksum: string;
      width: number;
      height: number;
    },
    context: TenantContext,
  ): Promise<void> {
    await this.database.withTenant(context, async (tx) => {
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
      await tx`
        UPDATE listing_media SET
          storage_key       = ${input.storageKey},
          variants          = ${jsonb(tx, input.variants)},
          mime_type         = ${input.mimeType},
          byte_size         = ${input.byteSize},
          checksum          = ${input.checksum},
          width             = ${input.width},
          height            = ${input.height},
          error_detail      = NULL,
          processing_status = 'READY'
        WHERE id = ${input.id}
      `;
    });
  }

  /**
   * Record a failure on the row rather than deleting it.
   *
   * A FAILED row with an error is diagnosable from the database; a deleted row means the agent
   * saw an upload fail and there is no trace of why. The row is also what a retry can reuse.
   */
  async markFailed(id: string, detail: string, context: TenantContext): Promise<void> {
    await this.database.withTenant(context, async (tx) => {
      await tx`
        UPDATE listing_media
           SET processing_status = 'FAILED',
               error_detail = ${detail.slice(0, 500)}
         WHERE id = ${id}
      `;
    });
  }

  /** Ready media for one listing, in display order. RLS scopes it to the caller. */
  async findForListing(
    listingId: string,
    context: TenantContext = ANONYMOUS,
  ): Promise<MediaRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<MediaRow[]>`
        SELECT id, listing_id, storage_key, kind::text AS kind, sort_order, caption,
               width, height, processing_status::text AS processing_status, variants,
               mime_type, byte_size, checksum, error_detail, created_at
        FROM listing_media
        WHERE listing_id = ${listingId}
          AND processing_status = 'READY'
        ORDER BY sort_order ASC, id ASC
      `;
    });
  }

  /**
   * Everything for one listing INCLUDING pending and failed — the admin view.
   *
   * Separate method rather than a flag: the public path must never accidentally serve a PENDING
   * row, and a boolean parameter is the kind of thing that gets passed through from a query
   * string by mistake.
   */
  async findForListingAdmin(listingId: string, context: TenantContext): Promise<MediaRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<MediaRow[]>`
        SELECT id, listing_id, storage_key, kind::text AS kind, sort_order, caption,
               width, height, processing_status::text AS processing_status, variants,
               mime_type, byte_size, checksum, error_detail, created_at
        FROM listing_media
        WHERE listing_id = ${listingId}
        ORDER BY sort_order ASC, id ASC
      `;
    });
  }

  /** One row, by id, for delivery and delete. Null when RLS hides it or it does not exist. */
  async findById(id: string, context: TenantContext = ANONYMOUS): Promise<MediaRow | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<MediaRow[]>`
        SELECT id, listing_id, storage_key, kind::text AS kind, sort_order, caption,
               width, height, processing_status::text AS processing_status, variants,
               mime_type, byte_size, checksum, error_detail, created_at
        FROM listing_media
        WHERE id = ${id}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
  }

  /** Returns false when the row does not exist or belongs to another organisation. */
  async remove(id: string, context: TenantContext): Promise<boolean> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM listing_media WHERE id = ${id} RETURNING id
      `;
      return rows.length > 0;
    });
  }

  /**
   * Reorder a listing's photos.
   *
   * ⚠️ One statement over a VALUES list, not a loop of UPDATEs. Photo order is the hero-image
   * decision, and a loop that fails halfway leaves a half-reordered gallery with duplicate
   * sort_order values and a nondeterministic hero. Inside `withTenant` this is a single
   * transaction, so it either fully applies or does not.
   */
  async reorder(
    listingId: string,
    orderedIds: string[],
    context: TenantContext,
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await this.database.withTenant(context, async (tx) => {
      await tx`
        UPDATE listing_media m
           SET sort_order = v.position
          FROM (
            SELECT id::uuid, position
            FROM unnest(${orderedIds}::uuid[]) WITH ORDINALITY AS t(id, position)
          ) AS v
         WHERE m.id = v.id
           AND m.listing_id = ${listingId}
      `;
    });
  }
}
