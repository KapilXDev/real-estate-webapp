import type { MediaRow, VariantRecord } from "../dao/media.row";

/**
 * Row -> wire.
 *
 * ⚠️ RETURNS API PATHS, NOT STORAGE KEYS. The bucket key is internal: exposing it hands out the
 * file's real address and invites clients to bypass the RLS check in `streamVariant` by talking
 * to storage directly. Every delivery goes through `/api/media/{id}/{variant}`, which resolves
 * the row under the caller's tenant context first.
 */
export interface MediaDto {
  id: string;
  url: string;
  /** Per-variant URLs, for a srcset. */
  variants: Record<string, { url: string; width: number; height: number }>;
  caption: string;
  order: number;
  width: number | null;
  height: number | null;
}

export function toMediaDto(row: MediaRow): MediaDto {
  const variants = (row.variants ?? {}) as Record<string, VariantRecord>;

  const urls: MediaDto["variants"] = {};
  for (const [name, record] of Object.entries(variants)) {
    urls[name] = {
      url: `/api/media/${row.id}/${name}`,
      width: record.width,
      height: record.height,
    };
  }

  return {
    id: row.id,
    // `card` is the default because it is what search results use — by far the most requests.
    url: urls.card?.url ?? urls.hero?.url ?? `/api/media/${row.id}/card`,
    variants: urls,
    caption: row.caption ?? "",
    order: row.sort_order,
    width: row.width,
    height: row.height,
  };
}

/** Admin view: adds the processing state an agent needs to see. */
export function toAdminMediaDto(row: MediaRow) {
  return {
    ...toMediaDto(row),
    status: row.processing_status,
    error: row.error_detail,
    byteSize: row.byte_size,
  };
}
