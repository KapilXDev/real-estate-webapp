-- 0010: Row-Level Security
--
-- Runs last, once every referenced table exists.
--
-- WHY THIS MATTERS MORE THAN USUAL: partner brokers are competing businesses sharing one
-- database. A forgotten `WHERE organization_id = ...` is not a bug, it is a data leak between
-- rivals. Application-layer scoping is the first line; this is the one that holds when someone
-- forgets.
--
-- Every request sets these inside its transaction:
--   SET LOCAL app.current_org_id      = '<uuid>';
--   SET LOCAL app.is_platform_admin   = 'true' | 'false';
-- SET LOCAL (not SET) so the value dies with the transaction and cannot leak across pooled
-- connections — with a shared pool, a plain SET would be a cross-tenant disaster.
--
-- ⚠️⚠️ ENABLE IS NOT ENOUGH — SEE `FORCE ROW LEVEL SECURITY` BELOW.
--
-- Postgres exempts a table's OWNER from its own row-level policies. `ENABLE ROW LEVEL SECURITY`
-- alone therefore does nothing at all when the application connects as the same role that ran
-- the migrations, which is exactly what happens with a single-user local Compose setup. Every
-- policy in this file would be a silent no-op: no error, no warning, and every partner able to
-- read every rival's inventory.
--
-- `FORCE ROW LEVEL SECURITY` removes the owner exemption. It is applied to every table below.
--
-- Consequence to be aware of: the API can no longer read `app_user` before it knows which
-- organisation the user belongs to, because the policy needs `current_org_id()` — which is a
-- chicken-and-egg problem at login. That is solved by the SECURITY DEFINER lookup function in
-- 0011, NOT by weakening this file.

-- Read the current org, returning NULL rather than erroring when unset (e.g. migrations,
-- background jobs, anonymous public browsing).
CREATE FUNCTION current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$fn$;

CREATE FUNCTION is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.is_platform_admin', true) = 'true', false);
$fn$;

-- =========================================================================================
-- Listing visibility, resolved against the partner tier.
--
-- SECURITY DEFINER so the policy can read partner_relationship without the caller needing
-- direct rights on it. STABLE so Postgres caches it per statement rather than per row.
--
-- ⚠️ This function is the most security-critical SQL in the schema. It needs tests covering
-- every (tier x visibility x status) combination — a wrong branch leaks inventory between
-- competing brokerages.
-- =========================================================================================
CREATE FUNCTION can_view_listing(
  l_org_id     uuid,
  l_visibility listing_visibility,
  l_status     listing_status
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
  SELECT
    -- Platform admin (the host brokerage) moderates everything.
    is_platform_admin()
    -- Your own inventory, always, at any status.
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
    );
$fn$;

REVOKE ALL ON FUNCTION can_view_listing(uuid, listing_visibility, listing_status) FROM PUBLIC;

-- =========================================================================================
-- Policies
-- =========================================================================================
ALTER TABLE listing ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing FORCE  ROW LEVEL SECURITY;
CREATE POLICY listing_visibility_policy ON listing
  FOR SELECT USING (can_view_listing(organization_id, visibility, status));
-- Writes are always restricted to your own organisation, regardless of read tier.
CREATE POLICY listing_write_policy ON listing
  FOR ALL USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

ALTER TABLE lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead FORCE  ROW LEVEL SECURITY;
-- Leads are never shared across the network — they are the commercial asset.
CREATE POLICY lead_tenant_policy ON lead
  FOR ALL USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE  ROW LEVEL SECURITY;
CREATE POLICY app_user_tenant_policy ON app_user
  FOR ALL USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

ALTER TABLE partner_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_relationship FORCE  ROW LEVEL SECURITY;
-- Both sides of the relationship can see it; only the host can change it.
CREATE POLICY partner_read_policy ON partner_relationship
  FOR SELECT USING (
    host_org_id = current_org_id() OR partner_org_id = current_org_id() OR is_platform_admin()
  );
CREATE POLICY partner_write_policy ON partner_relationship
  FOR ALL USING (host_org_id = current_org_id() OR is_platform_admin())
  WITH CHECK (host_org_id = current_org_id() OR is_platform_admin());

-- NOTE: property, locality, city and project are intentionally NOT under RLS. They describe
-- physical and geographic reality shared by every tenant; only the OFFER (listing) is
-- tenant-scoped. Putting property behind RLS would break duplicate detection, which has to see
-- across organisations to do its job at all.
