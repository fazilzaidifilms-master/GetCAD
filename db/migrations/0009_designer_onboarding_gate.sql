-- 0009_designer_onboarding_gate.sql
-- Designer onboarding with an explicit agreement-acceptance GATE.
--
-- Client onboarding stays light (see 0007 ensure_self -> CLIENT/ACTIVE). This
-- slice adds the gated designer path:
--   1. apply_as_designer()          -> role DESIGNER, status PENDING, profile
--                                       created (audited DESIGNER_APPLIED).
--   2. accept_designer_agreement()  -> records acceptance + flips to ACTIVE
--                                       (audited DESIGNER_AGREEMENT_ACCEPTED).
--   3. Only then is the designer ASSIGNABLE — transition_order()'s ASSIGNED step
--      refuses any designer who has not passed the gate.
--
-- The agreement DOCUMENT is deliberately not wired: we store only a version
-- string (e.g. 'UNWIRED_V0') and the acceptance timestamp. The structure + audit
-- trail exist now; the lawyer-drafted content and signature capture slot in later
-- without changing this wiring.
--
-- FLAGGED: applying as a designer changes the user's role (audited) — a
-- significant event; real product may separate designer accounts.

-- The gate marker lives on the designer's identity row.
ALTER TABLE designer_profiles
  ADD COLUMN agreement_accepted_at timestamptz,
  ADD COLUMN agreement_version     text;

-- A designer may be assigned to work only if they are an ACTIVE designer who has
-- accepted the agreement. Single source of truth for "assignable".
CREATE OR REPLACE FUNCTION app.designer_is_assignable(p_designer_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.designer_profiles dp ON dp.user_id = u.id
    WHERE u.id = p_designer_id
      AND u.role = 'DESIGNER'
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
      AND dp.deleted_at IS NULL
      AND dp.agreement_accepted_at IS NOT NULL
  )
$$;

-- Apply to become a designer: role DESIGNER, status PENDING, identity profile.
-- Idempotent (a second call with a profile already present is a no-op).
CREATE OR REPLACE FUNCTION public.apply_as_designer(
  p_profile_id text,
  p_legal_name text,
  p_email      text,
  p_country    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM public.designer_profiles WHERE user_id = v_clerk_id) THEN
    RETURN jsonb_build_object('user_id', v_clerk_id, 'already', true);
  END IF;

  INSERT INTO public.users (id, role, status)
  VALUES (v_clerk_id, 'DESIGNER', 'PENDING')
  ON CONFLICT (id) DO UPDATE SET role = 'DESIGNER', status = 'PENDING';

  INSERT INTO public.designer_profiles (id, user_id, legal_name, email, country)
  VALUES (p_profile_id, v_clerk_id, p_legal_name, p_email, p_country);

  PERFORM audit.log_event(
    'DESIGNER_APPLIED', 'user', v_clerk_id, v_clerk_id, 'DESIGNER',
    jsonb_build_object('status', 'PENDING')
  );

  RETURN jsonb_build_object('user_id', v_clerk_id, 'status', 'PENDING');
END
$$;

-- Accept the designer agreement. Records the acceptance, flips the designer to
-- ACTIVE (assignable), and audits it. Idempotent. The version is a placeholder
-- until the real document exists.
CREATE OR REPLACE FUNCTION public.accept_designer_agreement(
  p_version text DEFAULT 'UNWIRED_V0'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_already  boolean;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT (agreement_accepted_at IS NOT NULL) INTO v_already
  FROM public.designer_profiles
  WHERE user_id = v_clerk_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not a designer applicant: apply as a designer first';
  END IF;
  IF v_already THEN
    RETURN jsonb_build_object('user_id', v_clerk_id, 'accepted', true, 'already', true);
  END IF;

  UPDATE public.designer_profiles
    SET agreement_accepted_at = now(), agreement_version = p_version
    WHERE user_id = v_clerk_id;
  UPDATE public.users
    SET status = 'ACTIVE'
    WHERE id = v_clerk_id AND role = 'DESIGNER';

  PERFORM audit.log_event(
    'DESIGNER_AGREEMENT_ACCEPTED', 'user', v_clerk_id, v_clerk_id, 'DESIGNER',
    jsonb_build_object('agreement_version', p_version)
  );

  RETURN jsonb_build_object('user_id', v_clerk_id, 'accepted', true);
END
$$;

-- Redefine transition_order so ASSIGNED enforces the gate via
-- app.designer_is_assignable() (replaces the plain "is a DESIGNER" check).
CREATE OR REPLACE FUNCTION public.transition_order(
  p_order_id   text,
  p_new_status order_status,
  p_payload    jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_order    public.orders%ROWTYPE;
  v_scope    text;
  v_designer text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_role := app.current_user_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'no role: complete onboarding first';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT actor_scope INTO v_scope
  FROM public.order_transitions
  WHERE from_status = v_order.status
    AND to_status   = p_new_status
    AND actor_role  = v_role;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal transition: % -> % by role %',
      v_order.status, p_new_status, v_role;
  END IF;

  IF v_scope = 'CLIENT_PARTY' AND v_order.client_id IS DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'not the client of this order';
  ELSIF v_scope = 'DESIGNER_PARTY' AND v_order.designer_id IS DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'not the assigned designer of this order';
  END IF;

  IF p_new_status = 'ASSIGNED' THEN
    v_designer := p_payload ->> 'designer_id';
    IF v_designer IS NULL THEN
      RAISE EXCEPTION 'ASSIGNED requires a designer_id in the payload';
    END IF;
    IF NOT app.designer_is_assignable(v_designer) THEN
      RAISE EXCEPTION 'designer is not assignable: must be an ACTIVE designer who has accepted the agreement';
    END IF;
    UPDATE public.orders
      SET designer_id = v_designer, status = p_new_status
      WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET status = p_new_status WHERE id = p_order_id;
  END IF;

  PERFORM audit.log_event(
    'ORDER_STATUS_CHANGED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_order.status, 'to', p_new_status) || coalesce(p_payload, '{}'::jsonb)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'from', v_order.status, 'to', p_new_status);
END
$$;

REVOKE ALL ON FUNCTION public.apply_as_designer(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_designer_agreement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_as_designer(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_designer_agreement(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.designer_is_assignable(text) TO authenticated, service_role;
