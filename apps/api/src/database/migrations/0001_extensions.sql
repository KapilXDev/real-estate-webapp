-- 0001: Extensions
--
-- postgis  : spatial types + GiST indexes. Required from the very first migration because
--            locality boundaries and property points are core, not an add-on. Retrofitting
--            PostGIS into an existing volume is avoidable pain.
-- pgcrypto : gen_random_uuid()
-- citext   : case-insensitive email. Storing emails as citext removes an entire class of
--            "user can register the same address twice with different casing" bugs.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
