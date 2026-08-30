import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { Readable } from "node:stream";

import { ANONYMOUS, type TenantContext } from "../../database/database.service";
import type { MediaRow, VariantRecord } from "../dao/media.row";
import { MediaRepository } from "../repositories/media.repository";
import { allKeysFor, originalKey, variantKey } from "../utils/storage-keys";
import {
  ImageProcessingService,
  UnsupportedImageError,
  VARIANTS,
} from "./image-processing.service";
import { ObjectStorageService } from "./object-storage.service";

/**
 * Listing photos: upload, delivery, ordering, deletion.
 *
 * ⚠️ THE UPLOAD IS SYNCHRONOUS — decode, resize and store all happen inside the request.
 *
 * That is a deliberate trade, not an oversight. At this scale (an agent uploading 10-20 phone
 * photos) each takes a few hundred milliseconds, and the operator is a human who is waiting and
 * wants to know it worked. The alternative — presigned direct-to-storage upload plus an async
 * processing queue — never blocks the Node process and is the right answer at volume, but it
 * needs bucket CORS, a job runner, and a UI that can display "still processing". None of that
 * earns its complexity yet.
 *
 * The migration path is deliberately open: `listing_media` already carries PENDING/PROCESSING/
 * FAILED states and an `error_detail` column, so moving processing out of the request later is a
 * change to this service and nothing else.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  /**
   * ⚠️ Enforced here as well as by multer's own limit.
   *
   * Multer rejects on byte count as the body streams in. This is the backstop for any caller that
   * reaches the service another way, and it is cheap. 25 MB comfortably fits a modern phone photo
   * (typically 4-8 MB) while bounding what one request can make us decode.
   */
  private static readonly MAX_BYTES = 25 * 1024 * 1024;

  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorageService,
    private readonly images: ImageProcessingService,
  ) {}

  async upload(
    input: { listingId: string; buffer: Buffer; caption?: string },
    context: TenantContext,
  ): Promise<{ id: string; deduplicated: boolean }> {
    if (input.buffer.byteLength === 0) {
      throw new BadRequestException("The uploaded file is empty.");
    }
    if (input.buffer.byteLength > MediaService.MAX_BYTES) {
      throw new PayloadTooLargeException(
        `That image is ${Math.round(input.buffer.byteLength / 1024 / 1024)}MB. The limit is 25MB.`,
      );
    }

    /*
     * Ownership FIRST — before decoding anything. See the note on assertListingWritable: without
     * this, an upload aimed at a competitor's listing would run the whole pipeline and write
     * objects before RLS rejected the insert, leaving orphans behind.
     *
     * 404 rather than 403: distinguishing "not yours" from "does not exist" would confirm which
     * listing ids exist in another organisation's inventory.
     */
    const writable = await this.media.assertListingWritable(input.listingId, context);
    if (!writable) throw new NotFoundException("Listing not found.");

    let processed;
    try {
      processed = await this.images.process(input.buffer);
    } catch (error) {
      if (error instanceof UnsupportedImageError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // Identical bytes already on this listing — skip the work and the duplicate gallery entry.
    const existing = await this.media.findByChecksum(input.listingId, processed.checksum, context);
    if (existing) {
      this.logger.log(`Duplicate upload on listing ${input.listingId}; reusing ${existing.id}`);
      return { id: existing.id, deduplicated: true };
    }

    const reserved = await this.media.reserve(
      { listingId: input.listingId, kind: "PHOTO", caption: input.caption },
      context,
    );

    try {
      const variants: Record<string, VariantRecord> = {};

      for (const variant of processed.variants) {
        const key = variantKey(input.listingId, reserved.id, variant.name);
        await this.storage.put(key, variant.buffer, variant.contentType);
        variants[variant.name] = {
          key,
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes,
        };
      }

      /*
       * The original is kept so the variant set can change later without asking agents to
       * re-upload. It is written LAST: if anything fails, the derivatives are the recoverable
       * part, and a missing original only costs the ability to reprocess.
       */
      const original = originalKey(input.listingId, reserved.id);
      await this.storage.put(original, input.buffer, processed.originalMime);

      await this.media.markReady(
        {
          id: reserved.id,
          storageKey: original,
          variants,
          mimeType: processed.originalMime,
          byteSize: processed.originalBytes,
          checksum: processed.checksum,
          width: processed.width,
          height: processed.height,
        },
        context,
      );

      return { id: reserved.id, deduplicated: false };
    } catch (error) {
      /*
       * Mark the row FAILED rather than deleting it. The agent needs to know the upload did not
       * work and why, and a row with `error_detail` is diagnosable later; a deleted row is not.
       * The public read filters on READY, so a failed row is never served.
       */
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Upload failed for listing ${input.listingId}: ${detail}`);
      await this.media.markFailed(reserved.id, detail, context).catch(() => {
        // Already handling a failure — a failure to record it must not mask the original.
      });
      throw error;
    }
  }

  /**
   * Stream one variant to the client.
   *
   * ⚠️ Runs under the CALLER's tenant context, not an elevated one. `listing_media` is under RLS
   * as of 0018 and its policy delegates to `can_view_listing`, so a photo of a PRIVATE or DRAFT
   * listing is not retrievable by guessing its id — the row lookup returns nothing. Storage keys
   * are effectively the file's address, which is why this must not be a bare object proxy.
   */
  async streamVariant(
    mediaId: string,
    variantName: string,
    context: TenantContext = ANONYMOUS,
  ): Promise<{ body: Readable; contentType: string } | null> {
    const row = await this.media.findById(mediaId, context);
    if (!row || row.processing_status !== "READY") return null;

    const variants = (row.variants ?? {}) as Record<string, VariantRecord | undefined>;
    const variant = variants[variantName];
    // Unknown variant name falls back to `card` rather than 404 — a stale URL from a cached page
    // referencing a retired variant should still render a photo.
    const chosen = variant ?? variants.card ?? Object.values(variants)[0];
    if (!chosen) return null;

    const object = await this.storage.get(chosen.key);
    if (!object) return null;

    return { body: object.body, contentType: object.contentType ?? "image/webp" };
  }

  async listForListing(listingId: string, context: TenantContext = ANONYMOUS): Promise<MediaRow[]> {
    return this.media.findForListing(listingId, context);
  }

  async listForAdmin(listingId: string, context: TenantContext): Promise<MediaRow[]> {
    return this.media.findForListingAdmin(listingId, context);
  }

  async remove(mediaId: string, context: TenantContext): Promise<void> {
    const row = await this.media.findById(mediaId, context);
    if (!row) throw new NotFoundException("Media not found.");

    const deleted = await this.media.remove(mediaId, context);
    if (!deleted) throw new NotFoundException("Media not found.");

    /*
     * Database row first, objects second. If the object delete fails we have orphaned files,
     * which cost a fraction of a cent and can be swept later. The other order risks a row that
     * points at objects which no longer exist — a broken image on a live listing page.
     */
    const variantNames = Object.keys((row.variants ?? {}) as Record<string, unknown>);
    await this.storage.deleteMany(allKeysFor(row.listing_id, row.id, variantNames));
  }

  async reorder(listingId: string, orderedIds: string[], context: TenantContext): Promise<void> {
    const writable = await this.media.assertListingWritable(listingId, context);
    if (!writable) throw new NotFoundException("Listing not found.");
    await this.media.reorder(listingId, orderedIds, context);
  }

  /** Variant names the API will serve. Used to validate the delivery route's parameter. */
  static readonly VARIANT_NAMES: string[] = VARIANTS.map((v) => v.name);
}
