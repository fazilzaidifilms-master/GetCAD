-- 0007_onboarding.sql
-- Audited self-onboarding.
--
-- public.ensure_self() creates the CURRENT user's row in public.users if it
-- doesn't exist yet, and — atomically, in the same transaction — appends a
-- USER_CREATED entry to the append-only audit log. Idempotent: a second call is
-- a no-op (no duplicate row, no duplicate audit entry).
--
-- The identity is taken from the verified Clerk token (app.current_clerk_id()),
-- never a parameter, so a caller can only ever onboard THEMSELVES. Runs
-- SECURITY DEFINER so it may write to users + audit, but it is safe precisely
-- because it trusts only the JWT-derived id.
--
-- Placeholder policy (flagged): a self-signup defaults to CLIENT / ACTIVE. Real
-- onboarding may use PENDING + a role-selection/verification step; staff and
-- designers are provisioned by other paths.

CREATE OR REPLACE FUNCTION public.ensure_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_created  boolean := false;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated: no Clerk identity on this request';
  END IF;

  INSERT INTO public.users (id, role, status)
  VALUES (v_clerk_id, 'CLIENT', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  IF FOUND THEN
    v_created := true;
    PERFORM audit.log_event(
      'USER_CREATED',
      'user',
      v_clerk_id,
      v_clerk_id,
      'CLIENT'::public.role,
      jsonb_build_object('role', 'CLIENT', 'status', 'ACTIVE', 'via', 'self_onboarding')
    );
  END IF;

  RETURN jsonb_build_object('created', v_created, 'user_id', v_clerk_id);
END
$$;

-- Only a logged-in user (or the trusted server) may onboard; anon is rejected
-- by the identity check above regardless.
REVOKE ALL ON FUNCTION public.ensure_self() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_self() TO authenticated, service_role;
