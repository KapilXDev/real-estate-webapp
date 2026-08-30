-- 0012: Pin search_path on can_view_listing
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO 0010: the runner records a checksum per applied
-- file and rejects a changed one. That rule is the point — editing applied DDL is how dev and
-- production schemas silently diverge — so the fix is additive even though 0010 is one commit old.
--
-- THE BUG: can_view_listing is SECURITY DEFINER (it must be — the listing SELECT policy reads
-- partner_relationship, which is itself under RLS, so an invoker-rights function would evaluate
-- the tier check against only the rows the caller can already see and quietly deny legitimate
-- partner access). But it was created WITHOUT a pinned search_path, while all three SECURITY
-- DEFINER functions in 0011 pin theirs.
--
-- An unpinned search_path on a definer-rights function is the classic Postgres privilege
-- escalation: the function body resolves `partner_relationship`, `current_org_id()` and
-- `is_platform_admin()` through the CALLER's search_path, so anyone able to create objects in a
-- schema that resolves earlier can shadow them and decide the answer themselves. Here the answer
-- is "may this org read this listing", evaluated with owner rights — i.e. the whole cross-tenant
-- boundary. Postgres 15+ revoking CREATE on public from PUBLIC narrows the window; it does not
-- close it, and it is not something to depend on.
--
-- pg_catalog is listed first so built-in operators and casts cannot be shadowed either.

ALTER FUNCTION can_view_listing(uuid, listing_visibility, listing_status)
  SET search_path = pg_catalog, public;

-- current_org_id() and is_platform_admin() are SECURITY INVOKER, so they carry no elevated
-- rights to steal and are deliberately left alone.
