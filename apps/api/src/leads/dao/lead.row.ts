/**
 * Lead rows as selected. See `catalog/dao/listing.row.ts` for why this layer exists at all —
 * these are hand-written assertions over raw SQL and the compiler cannot check them.
 */
export interface LeadRow {
  id: string;
  kind: string;
  channel: string;
  status: string;
  /** smallint — arrives as a number, unlike numeric. */
  score: number;
  message: string | null;
  requirement: unknown;
  source: unknown;
  listing_id: string | null;
  created_at: Date;

  full_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  whatsapp_opt_in: boolean | null;
}
