-- 0005_auth_identity.sql
-- The database side of the Clerk -> Supabase bridge.
--
-- When a request carries a verified Clerk JWT, Supabase/PostgREST place its
-- claims into the `request.jwt.claims` setting. These helper functions read the
-- current user's identity from there so RLS policies (db/policies/0003) can gate
-- access per person. This mirrors Supabase's `auth.jwt()->>'sub'`, but is
-- written portably so a bare Postgres (local dev, CI) behaves identically — no
-- dependency on Supabase's `auth` schema.

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

-- The Clerk user id of the current request (the JWT `sub`), or NULL when the
-- request is unauthenticated (anon). This is also our `users.id`.
CREATE OR REPLACE FUNCTION app.current_clerk_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
$$;

-- The app-role of the current user, resolved from public.users by Clerk id.
-- SECURITY DEFINER + empty search_path so the lookup is robust and injection-safe.
-- (Even without definer bypass, the users self-read policy lets a user read
-- their own row, so this resolves correctly on every platform.)
CREATE OR REPLACE FUNCTION app.current_user_role()
RETURNS public.role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.id = app.current_clerk_id()
    AND u.deleted_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION app.current_clerk_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_user_role() TO anon, authenticated, service_role;
