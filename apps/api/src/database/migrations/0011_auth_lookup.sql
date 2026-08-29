-- 0011: Authentication lookup functions
--
-- WHY THIS FILE EXISTS
--
-- 0010 applies FORCE ROW LEVEL SECURITY to app_user, with a policy of
-- `organization_id = current_org_id()`. That is correct — but it creates a chicken-and-egg
-- problem at login: to read the user you need their organisation, and to know their organisation
-- you must first read the user.
--
-- The WRONG fixes, and why:
--   - Dropping RLS on app_user          → reopens the cross-tenant hole this all exists to close.
--   - Setting is_platform_admin at login → grants admin over every table for the whole
--                                          transaction, to an as-yet UNAUTHENTICATED caller.
--   - Connecting as a superuser to log in → same, but worse.
--
-- The right fix is a narrowly-scoped SECURITY DEFINER function that returns ONLY the columns
-- login needs, for ONE user, looked up by an exact credential. It is a deliberate keyhole through
-- RLS rather than an open door.
--
-- ⚠️ RULES FOR ANYTHING ADDED TO THIS FILE:
--   1. SECURITY DEFINER functions run as the owner and IGNORE row-level security. Treat every
--      one as security-critical code.
--   2. Always pin `search_path`. Without it a caller can prepend a schema and hijack an
--      unqualified name inside the function body — the classic SECURITY DEFINER privilege
--      escalation.
--   3. Return the minimum. Never `SELECT *` — an added column would silently start leaking.
--   4. Look up by exact equality on a unique column only. No LIKE, no filters that could match
--      more than one row.

-- =========================================================================================
-- Staff login lookup.
--
-- Returns the single row needed to verify a password and mint a token: the hash, the identity,
-- and enough status to decide whether login is permitted at all. Deliberately does NOT return
-- phone, last_login_at, or anything else the caller has no business seeing pre-authentication.
--
-- Returns zero rows for an unknown email, which the caller must treat identically to a bad
-- password — see the timing note in auth.service.ts.
-- =========================================================================================
CREATE FUNCTION auth_lookup_staff(p_email citext)
RETURNS TABLE (
  id              uuid,
  organization_id uuid,
  email           citext,
  password_hash   text,
  full_name       text,
  role            user_role,
  status          user_status,
  org_status      org_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT u.id,
         u.organization_id,
         u.email,
         u.password_hash,
         u.full_name,
         u.role,
         u.status,
         o.status AS org_status
  FROM app_user u
  JOIN organization o ON o.id = u.organization_id
  WHERE u.email = p_email;
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_staff(citext) FROM PUBLIC;

COMMENT ON FUNCTION auth_lookup_staff(citext) IS
  'SECURITY DEFINER keyhole through RLS for pre-authentication credential lookup. Returns only '
  'login-relevant columns for exactly one user. Do not widen.';

-- =========================================================================================
-- Refresh-token lookup.
--
-- Same chicken-and-egg problem: a refresh request arrives with a token and nothing else, so the
-- organisation is unknown until the token resolves.
--
-- Returns the whole rotation family's state for the presented token so the service can detect
-- reuse. `used_at`/`revoked_at` are returned rather than filtered on, because a token that has
-- ALREADY been used is not simply invalid — it is evidence of theft, and the correct response is
-- to revoke the entire family. Filtering those rows out here would destroy that signal.
--
-- ⚠️ HANDLES BOTH PRINCIPAL KINDS. refresh_token carries either a user_id (staff) or a
-- contact_id (consumer) — never both, enforced by a CHECK in 0003. The joins are LEFT joins
-- precisely so a consumer token is not silently dropped by an inner join against app_user, which
-- would present as "your session expired" for every buyer on the site with nothing in the logs.
--
-- `principal_kind` is returned so the caller never has to infer it from which column is null.
-- =========================================================================================
CREATE FUNCTION auth_lookup_refresh_token(p_token_hash text)
RETURNS TABLE (
  id              uuid,
  principal_kind  text,
  user_id         uuid,
  contact_id      uuid,
  family_id       uuid,
  organization_id uuid,
  expires_at      timestamptz,
  used_at         timestamptz,
  revoked_at      timestamptz,
  user_status     user_status,
  org_status      org_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT rt.id,
         CASE WHEN rt.user_id IS NOT NULL THEN 'staff' ELSE 'contact' END AS principal_kind,
         rt.user_id,
         rt.contact_id,
         rt.family_id,
         u.organization_id,
         rt.expires_at,
         rt.used_at,
         rt.revoked_at,
         u.status AS user_status,
         o.status AS org_status
  FROM refresh_token rt
  LEFT JOIN app_user u     ON u.id = rt.user_id
  LEFT JOIN organization o ON o.id = u.organization_id
  WHERE rt.token_hash = p_token_hash;
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_refresh_token(text) FROM PUBLIC;

-- =========================================================================================
-- Revoke an entire refresh-token family.
--
-- Called on reuse detection. SECURITY DEFINER for the same reason as above — at the moment we
-- detect a stolen token we may have no valid tenant context, and this must succeed regardless.
--
-- Idempotent: already-revoked rows keep their original revoked_at, so the audit trail records
-- when the compromise was first detected rather than the last time anything touched it.
-- =========================================================================================
CREATE FUNCTION auth_revoke_token_family(p_family_id uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  WITH revoked AS (
    UPDATE refresh_token
       SET revoked_at = now()
     WHERE family_id = p_family_id
       AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM revoked;
$fn$;

REVOKE ALL ON FUNCTION auth_revoke_token_family(uuid) FROM PUBLIC;
