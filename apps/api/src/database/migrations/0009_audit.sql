-- 0009: Audit log
--
-- Requested as part of "enterprise level". Append-only by convention: nothing in the
-- application updates or deletes from this table.

CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid,
  actor_user_id   uuid,
  action          text NOT NULL,   -- 'listing.published', 'user.role_changed', ...
  entity_type     text NOT NULL,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time_idx ON audit_log (organization_id, occurred_at DESC);
CREATE INDEX audit_entity_idx   ON audit_log (entity_type, entity_id);

-- Deliberately NO foreign keys on organization_id / actor_user_id: an audit trail must survive
-- deletion of the actor it describes. Referential integrity here would let a DELETE erase the
-- very evidence the log exists to preserve.
