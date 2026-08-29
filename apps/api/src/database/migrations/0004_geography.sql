-- 0004: Geography — cities and localities (sectors / phases / enclaves)

CREATE TABLE city (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  state      text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  centroid   geography(POINT, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locality (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id   uuid          NOT NULL REFERENCES city(id) ON DELETE RESTRICT,
  -- Self-reference: Mohali Phase 3B2 nests under Phase 3.
  parent_id uuid          REFERENCES locality(id) ON DELETE SET NULL,
  name      text          NOT NULL,     -- 'Sector 17', 'Phase 3B2', 'Sunny Enclave'
  kind      locality_kind NOT NULL,
  slug      text          NOT NULL,

  boundary  geography(POLYGON, 4326),
  centroid  geography(POINT, 4326) NOT NULL,

  -- Honesty flags. Initial boundaries are generated as circles around a centroid because
  -- accurate polygons for ~120 tricity localities are not derivable without a real source.
  -- Draw-search accuracy depends on these, so the provenance is tracked explicitly rather
  -- than silently pretending the shapes are surveyed.
  is_approximate  boolean NOT NULL DEFAULT true,
  boundary_source text    NOT NULL DEFAULT 'GENERATED_RADIUS',  -- | 'OSM' | 'SURVEYED'
  radius_m        integer,

  -- Editorial content. This is the SEO surface: ~72% of buyer searches name a specific
  -- locality, and the portals rank poorly for those.
  tagline    text,
  intro      text,
  lifestyle  text,
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  faqs       jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (city_id, slug)
);

-- GiST indexes are what make "listings inside this drawn polygon" fast at any catalog size.
CREATE INDEX locality_boundary_idx ON locality USING GIST (boundary);
CREATE INDEX locality_centroid_idx ON locality USING GIST (centroid);
CREATE INDEX locality_city_idx     ON locality (city_id, kind);

COMMENT ON COLUMN locality.is_approximate IS
  'true while the boundary is a generated circle; set false once replaced with OSM/surveyed data';
