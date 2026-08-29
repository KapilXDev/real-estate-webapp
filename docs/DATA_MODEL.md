# Data Model

> Status: **proposed, awaiting approval.** No migrations written yet.
> DDL below is design-level — indexes and constraints shown where they carry a decision.

## Three decisions that shape everything

### 1. `property` is separate from `listing`

A **property** is a physical asset. A **listing** is an offer to transact on it.

This split costs a join but earns its place immediately, because partner brokers post their own
inventory:

- Two brokers listing the same kothi in Mohali Phase 7 → **one property, two listings.**
  Without the split you get duplicates in search results, which is the fastest way to look
  unprofessional in a market where inventory overlap is the norm.
- Same house sold in 2024, re-listed for rent in 2026 → one property, price history preserved.
- Duplicate detection becomes a tractable problem (match on geo + address + area) rather than
  an impossible one.

### 2. Area is stored twice, deliberately

Punjab uses **marla** and **kanal**; buyers also say **gaj** (sq yd). These do not divide cleanly
into square feet, so round-tripping through a single canonical column loses fidelity — a seller
who typed "10 marla" must never see "2722.5 sq ft" echoed back.

```
area_sqft          numeric(12,2)   -- canonical, ALWAYS populated, used for search/sort
area_input_value   numeric(12,2)   -- what the user actually typed
area_input_unit    area_unit       -- what unit they typed it in
```

Display uses `input_value + input_unit`. Search and comparison use `area_sqft`.

> ⚠️ **Marla is regionally ambiguous.** Punjab/Haryana standard is 1 marla = 272.25 sq ft
> (30.25 sq yd), 1 kanal = 20 marla = 5,445 sq ft. Some regions use a 25 sq yd marla. We use the
> Punjab standard and store the conversion factor used on each row, so a future correction does
> not silently rewrite historical data.

### 3. Money is `numeric`, formatted at the edge

`numeric(16,2)` INR. Not paise-as-bigint — exact decimal arithmetic matters more here than the
micro-optimisation, and property prices are never sub-rupee.

Lakh/crore formatting (`₹85 Lakh`, `₹1.25 Cr`) is **presentation only**. Never store a formatted
string; never store "85" meaning lakhs. Search range buckets are built in the query layer.

---

## Enums

```sql
CREATE TYPE org_type          AS ENUM ('BROKERAGE','PARTNER','BUILDER');
CREATE TYPE org_status        AS ENUM ('PENDING','ACTIVE','SUSPENDED');
CREATE TYPE user_role         AS ENUM ('OWNER','ADMIN','AGENT','STAFF');
CREATE TYPE user_status       AS ENUM ('INVITED','ACTIVE','DISABLED');

CREATE TYPE locality_kind     AS ENUM ('SECTOR','PHASE','ENCLAVE','COLONY','VILLAGE','ROAD_BELT');

-- Indian property taxonomy. NOT the US one.
CREATE TYPE property_type     AS ENUM (
  'PLOT','KOTHI','BUILDER_FLOOR','FLAT','SCO','SCF','BOOTH','SHOWROOM','FARMHOUSE','INDUSTRIAL'
);
CREATE TYPE transaction_type  AS ENUM ('SALE','RENT','LEASE');
CREATE TYPE furnishing        AS ENUM ('UNFURNISHED','SEMI_FURNISHED','FURNISHED');
CREATE TYPE facing            AS ENUM ('NORTH','SOUTH','EAST','WEST','NE','NW','SE','SW');

CREATE TYPE area_unit         AS ENUM ('SQ_FT','SQ_YD','MARLA','KANAL','ACRE','BIGHA','SQ_M');

CREATE TYPE listing_status    AS ENUM (
  'DRAFT','PENDING_REVIEW','ACTIVE','UNDER_OFFER','SOLD','RENTED','WITHDRAWN','REJECTED','EXPIRED'
);
CREATE TYPE listing_source    AS ENUM ('OWN','PARTNER','BUILDER','IMPORT');
CREATE TYPE listing_visibility AS ENUM ('PUBLIC','NETWORK_ONLY','PRIVATE');

CREATE TYPE lead_channel      AS ENUM ('WEB','WHATSAPP','CALL','WALK_IN','REFERRAL');
CREATE TYPE lead_status       AS ENUM ('NEW','CONTACTED','QUALIFIED','VIEWING','NEGOTIATING','WON','LOST');
```

---

## Identity & tenancy

```sql
CREATE TABLE organization (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  type                org_type    NOT NULL,
  status              org_status  NOT NULL DEFAULT 'PENDING',

  -- RERA: mandatory in advertising, and the agent spans TWO jurisdictions
  -- (Punjab RERA for Mohali/Kharar, Chandigarh RERA for Chandigarh).
  rera_registration_no text,
  rera_jurisdiction    text,          -- 'PUNJAB' | 'CHANDIGARH' | 'HARYANA'
  rera_valid_until     date,          -- registration is valid 5 years

  phone, email, address_line, logo_key  text,
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  email            citext NOT NULL,
  phone            text,
  password_hash    text NOT NULL,          -- Argon2id
  full_name        text NOT NULL,
  role             user_role NOT NULL DEFAULT 'AGENT',
  status           user_status NOT NULL DEFAULT 'INVITED',
  last_login_at    timestamptz,
  created_at, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

-- Rotating refresh tokens with reuse detection.
-- family_id groups a rotation chain; replaying a used token revokes the whole family.
CREATE TABLE refresh_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL,             -- SHA-256; never store the raw token
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  revoked_at   timestamptz,
  user_agent, ip inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_token (user_id, family_id);
```

**Consumers are NOT `app_user`.** Buyers who save searches are `contact` rows — they belong to no
organization, and mixing them into the staff table makes every RLS policy harder to reason about.

### Consumer identity linking (ADR-003)

Buyers authenticate "like FB/Insta" — one identity, several credentials. Credentials are **rows,
not columns**, so adding Google/Facebook later is zero schema change.

```sql
CREATE TYPE identity_provider AS ENUM ('PHONE_OTP','PASSWORD','GOOGLE','FACEBOOK');

-- The person.
CREATE TABLE contact (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text,
  primary_phone   text,          -- phone is the primary identifier in India
  primary_email   citext,
  phone_verified_at, email_verified_at timestamptz,
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON contact (primary_phone) WHERE primary_phone IS NOT NULL;
CREATE UNIQUE INDEX ON contact (primary_email) WHERE primary_email IS NOT NULL;

-- How they prove who they are. One row per credential.
CREATE TABLE contact_identity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  provider      identity_provider NOT NULL,
  provider_uid  text NOT NULL,        -- phone number, email, or OAuth subject
  secret_hash   text,                 -- Argon2id for PASSWORD; NULL for OTP/OAuth
  verified_at   timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX ON contact_identity (contact_id);

-- Short-lived OTP challenges. Hashed, attempt-limited, single-use.
CREATE TABLE otp_challenge (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination  text NOT NULL,         -- phone or email
  code_hash    text NOT NULL,         -- never store the raw code
  purpose      text NOT NULL,         -- 'LOGIN' | 'VERIFY' | 'RESET'
  attempts     smallint NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,  -- ~5 minutes
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_challenge (destination, purpose) WHERE consumed_at IS NULL;
```

> ⚠️ **Account-linking rule.** Link a new identity to an existing contact ONLY when the presented
> email/phone is **verified on both sides**. Auto-linking on an unverified claim is a textbook
> account-takeover vector. Otherwise create a separate contact and let the user link manually
> while already authenticated.

Rate limiting on `otp_challenge` is mandatory — OTP endpoints are the most abused surface on any
Indian consumer app, and SMS-pumping fraud costs real money per message.

### Row-Level Security

Partner brokers are competing businesses sharing one database. A missed `WHERE organization_id`
is a cross-tenant leak, so app-layer scoping is backed by RLS:

```sql
ALTER TABLE listing ENABLE ROW LEVEL SECURITY;

CREATE POLICY listing_tenant_isolation ON listing
  USING (
    organization_id = current_setting('app.current_org_id')::uuid
    OR (visibility = 'PUBLIC' AND status = 'ACTIVE')          -- public catalog is readable
    OR current_setting('app.is_platform_admin', true) = 'true' -- owner org moderates everything
  );
```

Every request sets `SET LOCAL app.current_org_id = ...` inside the transaction. This is enforced
in a single Drizzle transaction wrapper so it cannot be forgotten per-query.

---

## Geography

The unit here is the **sector / phase**, not the American "neighborhood".

```sql
CREATE TABLE city (
  id uuid PRIMARY KEY, name text NOT NULL, state text NOT NULL, slug text UNIQUE NOT NULL
);
-- Seed: Chandigarh (UT), Mohali, Kharar, Zirakpur, Panchkula, New Chandigarh (Mullanpur)

CREATE TABLE locality (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id      uuid NOT NULL REFERENCES city(id),
  parent_id    uuid REFERENCES locality(id),      -- Phase 3B2 nests under Phase 3
  name         text NOT NULL,                     -- 'Sector 17', 'Phase 3B2', 'Sunny Enclave'
  kind         locality_kind NOT NULL,
  slug         text NOT NULL,

  boundary     geography(POLYGON, 4326),          -- for "listings in this sector"
  centroid     geography(POINT, 4326) NOT NULL,

  -- Editorial content — the SEO surface. Carried over from the Phase 1 design.
  tagline, intro, lifestyle  text,
  highlights   jsonb,
  faqs         jsonb,

  UNIQUE (city_id, slug)
);
CREATE INDEX ON locality USING GIST (boundary);
CREATE INDEX ON locality USING GIST (centroid);
```

---

## Catalog

```sql
CREATE TABLE property (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locality_id    uuid NOT NULL REFERENCES locality(id),

  property_type  property_type NOT NULL,
  address_line   text,
  plot_number    text,                      -- house/plot no. — key for duplicate detection
  location       geography(POINT, 4326) NOT NULL,

  -- Areas. Canonical sqft + as-entered pair (see decision 3 above).
  plot_area_sqft, built_up_area_sqft, carpet_area_sqft   numeric(12,2),
  area_input_value  numeric(12,2),
  area_input_unit   area_unit,
  area_conversion_factor numeric(10,4),      -- factor used, so historic rows stay correct

  bedrooms, bathrooms, balconies, total_floors, floor_number  smallint,
  facing         facing,
  road_width_ft  smallint,                   -- matters a lot for plot valuation here
  year_built     smallint,

  -- Duplicate detection: same point (~20m) + same plot number + same type.
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON property USING GIST (location);
CREATE INDEX ON property (locality_id, property_type);

CREATE TABLE listing (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id),   -- tenant key
  property_id      uuid NOT NULL REFERENCES property(id),
  listed_by_user_id uuid REFERENCES app_user(id),

  transaction_type transaction_type NOT NULL,
  status           listing_status   NOT NULL DEFAULT 'DRAFT',
  source           listing_source   NOT NULL DEFAULT 'OWN',
  visibility       listing_visibility NOT NULL DEFAULT 'PUBLIC',

  price            numeric(16,2) NOT NULL,     -- INR. Format to lakh/crore at the edge only.
  price_negotiable boolean NOT NULL DEFAULT true,
  maintenance_monthly numeric(12,2),
  booking_amount   numeric(16,2),
  furnishing       furnishing,

  title, description text,
  features         jsonb NOT NULL DEFAULT '[]',

  -- Partner moderation workflow
  reviewed_by_user_id uuid REFERENCES app_user(id),
  reviewed_at      timestamptz,
  rejection_reason text,

  published_at, expires_at, created_at, updated_at timestamptz,

  search_vector    tsvector GENERATED ALWAYS AS (...) STORED
);
CREATE INDEX ON listing (organization_id, status);
CREATE INDEX ON listing (status, transaction_type, price) WHERE status = 'ACTIVE';
CREATE INDEX ON listing USING GIN (search_vector);

CREATE TABLE listing_media (
  id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  storage_key text NOT NULL,          -- MinIO/S3 object key
  kind text NOT NULL,                 -- 'PHOTO' | 'FLOOR_PLAN' | 'VIDEO' | 'DOCUMENT'
  sort_order smallint NOT NULL DEFAULT 0,
  caption text, width, height int,
  processing_status text NOT NULL DEFAULT 'PENDING'   -- set by media-service
);

-- Price history matters: "reduced ₹5L last week" is a strong buyer signal.
CREATE TABLE listing_price_history (
  id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  price numeric(16,2) NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by_user_id uuid REFERENCES app_user(id)
);
```

### The polygon search (the reason PostGIS is here)

```sql
SELECT l.* FROM listing l
JOIN property p ON p.id = l.property_id
WHERE l.status = 'ACTIVE'
  AND ST_Intersects(
        p.location,
        ST_GeomFromGeoJSON($1)::geography      -- the user-drawn polygon
      );
```

Replaces the in-memory ray-casting from Phase 1, and stays fast with a GiST index at any catalog
size.

---

## Builder / developer inventory

```sql
CREATE TABLE project (
  id uuid PRIMARY KEY,
  builder_organization_id uuid REFERENCES organization(id),
  locality_id uuid NOT NULL REFERENCES locality(id),
  name text NOT NULL,
  rera_project_no text,                    -- RERA-registered projects only
  status text NOT NULL,                    -- 'PRE_LAUNCH'|'UNDER_CONSTRUCTION'|'READY'|'COMPLETED'
  possession_date date,
  location geography(POINT,4326) NOT NULL,
  amenities jsonb, description text
);

CREATE TABLE project_unit (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tower text, unit_number text, floor_number smallint,
  property_type property_type NOT NULL,
  bedrooms smallint,
  area_sqft numeric(12,2) NOT NULL,
  area_input_value numeric(12,2), area_input_unit area_unit,
  price numeric(16,2),
  is_available boolean NOT NULL DEFAULT true
);
```

---

## Leads & saved searches

```sql
CREATE TABLE lead (
  id uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  assigned_user_id uuid REFERENCES app_user(id),
  contact_id       uuid REFERENCES contact(id),

  listing_id uuid REFERENCES listing(id),
  project_id uuid REFERENCES project(id),

  channel  lead_channel NOT NULL DEFAULT 'WEB',
  status   lead_status  NOT NULL DEFAULT 'NEW',
  score    smallint NOT NULL DEFAULT 0,      -- 0-100, logic ported from Phase 1

  message text,
  requirement jsonb,                          -- budget, preferred localities, type
  source jsonb,                               -- utm, referrer, landing page

  created_at, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON lead (organization_id, status, score DESC);

CREATE TABLE lead_activity (
  id uuid PRIMARY KEY, lead_id uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  type text NOT NULL,                         -- 'NOTE'|'CALL'|'WHATSAPP'|'VIEWING'|'STATUS_CHANGE'
  body text, metadata jsonb,
  actor_user_id uuid REFERENCES app_user(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_search (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  name text,
  criteria jsonb NOT NULL,                    -- serialized ListingQuery incl. polygon
  frequency text NOT NULL DEFAULT 'INSTANT',  -- 'INSTANT'|'DAILY'|'WEEKLY'
  channel text NOT NULL DEFAULT 'WHATSAPP',   -- WhatsApp beats email in this market
  last_notified_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);
```

---

## Partner network & tiered visibility

Tiered visibility, controlled per partner, was the chosen model. Visibility is therefore a
*relationship between two organizations*, not a property of a listing alone.

```sql
CREATE TYPE partner_tier AS ENUM (
  'OWN_ONLY',        -- sees only their own listings
  'PUBLIC_PLUS_OWN', -- own + anything already public
  'NETWORK',         -- own + public + NETWORK_ONLY inventory across the network
  'FULL'             -- everything including PRIVATE (trusted co-broke partners)
);

CREATE TABLE partner_relationship (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_org_id        uuid NOT NULL REFERENCES organization(id),   -- the platform owner
  partner_org_id     uuid NOT NULL REFERENCES organization(id),
  tier               partner_tier NOT NULL DEFAULT 'PUBLIC_PLUS_OWN',
  status             text NOT NULL DEFAULT 'PENDING',  -- PENDING|ACTIVE|SUSPENDED|REVOKED
  invited_by_user_id uuid REFERENCES app_user(id),
  granted_at, revoked_at, created_at, updated_at timestamptz,
  UNIQUE (host_org_id, partner_org_id)
);
```

### RLS with tiers

An inline tier lookup makes the policy expression unreadable and slow, so it lives in a
`SECURITY DEFINER` function:

```sql
CREATE FUNCTION can_view_listing(l_org_id uuid,
                                 l_visibility listing_visibility,
                                 l_status listing_status)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $fn$
  SELECT
    -- Always: your own inventory
    l_org_id = current_setting('app.current_org_id')::uuid
    -- Public active catalog is world-readable
    OR (l_visibility = 'PUBLIC' AND l_status = 'ACTIVE')
    -- Otherwise consult the tier granted to the viewing org
    OR EXISTS (
      SELECT 1 FROM partner_relationship pr
      WHERE pr.partner_org_id = current_setting('app.current_org_id')::uuid
        AND pr.status = 'ACTIVE'
        AND (
          (pr.tier = 'NETWORK' AND l_visibility IN ('PUBLIC','NETWORK_ONLY'))
          OR pr.tier = 'FULL'
        )
    );
$fn$;

CREATE POLICY listing_tier_visibility ON listing
  USING (can_view_listing(organization_id, visibility, status));
```

> ⚠️ This function is security-critical. It needs dedicated tests covering every
> (tier x visibility x status) combination — a wrong branch leaks inventory between competing
> brokerages. Treat it as the most test-worthy piece of SQL in the schema.

---

## Audit

Requested as part of "enterprise level".

```sql
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  organization_id uuid, actor_user_id uuid,
  action text NOT NULL,              -- 'listing.published', 'user.role_changed', ...
  entity_type text NOT NULL, entity_id uuid,
  before jsonb, after jsonb,
  ip inet, user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (organization_id, occurred_at DESC);
CREATE INDEX ON audit_log (entity_type, entity_id);
```

---

## Migration & seed plan

1. `0001_extensions` — `postgis`, `pgcrypto`, `citext`
2. `0002_enums`
3. `0003_identity` — organization, app_user, refresh_token, contact, contact_identity, otp_challenge
4. `0004_geography` — city, locality (+ GiST indexes)
5. `0005_catalog` — property, listing, listing_media, listing_price_history
6. `0006_projects` — project, project_unit
7. `0007_leads` — lead, lead_activity, saved_search
8. `0008_partners` — partner_relationship, can_view_listing()
8. `0008_audit`
9. `0009_rls_policies` — enable RLS + policies (last, so tables exist)

**Seed data needed:** Chandigarh Sectors 1–56, Mohali Phases 1–11 + Sectors 66–91, Kharar
(Sunny Enclave, Kharar-Landran belt, Desu Majra), Zirakpur, New Chandigarh. Boundary polygons
can start as centroids + radius and be refined later — I'll flag which are approximations.

## Resolved

1. **Buyer accounts** — both phone+OTP *and* email+password on a linked identity model.
   See ADR-003 and the `contact` / `contact_identity` / `otp_challenge` tables above.
2. **Partner visibility** — tiered, controlled per partner. See `partner_relationship` and the
   `can_view_listing()` policy function.
3. **Languages** — English only for v1. No translatable columns in migration 0001; editorial
   content is shaped so a sibling translation table can be added without rewriting queries.

## Still open

- WhatsApp delivery: Meta Cloud API direct, or a BSP (Gupshup / AiSensy / Interakt)? Affects the
  notification-service adapter only, not the schema — safe to decide later.
