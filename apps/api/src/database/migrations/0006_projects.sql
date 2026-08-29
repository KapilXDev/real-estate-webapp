-- 0006: Builder / developer inventory
--
-- New construction is a large share of the Mohali / Kharar / Zirakpur market, so builder
-- inventory is a first-class source rather than a special case of `listing`. Units differ from
-- resale listings: they are fungible within a type, availability flips frequently, and pricing
-- is set per unit-type rather than per unit.

CREATE TABLE project (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_organization_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  locality_id             uuid NOT NULL REFERENCES locality(id) ON DELETE RESTRICT,

  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  -- Only RERA-registered projects may legally be advertised. Absence of a number should block
  -- publication; enforced in the service layer so the reason can be explained to the user.
  rera_project_no text,
  status          text NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
  possession_date date,

  location  geography(POINT, 4326) NOT NULL,
  amenities jsonb NOT NULL DEFAULT '[]'::jsonb,

  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_location_idx ON project USING GIST (location);
CREATE INDEX project_locality_idx ON project (locality_id, status);

CREATE TABLE project_unit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,

  tower         text,
  unit_number   text,
  floor_number  smallint,
  property_type property_type NOT NULL,
  bedrooms      smallint,

  area_sqft              numeric(12,2) NOT NULL,
  area_input_value       numeric(12,2),
  area_input_unit        area_unit,
  area_conversion_factor numeric(10,4),

  price        numeric(16,2),
  is_available boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_unit_area_positive CHECK (area_sqft > 0)
);
CREATE INDEX project_unit_avail_idx ON project_unit (project_id, is_available);
