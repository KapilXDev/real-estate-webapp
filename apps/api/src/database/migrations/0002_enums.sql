-- 0002: Enumerated types
--
-- Postgres enums are used rather than lookup tables because these are closed sets that change
-- only with a code deploy. Adding a value later is `ALTER TYPE ... ADD VALUE`, which is cheap.

-- --- Organisations & users ---------------------------------------------------------------
CREATE TYPE org_type   AS ENUM ('BROKERAGE', 'PARTNER', 'BUILDER');
CREATE TYPE org_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

CREATE TYPE user_role   AS ENUM ('OWNER', 'ADMIN', 'AGENT', 'STAFF');
CREATE TYPE user_status AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- Consumer credentials. Rows, not columns — adding GOOGLE/FACEBOOK later needs no schema change.
CREATE TYPE identity_provider AS ENUM ('PHONE_OTP', 'PASSWORD', 'GOOGLE', 'FACEBOOK');

-- --- Geography ---------------------------------------------------------------------------
-- The unit here is the sector/phase, not the American "neighborhood".
CREATE TYPE locality_kind AS ENUM ('SECTOR', 'PHASE', 'ENCLAVE', 'COLONY', 'VILLAGE', 'ROAD_BELT');

-- --- Property ----------------------------------------------------------------------------
-- Indian taxonomy. Deliberately NOT the US one:
--   KOTHI         independent house on its own plot
--   BUILDER_FLOOR one floor of a low-rise, sold separately
--   SCO / SCF     Shop-Cum-Office / Shop-Cum-Flat — standard tricity commercial formats
--   BOOTH         small standalone commercial unit
CREATE TYPE property_type AS ENUM (
  'PLOT', 'KOTHI', 'BUILDER_FLOOR', 'FLAT', 'SCO', 'SCF',
  'BOOTH', 'SHOWROOM', 'FARMHOUSE', 'INDUSTRIAL'
);

CREATE TYPE transaction_type AS ENUM ('SALE', 'RENT', 'LEASE');
CREATE TYPE furnishing       AS ENUM ('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED');
CREATE TYPE facing           AS ENUM ('NORTH','SOUTH','EAST','WEST','NE','NW','SE','SW');

-- Punjab transacts in marla/kanal; buyers also say gaj (sq yd). See area_conversion_factor
-- on the property table for why the factor is stored per row.
CREATE TYPE area_unit AS ENUM ('SQ_FT', 'SQ_YD', 'MARLA', 'KANAL', 'ACRE', 'BIGHA', 'SQ_M');

-- --- Listings ----------------------------------------------------------------------------
CREATE TYPE listing_status AS ENUM (
  'DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'UNDER_OFFER',
  'SOLD', 'RENTED', 'WITHDRAWN', 'REJECTED', 'EXPIRED'
);
CREATE TYPE listing_source     AS ENUM ('OWN', 'PARTNER', 'BUILDER', 'IMPORT');
CREATE TYPE listing_visibility AS ENUM ('PUBLIC', 'NETWORK_ONLY', 'PRIVATE');

-- --- Partners ----------------------------------------------------------------------------
-- Tiered visibility, granted per partner by the host organisation.
CREATE TYPE partner_tier AS ENUM ('OWN_ONLY', 'PUBLIC_PLUS_OWN', 'NETWORK', 'FULL');
CREATE TYPE partner_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- --- Leads -------------------------------------------------------------------------------
CREATE TYPE lead_channel AS ENUM ('WEB', 'WHATSAPP', 'CALL', 'WALK_IN', 'REFERRAL');
CREATE TYPE lead_status  AS ENUM (
  'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON', 'LOST'
);
