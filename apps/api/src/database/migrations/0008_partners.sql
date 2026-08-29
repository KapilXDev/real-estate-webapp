-- 0008: Partner network with tiered visibility
--
-- Visibility is a RELATIONSHIP between two organisations, not a property of a listing alone.
-- The host organisation grants each partner a tier, so a trusted co-broke partner can see
-- inventory that a newly-joined partner cannot.

CREATE TABLE partner_relationship (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_org_id        uuid           NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  partner_org_id     uuid           NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  tier               partner_tier   NOT NULL DEFAULT 'PUBLIC_PLUS_OWN',
  status             partner_status NOT NULL DEFAULT 'PENDING',
  invited_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  granted_at         timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (host_org_id, partner_org_id),
  CONSTRAINT partner_not_self CHECK (host_org_id <> partner_org_id)
);
-- The RLS policy function hits this on every row read, so the lookup must be indexed.
CREATE INDEX partner_active_idx ON partner_relationship (partner_org_id, status)
  WHERE status = 'ACTIVE';
