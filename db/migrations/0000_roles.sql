-- 0000_roles.sql
-- Supabase ships with the roles `anon`, `authenticated`, and `service_role`
-- already created. A bare Postgres (local dev, CI) does not. To keep the schema
-- and the RLS proof IDENTICAL in both places, create them here, guarded so this
-- is a harmless no-op on Supabase.
--
-- These are NOLOGIN roles assumed via `SET ROLE` / the PostgREST JWT bridge.
-- They are intentionally low-privilege: data protection comes from RLS, not
-- from withholding these roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- They must be able to *see* the schema to even attempt a query. Whether they
-- get any rows back is decided by RLS (see db/policies/).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
