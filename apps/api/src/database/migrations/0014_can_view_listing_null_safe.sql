-- 0014: can_view_listing must return a BOOLEAN, never NULL
--
-- THE BUG: for an anonymous visitor the function returned NULL rather than false.
--
--   is_platform_admin()                          -> false
--   OR l_org_id = current_org_id()               -> NULL   (current_org_id() is NULL when unset)
--   OR (l_visibility = 'PUBLIC' AND ... )        -> false
--   OR EXISTS (... partner_relationship ...)     -> false
--
-- and `false OR NULL OR false OR false` is NULL in three-valued logic. Only the public-catalog
-- branch rescued it, because `NULL OR true` is true — which is why public browsing worked and
-- nothing looked wrong.
--
-- WHY IT WAS NOT A LEAK, AND WHY IT STILL HAS TO GO: a policy's USING clause treats NULL as
-- false, so the predicate happened to fail closed in the one place it is currently used. That is
-- luck, not design. The function is granted to the runtime role and is a perfectly ordinary
-- callable predicate, and the moment anyone writes `NOT can_view_listing(...)` — an "listings I
-- cannot see" admin report, an exclusion filter, a CHECK constraint — the answer becomes NULL,
-- which is *not* true, and the query silently returns nothing. A security predicate that answers
-- "unknown" is a trap with a long fuse.
--
-- Found by the exhaustive tier x visibility x status matrix in can-view-listing.spec.ts, on the
-- anonymous row. It is exactly the sort of thing sampling a few combinations does not catch.
--
-- ⚠️ CREATE OR REPLACE resets the function's attributes to whatever this command states, so
-- SECURITY DEFINER and the pinned search_path from 0012 must be repeated here in full. Dropping
-- either silently would undo 0012 — see the note there on why an unpinned definer-rights function
-- is a privilege-escalation vector. The GRANTs survive a REPLACE (the ACL is preserved), but they
-- are restated below so this file is self-contained and does not depend on that behaviour.

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
    -- Your own inventory, always, at any status. NULL when the caller is anonymous, which is
    -- what coalesce() below is here to absorb.
    OR l_org_id = current_org_id()
    -- The public catalog is world-readable, including to anonymous visitors.
    OR (l_visibility = 'PUBLIC' AND l_status = 'ACTIVE')
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
