-- 0018: What listing_media needs to actually serve photos
--
-- The table was written before there was an upload path. Storing one `storage_key` per row is
-- enough to remember that a file exists and not enough to serve it well.

-- --- Processing status becomes an enum ------------------------------------------------------
-- It was free text with a 'PENDING' default and nothing to constrain it, so a typo like 'ready'
-- would leave the row invisible forever — the public read filters on exactly 'READY'.
CREATE TYPE media_status AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE media_kind   AS ENUM ('PHOTO', 'FLOOR_PLAN', 'VIDEO', 'DOCUMENT');

ALTER TABLE listing_media
  ALTER COLUMN processing_status DROP DEFAULT,
  ALTER COLUMN processing_status TYPE media_status USING processing_status::media_status,
  ALTER COLUMN processing_status SET DEFAULT 'PENDING';

ALTER TABLE listing_media
  ALTER COLUMN kind DROP DEFAULT,
  ALTER COLUMN kind TYPE media_kind USING kind::media_kind,
  ALTER COLUMN kind SET DEFAULT 'PHOTO';

-- --- Derivatives ----------------------------------------------------------------------------
-- ⚠️ A 6 MB phone photo on a listing page destroys the LCP < 2.5s target, and phone photos are
-- what agents will actually upload. Every image is resized into a few WebP variants at upload
-- time and the page picks one per breakpoint.
--
-- WHY jsonb RATHER THAN COLUMNS PER SIZE: the set of sizes is a rendering decision that will
-- change (add an AVIF variant, add a 2400px hero for retina). Each change would otherwise be a
-- migration plus a backfill, and rows written before it would carry NULLs that look like
-- processing failures. A map keyed by variant name absorbs that.
--
-- Shape: {"thumb": {"key": "...", "width": 400, "height": 300, "bytes": 12345}, ...}
ALTER TABLE listing_media
  ADD COLUMN variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN mime_type text,
  ADD COLUMN byte_size integer,
  -- SHA-256 of the ORIGINAL bytes. Agents re-upload the same photo constantly — from the camera
  -- roll, from WhatsApp, from a previous listing — and without this each copy is a fresh object
  -- and a fresh resize. Also the only way to tell "upload failed, retry" from "genuinely a
  -- second photo" when a request is retried.
  ADD COLUMN checksum text,
  -- Populated when processing_status = 'FAILED', so a stuck upload can be diagnosed from the row
  -- rather than by correlating logs.
  ADD COLUMN error_detail text;

CREATE INDEX listing_media_checksum_idx ON listing_media (listing_id, checksum)
  WHERE checksum IS NOT NULL;

-- Ready photos, in display order — the exact shape of the public read.
CREATE INDEX listing_media_ready_idx ON listing_media (listing_id, sort_order)
  WHERE processing_status = 'READY';

-- A READY row with no variants would render as a broken image. Better to refuse the state.
ALTER TABLE listing_media ADD CONSTRAINT listing_media_ready_has_variants CHECK (
  processing_status <> 'READY' OR variants <> '{}'::jsonb
);

-- --- RLS ------------------------------------------------------------------------------------
-- ⚠️ `listing_media` WAS NOT UNDER RLS AT ALL, which is a real hole now that rows carry object
-- keys. A media row is metadata about a photo of a property, and for a PRIVATE or DRAFT listing
-- that is exactly as confidential as the listing itself — the storage key is effectively the
-- address of the file. Without a policy, any org could enumerate every other org's photo keys.
--
-- It was invisible until now only because nothing had ever written a row.
--
-- The policy delegates to the parent listing rather than restating the rules: media inherits the
-- visibility of the thing it depicts, and duplicating the tier logic here would be a second place
-- to get it wrong.
ALTER TABLE listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_media FORCE  ROW LEVEL SECURITY;

CREATE POLICY listing_media_read_policy ON listing_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_media.listing_id
        AND can_view_listing(l.organization_id, l.visibility, l.status)
    )
  );

-- Writes are always your own inventory, regardless of any read tier a partner was granted.
CREATE POLICY listing_media_write_policy ON listing_media
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_media.listing_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_media.listing_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  );
