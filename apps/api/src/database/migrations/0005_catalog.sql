-- 0005: Catalog — properties and listings
--
-- property = the physical asset. listing = an offer to transact on it.
-- The split exists because partner brokers post their own inventory: two brokers listing the
-- same kothi in Mohali Phase 7 must produce ONE property with TWO listings, not a duplicated
-- search result. It also preserves history across a sale -> rent -> resale lifecycle.

CREATE TABLE property (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locality_id   uuid          NOT NULL REFERENCES locality(id) ON DELETE RESTRICT,
  property_type property_type NOT NULL,

  address_line text,
  plot_number  text,           -- house/plot no; a key signal for duplicate detection
  location     geography(POINT, 4326) NOT NULL,

  -- Areas. Canonical sq ft is what search and sort use.
  plot_area_sqft     numeric(12,2),
  built_up_area_sqft numeric(12,2),
  carpet_area_sqft   numeric(12,2),

  -- ...and the value as the user actually entered it. A seller who typed "10 marla" must
  -- never be shown "2722.5 sq ft" echoed back. The conversion factor is stored PER ROW so a
  -- future correction to the marla constant cannot silently rewrite historical data
  -- (marla is regionally ambiguous: Punjab uses 272.25 sq ft, elsewhere 225 sq ft).
  area_input_value       numeric(12,2),
  area_input_unit        area_unit,
  area_conversion_factor numeric(10,4),

  bedrooms      smallint,
  bathrooms     smallint,
  balconies     smallint,
  total_floors  smallint,
  floor_number  smallint,
  facing        facing,
  road_width_ft smallint,      -- a major valuation driver for plots here
  year_built    smallint,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT property_areas_positive CHECK (
    (plot_area_sqft     IS NULL OR plot_area_sqft     > 0) AND
    (built_up_area_sqft IS NULL OR built_up_area_sqft > 0) AND
    (carpet_area_sqft   IS NULL OR carpet_area_sqft   > 0)
  ),
  -- Carpet area is always inside built-up area. Catching this at write time prevents
  -- nonsense reaching search results.
  CONSTRAINT property_carpet_within_builtup CHECK (
    carpet_area_sqft IS NULL OR built_up_area_sqft IS NULL
    OR carpet_area_sqft <= built_up_area_sqft
  ),
  CONSTRAINT property_floor_sane CHECK (
    floor_number IS NULL OR total_floors IS NULL OR floor_number <= total_floors
  )
);
CREATE INDEX property_location_idx ON property USING GIST (location);
CREATE INDEX property_locality_idx ON property (locality_id, property_type);
CREATE INDEX property_dedupe_idx   ON property (locality_id, plot_number)
  WHERE plot_number IS NOT NULL;

CREATE TABLE listing (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,  -- tenant key
  property_id       uuid NOT NULL REFERENCES property(id)     ON DELETE RESTRICT,
  listed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,

  transaction_type transaction_type   NOT NULL,
  status           listing_status     NOT NULL DEFAULT 'DRAFT',
  source           listing_source     NOT NULL DEFAULT 'OWN',
  visibility       listing_visibility NOT NULL DEFAULT 'PUBLIC',

  -- INR rupees. NEVER store a formatted string, and never store 85 meaning 85 lakh.
  -- Lakh/crore rendering is a presentation concern only (packages/domain/src/money.ts).
  price               numeric(16,2) NOT NULL,
  price_negotiable    boolean       NOT NULL DEFAULT true,
  maintenance_monthly numeric(12,2),
  booking_amount      numeric(16,2),
  furnishing          furnishing,

  title       text,
  description text,
  features    jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Partner moderation workflow
  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  rejection_reason    text,

  published_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT listing_price_positive CHECK (price > 0),
  -- An ACTIVE listing without a publish timestamp is a bug; forbid it at the schema level.
  CONSTRAINT listing_active_has_published_at CHECK (
    status <> 'ACTIVE' OR published_at IS NOT NULL
  )
);
CREATE INDEX listing_org_status_idx ON listing (organization_id, status);
CREATE INDEX listing_browse_idx     ON listing (transaction_type, price)
  WHERE status = 'ACTIVE';
CREATE INDEX listing_property_idx   ON listing (property_id);

-- Full-text search. A generated column keeps the vector in sync automatically — no trigger to
-- forget, no chance of the index drifting from the row.
ALTER TABLE listing ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;
CREATE INDEX listing_search_idx ON listing USING GIN (search_vector);

CREATE TABLE listing_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid     NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  storage_key       text     NOT NULL,     -- S3/MinIO object key
  kind              text     NOT NULL DEFAULT 'PHOTO',  -- PHOTO|FLOOR_PLAN|VIDEO|DOCUMENT
  sort_order        smallint NOT NULL DEFAULT 0,
  caption           text,
  width             integer,
  height            integer,
  -- Written by media-service once processing completes. PENDING rows render a placeholder
  -- rather than a broken image.
  processing_status text     NOT NULL DEFAULT 'PENDING',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_media_listing_idx ON listing_media (listing_id, sort_order);

-- Price history. "Reduced by Rs 5L last week" is a strong buyer signal and cannot be
-- reconstructed after the fact, so it is captured as it happens.
CREATE TABLE listing_price_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid          NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  price              numeric(16,2) NOT NULL,
  changed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  changed_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX listing_price_history_idx ON listing_price_history (listing_id, changed_at DESC);
