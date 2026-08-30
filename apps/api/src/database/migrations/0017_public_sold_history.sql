-- 0017: The host's sold history is public; everyone else's is not
--
-- THE PROBLEM: `can_view_listing` admits a listing to the public catalog only when it is
-- `PUBLIC` **and** `ACTIVE`. The website has an own-listings page whose entire purpose is the
-- agent's sold record — "12 kothis sold in Mohali this year" is the single strongest credibility
-- signal on an agent site — and `getOwnListings({ includeSold: true })` was therefore asking for
-- rows no anonymous visitor could ever read.
--
-- WHY NOT JUST MAKE ALL SOLD LISTINGS PUBLIC: because `close_price` is on those rows. Partner
-- brokerages are competing businesses sharing this database, and publishing what a rival actually
-- closed at — to the rival — is worse than the original problem. A partner who marks a listing
-- PUBLIC is consenting to advertise it for sale, not to disclose its settlement price forever.
--
-- SO THE WIDENING IS SCOPED TO THE HOST ORGANISATION — the one whose website this is (0016's
-- `is_host` flag). Its own sold history is deliberate marketing it controls. Everyone else's
-- closed inventory stays where it was: visible to the owning org, and to partners at the tier
-- they were granted.
--
-- UNDER_OFFER is opened to everyone, by contrast: it is a state buyers benefit from seeing (an
-- "under offer" badge is standard and it sets expectations), it carries no settlement figure, and
-- hiding it makes active inventory silently vanish mid-negotiation.
--
-- ⚠️ FOURTH REVISION OF THIS FUNCTION (0010 created it, 0012 pinned search_path, 0014 made it
-- NULL-safe). CREATE OR REPLACE resets attributes, so SECURITY DEFINER, the pinned search_path
-- and the coalesce from 0014 are all restated below IN FULL. Dropping any of them here would
-- silently undo an earlier fix — that is the trap this comment exists to stop.

CREATE OR REPLACE FUNCTION can_view_listing(
  l_org_id     uuid,
  l_visibility listing_visibility,
  l_status     listing_status
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce(
    -- Platform admin (the host brokerage) moderates everything.
    is_platform_admin()
    -- Your own inventory, always, at any status.
    OR l_org_id = current_org_id()
    -- The public catalog.
    OR (
      l_visibility = 'PUBLIC'
      AND (
        l_status IN ('ACTIVE', 'UNDER_OFFER')
        -- Closed deals are public only for the host organisation — its own track record.
        OR (
          l_status IN ('SOLD', 'RENTED')
          AND EXISTS (SELECT 1 FROM organization o WHERE o.id = l_org_id AND o.is_host)
        )
      )
    )
    -- Otherwise, whatever tier the viewing org has been granted.
    OR EXISTS (
      SELECT 1
      FROM partner_relationship pr
      WHERE pr.partner_org_id = current_org_id()
        AND pr.status = 'ACTIVE'
        AND (
          pr.tier = 'FULL'
          OR (pr.tier = 'NETWORK'
              AND l_visibility IN ('PUBLIC', 'NETWORK_ONLY')
              AND l_status = 'ACTIVE')
          OR (pr.tier = 'PUBLIC_PLUS_OWN'
              AND l_visibility = 'PUBLIC'
              AND l_status = 'ACTIVE')
        )
    ),
    false  -- deny is the only safe answer to "unknown"
  );
$fn$;

REVOKE ALL     ON FUNCTION can_view_listing(uuid, listing_visibility, listing_status) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION can_view_listing(uuid, listing_visibility, listing_status) TO   tricity_app;
