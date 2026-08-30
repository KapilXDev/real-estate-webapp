/** Row shapes for listing_media. See catalog/dao for why this layer is isolated. */
export interface MediaRow {
  id: string;
  listing_id: string;
  storage_key: string;
  kind: string;
  sort_order: number;
  caption: string | null;
  width: number | null;
  height: number | null;
  processing_status: string;
  /** { variant: { key, width, height, bytes } } — see migration 0018 for why jsonb. */
  variants: unknown;
  mime_type: string | null;
  byte_size: number | null;
  checksum: string | null;
  error_detail: string | null;
  created_at: Date;
}

export interface VariantRecord {
  key: string;
  width: number;
  height: number;
  bytes: number;
}
