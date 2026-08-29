-- 0003: Identity, tenancy, and consumer authentication

-- =========================================================================================
-- Organisations — the tenant boundary.
-- =========================================================================================
CREATE TABLE organization (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  slug                 text        NOT NULL UNIQUE,
  type                 org_type    NOT NULL,
  status               org_status  NOT NULL DEFAULT 'PENDING',

  -- RERA. Registration number must appear in ALL advertising including the website;
  -- penalty runs to Rs 10 lakh. Mohali/Kharar fall under Punjab RERA while Chandigarh is a
  -- separate UT authority, so an agent working the tricity spans TWO jurisdictions —
  -- hence jurisdiction is a column, not a constant.
  rera_registration_no text,
  rera_jurisdiction    text,
  rera_valid_until     date,

  phone                text,
  email                citext,
  address_line         text,
  logo_key             text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN organization.rera_jurisdiction IS
  'PUNJAB | CHANDIGARH | HARYANA — the tricity spans multiple RERA authorities';

-- =========================================================================================
-- Staff users. Consumers are NOT stored here — see contact below.
-- =========================================================================================
CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  email           citext      NOT NULL UNIQUE,
  phone           text,
  password_hash   text        NOT NULL,          -- Argon2id
  full_name       text        NOT NULL,
  role            user_role   NOT NULL DEFAULT 'AGENT',
  status          user_status NOT NULL DEFAULT 'INVITED',
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_org_idx ON app_user (organization_id, status);

-- =========================================================================================
-- Refresh tokens: rotating, with reuse detection.
--
-- family_id groups one rotation chain. Presenting a token that has already been used means
-- either theft or a replay, so the correct response is to revoke the ENTIRE family rather
-- than just reject the request. This is the standard OAuth 2.1 recommendation and it is the
-- single highest-value thing in this table.
-- =========================================================================================
CREATE TABLE refresh_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  family_id  uuid        NOT NULL,
  token_hash text        NOT NULL UNIQUE,        -- SHA-256; the raw token is never stored
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  user_agent text,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_token_family_idx ON refresh_token (family_id);
CREATE INDEX refresh_token_user_idx   ON refresh_token (user_id);

-- =========================================================================================
-- Consumers (buyers/sellers). Separate from app_user so tenant RLS stays simple to reason
-- about: a contact belongs to no organisation.
-- =========================================================================================
CREATE TABLE contact (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         text,
  primary_phone     text,        -- phone is the primary identifier in this market
  primary_email     citext,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  whatsapp_opt_in   boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Partial unique indexes: many contacts may have a NULL phone or email, but a present value
-- must be unique.
CREATE UNIQUE INDEX contact_phone_uniq ON contact (primary_phone) WHERE primary_phone IS NOT NULL;
CREATE UNIQUE INDEX contact_email_uniq ON contact (primary_email) WHERE primary_email IS NOT NULL;

-- =========================================================================================
-- Credentials. One row per way of proving identity, so a single person can log in with a
-- phone OTP today and a Google account tomorrow without any schema change.
-- =========================================================================================
CREATE TABLE contact_identity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid              NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  provider     identity_provider NOT NULL,
  provider_uid text              NOT NULL,   -- phone, email, or OAuth subject
  secret_hash  text,                         -- Argon2id for PASSWORD; NULL for OTP/OAuth
  verified_at  timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz       NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX contact_identity_contact_idx ON contact_identity (contact_id);

-- =========================================================================================
-- OTP challenges.
--
-- Codes are hashed, single-use, attempt-limited and short-lived. OTP endpoints are the most
-- abused surface on any Indian consumer app — SMS-pumping fraud costs real money per message —
-- so rate limiting on top of this table is mandatory, not optional.
-- =========================================================================================
CREATE TABLE otp_challenge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text        NOT NULL,          -- phone or email
  code_hash   text        NOT NULL,          -- never store the raw code
  purpose     text        NOT NULL,          -- LOGIN | VERIFY | RESET
  attempts    smallint    NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_attempts_bounded CHECK (attempts >= 0 AND attempts <= 10)
);
CREATE INDEX otp_active_idx ON otp_challenge (destination, purpose) WHERE consumed_at IS NULL;
