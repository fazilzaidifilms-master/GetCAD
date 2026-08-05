-- 0032_user_admin.sql
-- Who is on the platform, and what they are allowed to be.
--
-- Until now the only way to give someone a role was to open the Supabase SQL
-- editor and UPDATE users. That works exactly once, for the person who built
-- the thing. It does not survive a second staff member, it leaves no record of
-- who granted what, and it means the most security-relevant action in the
-- product — handing someone OPS — happens outside the app, outside the audit
-- log, with a tool that will just as happily drop a table.
--
-- ONLY OPS. Not "staff": SALES, QC and FINANCE are roles you can be GIVEN, and
-- a role that can grant itself a promotion is not a permission boundary. QC in
-- particular is the independent check on the work; letting QC appoint QC would
-- hollow that out.
--
-- WHAT IS DELIBERATELY NOT HERE: no email, no name, no Clerk profile data. The
-- console shows opaque ids, because staff administering accounts do not need to
-- know which jeweller is which to change a role, and this product's whole
-- premise is that identity does not travel further than it must. Matching an
-- id to a person is done in Clerk, by someone who has a reason to.

-- ------------------------------------------------------------------ guard --

CREATE OR REPLACE FUNCTION app.require_ops()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role public.role;
BEGIN
  IF app.current_clerk_id() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_role := app.current_user_role();
  IF v_role IS DISTINCT FROM 'OPS' THEN
    RAISE EXCEPTION 'only OPS may administer accounts';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.require_ops() FROM PUBLIC;

-- ------------------------------------------------------------------- read --

-- Everyone on the platform, newest first, with enough context to act.
--
-- `p_search` matches the opaque id only. There is nothing else to search by
-- here on purpose (see the header), and an id is what a person quotes when they
-- write in — the account screen shows them exactly this value and tells them to
-- quote it.
CREATE OR REPLACE FUNCTION public.list_platform_users(
  p_search text DEFAULT NULL,
  p_role   text DEFAULT NULL,
  p_limit  integer DEFAULT 200
)
RETURNS TABLE (
  id            text,
  role          public.role,
  status        public.user_status,
  created_at    timestamptz,
  orders_as_client   integer,
  orders_as_designer integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app.require_ops();

  IF p_role IS NOT NULL AND p_role NOT IN ('CLIENT','DESIGNER','OPS','SALES','FINANCE','QC') THEN
    RAISE EXCEPTION 'unknown role filter: %', p_role;
  END IF;

  RETURN QUERY
  SELECT u.id,
         u.role,
         u.status,
         u.created_at,
         -- Shown so nobody changes a role without seeing what it would strand:
         -- a designer with live work is not someone to flip to CLIENT casually.
         (SELECT count(*)::integer FROM public.orders o WHERE o.client_id   = u.id),
         (SELECT count(*)::integer FROM public.orders o WHERE o.designer_id = u.id)
  FROM public.users u
  WHERE (p_search IS NULL OR btrim(p_search) = '' OR u.id ILIKE '%' || btrim(p_search) || '%')
    AND (p_role IS NULL OR u.role = p_role::public.role)
  ORDER BY u.created_at DESC
  LIMIT greatest(coalesce(p_limit, 200), 1);
END
$$;

REVOKE ALL ON FUNCTION public.list_platform_users(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_users(text, text, integer) TO authenticated, service_role;

-- ------------------------------------------------------------------ write --

-- How many people can still administer accounts if this one stops being able to.
CREATE OR REPLACE FUNCTION app.other_active_ops(p_excluding text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.users
  WHERE role = 'OPS' AND status = 'ACTIVE' AND id IS DISTINCT FROM p_excluding;
$$;

REVOKE ALL ON FUNCTION app.other_active_ops(text) FROM PUBLIC;

-- Change someone's role. Audited, and refuses the two ways this locks the door
-- from the inside.
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor  text;
  v_before public.users%ROWTYPE;
BEGIN
  PERFORM app.require_ops();
  v_actor := app.current_clerk_id();

  IF p_role NOT IN ('CLIENT','DESIGNER','OPS','SALES','FINANCE','QC') THEN
    RAISE EXCEPTION 'unknown role: %', p_role;
  END IF;

  SELECT * INTO v_before FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such user';
  END IF;

  -- THE LOCKOUT. Demoting the last OPS leaves a platform nobody can administer,
  -- recoverable only by going back to the SQL editor this function exists to
  -- replace. Applies to demoting yourself and to demoting someone else.
  IF v_before.role = 'OPS' AND p_role <> 'OPS' AND app.other_active_ops(p_user_id) = 0 THEN
    RAISE EXCEPTION 'this is the last active OPS account — promote someone else first';
  END IF;

  IF v_before.role = p_role::public.role THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', false);
  END IF;

  UPDATE public.users SET role = p_role::public.role WHERE id = p_user_id;

  -- The actor IS recorded here, unlike the anonymity-preserving events
  -- elsewhere. Granting privilege is exactly the thing a log exists to answer
  -- "who did that" about.
  PERFORM audit.log_event(
    'USER_ROLE_CHANGED', 'user', p_user_id, v_actor, app.current_user_role(),
    jsonb_build_object('from', v_before.role, 'to', p_role, 'self', v_actor = p_user_id)
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role, 'changed', true);
END
$$;

REVOKE ALL ON FUNCTION public.set_user_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(text, text) TO authenticated, service_role;

-- Activate or suspend an account. Suspension is the reversible control; there
-- is no delete, because orders, escrow rows and audit entries reference a user
-- and a platform that can erase a counterparty cannot answer a dispute.
CREATE OR REPLACE FUNCTION public.set_user_status(p_user_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor  text;
  v_before public.users%ROWTYPE;
BEGIN
  PERFORM app.require_ops();
  v_actor := app.current_clerk_id();

  IF p_status NOT IN ('PENDING','ACTIVE','SUSPENDED') THEN
    RAISE EXCEPTION 'unknown status: %', p_status;
  END IF;

  SELECT * INTO v_before FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such user';
  END IF;

  IF v_before.role = 'OPS' AND p_status <> 'ACTIVE' AND app.other_active_ops(p_user_id) = 0 THEN
    RAISE EXCEPTION 'this is the last active OPS account — promote someone else first';
  END IF;

  IF v_before.status = p_status::public.user_status THEN
    RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status, 'changed', false);
  END IF;

  UPDATE public.users SET status = p_status::public.user_status WHERE id = p_user_id;

  PERFORM audit.log_event(
    'USER_STATUS_CHANGED', 'user', p_user_id, v_actor, app.current_user_role(),
    jsonb_build_object('from', v_before.status, 'to', p_status, 'self', v_actor = p_user_id)
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status, 'changed', true);
END
$$;

REVOKE ALL ON FUNCTION public.set_user_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_status(text, text) TO authenticated, service_role;
