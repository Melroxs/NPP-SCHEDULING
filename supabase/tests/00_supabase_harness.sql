-- ============================================
-- LOCAL SUPABASE HARNESS
-- ============================================
-- Reproduces the parts of a Supabase project that the migrations depend on, so
-- the schema, RLS policies and triggers can be executed and tested on a plain
-- PostgreSQL instance (no Docker, no hosted project).
--
--   createdb npp_test
--   psql -d npp_test -f supabase/tests/00_supabase_harness.sql
--   psql -d npp_test -f supabase/migrations/001_initial_schema.sql   (… 002-006)
--
-- This is a TEST harness only; never run it against a real Supabase database.

-- Roles that PostgREST switches into. service_role bypasses RLS, exactly as on
-- Supabase; anon/authenticated are subject to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase grants full table privileges to these roles by default and relies on
-- RLS plus column revokes for the actual restrictions.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- The `auth` schema is provided by Supabase. auth.uid() reads the JWT subject;
-- tests set it with:  SET LOCAL request.jwt.claim.sub = '<uuid>';
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
