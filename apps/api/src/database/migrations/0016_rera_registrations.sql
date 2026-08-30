-- 0016: RERA registrations per jurisdiction, and the host organisation flag
--
-- =========================================================================================
-- ⚠️ ONE ORGANISATION NEEDS MORE THAN ONE RERA REGISTRATION. The schema allowed exactly one.
-- =========================================================================================
--
-- `organization` carries `rera_registration_no` + `rera_jurisdiction` — a single pair. That is
-- wrong for this market, and not marginally:
--
--   Punjab RERA   covers Mohali, Kharar, Zirakpur, New Chandigarh
--   Chandigarh    is a Union Territory with its OWN, SEPARATE authority
--   Haryana RERA  covers Panchkula, if the agent works there
--
-- The tricity is three jurisdictions inside a 20km radius, and an agent working across it holds a
-- separate registration for each. A registered agent's number must appear in ALL advertising, a
-- website is advertising, and the penalty runs to ₹10 lakh — so showing the Punjab number on a
-- Chandigarh listing is not a cosmetic error, it is advertising that property without a valid
-- registration for the authority that governs it.
--
-- One row per (organisation, state), resolved per listing from the city the property is in.
--
-- The old single-pair columns on `organization` are left in place and unused rather than dropped:
-- dropping a column is the one migration that cannot be rolled back without data loss, and they
-- are harmless. `0017` can remove them once nothing reads them.

CREATE TABLE organization_rera (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  -- Matches the `state` field on `city` (from @tricity/geo) — that is the join that resolves a
  -- listing to the right authority, so it must be the same vocabulary, not a free-text label.
  state text NOT NULL,

  registration_no text NOT NULL,
  -- "Punjab Real Estate Regulatory Authority" — displayed alongside the number so a buyer can
  -- tell which regulator to check it against.
  authority_name  text NOT NULL,
  valid_until     date,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- An organisation has one registration per authority. A second row for the same state would
  -- make "which number do we advertise?" ambiguous, which is exactly the question that must
  -- never have two answers.
  CONSTRAINT organization_rera_unique UNIQUE (organization_id, state)
);

CREATE INDEX organization_rera_org_idx ON organization_rera (organization_id);

-- --- RLS ------------------------------------------------------------------------------------
-- ⚠️ READ IS INTENTIONALLY WORLD-OPEN, and that is not an oversight.
--
-- A RERA registration number is *mandated public disclosure*: the whole point is that it appears
-- on every advertisement so a buyer can verify it against the authority's register. Hiding it
-- behind tenant scoping would break the anonymous listing page — the one place it is legally
-- required to appear.
--
-- Writes are tenant-scoped as strictly as everything else: an organisation must never be able to
-- write a registration number attributed to a competitor.
ALTER TABLE organization_rera ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_rera FORCE  ROW LEVEL SECURITY;

CREATE POLICY organization_rera_read_policy ON organization_rera
  FOR SELECT USING (true);

CREATE POLICY organization_rera_write_policy ON organization_rera
  FOR ALL USING (organization_id = current_org_id() OR is_platform_admin())
  WITH CHECK (organization_id = current_org_id() OR is_platform_admin());

-- --- The host organisation ------------------------------------------------------------------
-- "Is this the agent's own listing?" drives richer presentation on the site and the sold-history
-- credibility page, so something has to say which of the organisations in the database is the one
-- whose website this is.
--
-- A column rather than an env var: it is a fact about the data, and an env var pointing at a slug
-- that does not exist fails silently as "nothing is ever an own listing", which looks like a
-- styling bug rather than a configuration one.
ALTER TABLE organization ADD COLUMN is_host boolean NOT NULL DEFAULT false;

-- At most one. A partial unique index over a constant is the standard way to express "only one
-- row may have this flag set" — without it, two hosts would make `isOwnListing` nondeterministic.
CREATE UNIQUE INDEX organization_single_host_idx ON organization ((true)) WHERE is_host;
