-- 0015: Columns the catalog API needs that the schema never had
--
-- Found by writing the mapper from `listing`/`property` rows to the wire contract the website
-- already consumes: several fields the UI treats as core have nowhere to come from. Adding them
-- now, before any real inventory exists, rather than discovering it during data entry.

-- --- Possession -----------------------------------------------------------------------------
-- ⚠️ THE MOST-USED FILTER IN THIS MARKET, ahead of price band, and it was missing entirely.
-- Ready-to-move vs under-construction changes financing, risk and RERA exposure, and buyers
-- self-select on it before anything else. It belongs on the LISTING rather than the property:
-- the same physical flat is under-construction in 2026 and ready-to-move in 2028, and a listing
-- is an offer made at a point in time.
CREATE TYPE possession_status AS ENUM ('READY_TO_MOVE', 'UNDER_CONSTRUCTION', 'NEW_LAUNCH');

ALTER TABLE listing
  ADD COLUMN possession      possession_status NOT NULL DEFAULT 'READY_TO_MOVE',
  ADD COLUMN possession_date date;

-- Only unbuilt stock has a handover date; a ready-to-move listing carrying one is a data-entry
-- error that would render as a contradiction on the page.
ALTER TABLE listing ADD CONSTRAINT listing_possession_date_only_when_unbuilt CHECK (
  possession_date IS NULL OR possession <> 'READY_TO_MOVE'
);

CREATE INDEX listing_possession_idx ON listing (possession, transaction_type)
  WHERE status = 'ACTIVE';

-- --- Human-facing reference code ------------------------------------------------------------
-- Buyers and agents quote a code on the phone; a uuid is unusable for that. Issued by a sequence
-- with a DB-level DEFAULT rather than generated in the application, so it cannot collide under
-- concurrent inserts and cannot be forgotten by a future write path.
--
-- ⚠️ NOT an MLS number — there is no MLS in India. The prefix makes it obviously ours rather than
-- something a buyer might mistake for an industry-wide identifier.
CREATE SEQUENCE listing_reference_seq START 1000;

ALTER TABLE listing
  ADD COLUMN reference_code text NOT NULL
    DEFAULT ('TE-' || lpad(nextval('listing_reference_seq')::text, 6, '0'));

ALTER TABLE listing ADD CONSTRAINT listing_reference_code_key UNIQUE (reference_code);

-- --- Price presentation and close -----------------------------------------------------------
-- "Price on request" is common for premium stock here. Modelled as a flag rather than a NULL
-- price so the asking figure is still stored, still sortable internally, and merely withheld from
-- public display — a NULL would lose it permanently and drop the listing out of every price sort.
ALTER TABLE listing
  ADD COLUMN price_on_request boolean       NOT NULL DEFAULT false,
  ADD COLUMN close_price      numeric(16,2),
  ADD COLUMN closed_at        timestamptz;

-- Sold history is the core credibility proof on an agent site, so the closing figures have to be
-- consistent with the status or the page contradicts itself.
ALTER TABLE listing ADD CONSTRAINT listing_close_only_when_closed CHECK (
  (close_price IS NULL AND closed_at IS NULL)
  OR status IN ('SOLD', 'RENTED')
);
ALTER TABLE listing ADD CONSTRAINT listing_close_price_positive CHECK (
  close_price IS NULL OR close_price > 0
);

-- --- Property gaps --------------------------------------------------------------------------
ALTER TABLE property
  ADD COLUMN pincode    text,
  -- Society/project this unit belongs to. Gives the UI a project name and, more importantly, the
  -- project's OWN RERA registration — separately required in advertising for registered projects
  -- and distinct from the agent's.
  ADD COLUMN project_id uuid REFERENCES project(id) ON DELETE SET NULL;

CREATE INDEX property_project_idx ON property (project_id) WHERE project_id IS NOT NULL;

-- ⚠️ WHICH area the seller actually typed.
--
-- `area_input_value/unit/conversion_factor` capture the figure as entered — "10 marla" — but
-- nothing recorded WHICH of plot / built-up / carpet it referred to. Without that the UI cannot
-- know whether to echo "10 marla" next to the plot area or the built-up area, and echoing it
-- against the wrong one misstates the property.
--
-- One discriminator column rather than three parallel sets of input columns: a seller types ONE
-- area in their unit of choice. Every other area is displayed in canonical sq ft.
CREATE TYPE area_basis AS ENUM ('PLOT', 'BUILT_UP', 'CARPET');

ALTER TABLE property ADD COLUMN area_input_basis area_basis;

-- The three input columns and the basis are meaningful only together — a value with no unit, or
-- a unit with no basis, is unusable data that would surface as a wrong number on a page.
ALTER TABLE property ADD CONSTRAINT property_area_input_complete CHECK (
  (area_input_value IS NULL AND area_input_unit IS NULL
   AND area_conversion_factor IS NULL AND area_input_basis IS NULL)
  OR
  (area_input_value IS NOT NULL AND area_input_unit IS NOT NULL
   AND area_conversion_factor IS NOT NULL AND area_input_basis IS NOT NULL)
);

-- --- Leads ----------------------------------------------------------------------------------
-- `channel` already records HOW a lead arrived (web/whatsapp/call). It does not record WHAT the
-- person wanted, and those need very different follow-up: a tour request is the highest-intent
-- event on the site, a valuation request is the highest-value, and a saved-search signup is
-- neither but is the best long-term nurture list. Routing them identically wastes the difference.
CREATE TYPE lead_kind AS ENUM ('TOUR_REQUEST', 'HOME_VALUATION', 'CONTACT', 'SAVED_SEARCH');

ALTER TABLE lead ADD COLUMN kind lead_kind NOT NULL DEFAULT 'CONTACT';

-- The follow-up queue is worked kind-first (tours before newsletter signups), then by score.
CREATE INDEX lead_kind_queue_idx ON lead (organization_id, kind, status, score DESC);
