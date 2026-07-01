-- 0006_debug_identity.sql
-- TEMPORARY DIAGNOSTIC (safe to drop later). Returns what the database sees for
-- the CURRENT request: the Postgres role it resolved to (anon vs authenticated),
-- and the Clerk claims PostgREST placed in request.jwt.claims. SECURITY INVOKER
-- (default) so current_user reflects the real caller. Exposed to anon so we can
-- see when a request is NOT being upgraded to authenticated.

CREATE OR REPLACE FUNCTION public.debug_identity()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'db_role',    current_user,
    'has_claims', (nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL),
    'clerk_id',   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
    'role_claim', (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

GRANT EXECUTE ON FUNCTION public.debug_identity() TO anon, authenticated;
