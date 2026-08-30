-- 0013: A least-privilege runtime role, because FORCE ROW LEVEL SECURITY was STILL a no-op
--
-- =========================================================================================
-- ⚠️⚠️ READ THIS BEFORE CHANGING ANY CONNECTION STRING.
-- =========================================================================================
--
-- Migration 0010 added `FORCE ROW LEVEL SECURITY` to remove the table-owner exemption. That was
-- necessary and it was not sufficient.
--
-- **A SUPERUSER BYPASSES ROW-LEVEL SECURITY UNCONDITIONALLY. So does any role with BYPASSRLS.
-- FORCE does not apply to them. There is no policy, no GRANT and no schema change that can stop
-- it — the check is skipped before policies are ever consulted.**
--
-- The `postgres`/`postgis` Docker image makes `POSTGRES_USER` a superuser, so the `tricity` role
-- that the API was connecting as had `rolsuper = t, rolbypassrls = t`. Every policy in 0010 was
-- doing exactly nothing: an organisation could read, update and delete every rival's inventory.
-- Caught by the first integration test that actually asserted the boundary — 11 failures, and the
-- schema was word-for-word what the design called for.
--
-- The fix cannot be a grant, because the problem is not a grant. It has to be a DIFFERENT ROLE:
--
--   tricity      (owner, superuser) -> migrations, seed, bootstrap. DDL only, never serves a request.
--   tricity_app  (this role)        -> what the API connects as. NOSUPERUSER, NOBYPASSRLS, no DDL.
--
-- Hence two connection strings: DATABASE_URL (owner) and APP_DATABASE_URL (runtime). They are not
-- interchangeable, and pointing APP_DATABASE_URL at the owner silently reopens the hole across
-- the whole schema. `assertRuntimeRoleCannotBypassRls()` refuses to boot if that happens — that
-- check is the real guard; this migration only makes a correct answer available.
--
-- Created NOLOGIN here on purpose. A migration must be safe to run anywhere and must not invent
-- credentials; the password is set out of band by `npm run db:app-role`, which flips LOGIN on.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tricity_app') THEN
    CREATE ROLE tricity_app
      NOLOGIN          -- enabled with a password by db:app-role
      NOSUPERUSER
      NOBYPASSRLS      -- the entire point of this file
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  ELSE
    -- Idempotent, and self-healing: if someone has granted this role SUPERUSER or BYPASSRLS in a
    -- live database, re-running migrations takes it back rather than leaving the hole open.
    ALTER ROLE tricity_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

-- --- Object privileges --------------------------------------------------------------------
--
-- DML only. No CREATE on the schema, so the runtime role cannot create a table, a function, or
-- — critically — a shadowing object in a schema that a SECURITY DEFINER function might resolve
-- through. That is the second half of the 0012 search_path defence: 0012 pins the path, this
-- removes the ability to plant anything on it.

GRANT USAGE ON SCHEMA public TO tricity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tricity_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO tricity_app;

-- The migration ledger is not application data. An app role that can rewrite it can hide the
-- fact that a migration was skipped, so it is read-only there and cannot forge history.
REVOKE ALL     ON TABLE schema_migration FROM tricity_app;
GRANT  SELECT  ON TABLE schema_migration TO   tricity_app;

-- These four were REVOKEd from PUBLIC in 0010/0011 (correctly — they are SECURITY DEFINER and
-- must not be callable by just anyone), which means the runtime role needs them granted back
-- explicitly. Without this the listing SELECT policy itself fails with a permission error, and
-- login cannot look a user up at all.
GRANT EXECUTE ON FUNCTION can_view_listing(uuid, listing_visibility, listing_status) TO tricity_app;
GRANT EXECUTE ON FUNCTION auth_lookup_staff(citext)                                  TO tricity_app;
GRANT EXECUTE ON FUNCTION auth_lookup_refresh_token(text)                            TO tricity_app;
GRANT EXECUTE ON FUNCTION auth_revoke_token_family(uuid)                             TO tricity_app;

-- ⚠️ `GRANT ON ALL TABLES` covers only tables that exist RIGHT NOW. Without this, every table
-- added by a future migration would be invisible to the API, and the symptom would be a
-- permission-denied error at runtime long after the migration "succeeded". Default privileges are
-- attached to the granting role, so this holds for anything `tricity` creates from here on.
ALTER DEFAULT PRIVILEGES FOR ROLE tricity IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tricity_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tricity IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tricity_app;

-- NOTE: deliberately NOT granted by default on FUNCTIONS. Postgres already gives PUBLIC EXECUTE
-- on new functions, and a blanket default grant here would quietly hand the runtime role every
-- future SECURITY DEFINER function — which is precisely the class of thing that must be granted
-- one at a time, on purpose, after someone has looked at what it does.
