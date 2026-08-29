-- 0007: Leads, activity timeline, and saved searches

CREATE TABLE lead (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,  -- tenant key
  assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contact(id)  ON DELETE SET NULL,

  -- What the enquiry was about. Both nullable: a general enquiry references neither.
  listing_id uuid REFERENCES listing(id) ON DELETE SET NULL,
  project_id uuid REFERENCES project(id) ON DELETE SET NULL,

  channel lead_channel NOT NULL DEFAULT 'WEB',
  status  lead_status  NOT NULL DEFAULT 'NEW',

  -- 0-100 priority. A solo agent cannot treat every lead identically and "whatever is top of
  -- the inbox" is a bad rule, so the ranking is explicit and tunable.
  score smallint NOT NULL DEFAULT 0,

  message     text,
  requirement jsonb,   -- budget, preferred localities, property types
  source      jsonb,   -- utm params, referrer, landing page — so spend can be attributed

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_score_range CHECK (score >= 0 AND score <= 100)
);
-- The agent's work queue: highest-scoring new leads first.
CREATE INDEX lead_queue_idx    ON lead (organization_id, status, score DESC);
CREATE INDEX lead_assigned_idx ON lead (assigned_user_id, status);
CREATE INDEX lead_listing_idx  ON lead (listing_id) WHERE listing_id IS NOT NULL;

CREATE TABLE lead_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  type          text NOT NULL,   -- NOTE|CALL|WHATSAPP|EMAIL|VIEWING|STATUS_CHANGE
  body          text,
  metadata      jsonb,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activity_idx ON lead_activity (lead_id, occurred_at DESC);

-- Saved searches: the best recurring touchpoint against the portals, and the reason a buyer
-- hands over contact details willingly.
CREATE TABLE saved_search (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  name       text,
  -- Serialized query including any drawn polygon. jsonb so the filter set can evolve without
  -- a migration; the shape is validated by the contracts package before it is written.
  criteria   jsonb NOT NULL,
  frequency  text NOT NULL DEFAULT 'INSTANT',   -- INSTANT|DAILY|WEEKLY
  channel    text NOT NULL DEFAULT 'WHATSAPP',  -- WhatsApp beats email in this market
  last_notified_at timestamptz,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_search_active_idx ON saved_search (contact_id) WHERE is_active;
