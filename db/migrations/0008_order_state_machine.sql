-- 0008_order_state_machine.sql
-- The order lifecycle engine: DB-enforced, role-gated, audited transitions.
--
-- `order_transitions` is the legal-move graph as DATA (inspectable, reviewable).
-- `public.transition_order()` is the ONLY way an order changes status: it checks
-- the move is legal for the caller's role and party relationship, applies it, and
-- appends an ORDER_STATUS_CHANGED entry to the audit log — atomically.
-- `public.create_order()` creates a DRAFT order owned by the caller (audited).
--
-- Identity + role come from the verified Clerk token (never parameters), so a
-- caller can only ever act as themselves.
--
-- FLAGGED: the transition matrix below is a first cut, open to revision.

-- Who may drive a given status change, and what relationship they must have to
-- the order. actor_scope: STAFF = role is enough; CLIENT_PARTY/DESIGNER_PARTY =
-- must also be the order's client / assigned designer.
CREATE TABLE order_transitions (
  from_status  order_status NOT NULL,
  to_status    order_status NOT NULL,
  actor_role   role         NOT NULL,
  actor_scope  text         NOT NULL CHECK (actor_scope IN ('STAFF', 'CLIENT_PARTY', 'DESIGNER_PARTY')),
  PRIMARY KEY (from_status, to_status, actor_role)
);

INSERT INTO order_transitions (from_status, to_status, actor_role, actor_scope) VALUES
  ('DRAFT',              'SUBMITTED',          'CLIENT',   'CLIENT_PARTY'),
  ('DRAFT',              'CANCELLED',          'CLIENT',   'CLIENT_PARTY'),
  ('SUBMITTED',          'QUOTED',             'SALES',    'STAFF'),
  ('SUBMITTED',          'CANCELLED',          'CLIENT',   'CLIENT_PARTY'),
  ('QUOTED',             'PAYMENT_HELD',       'CLIENT',   'CLIENT_PARTY'),
  ('QUOTED',             'CANCELLED',          'CLIENT',   'CLIENT_PARTY'),
  ('PAYMENT_HELD',       'ASSIGNED',           'OPS',      'STAFF'),
  ('PAYMENT_HELD',       'REFUNDED',           'FINANCE',  'STAFF'),
  ('ASSIGNED',           'IN_PROGRESS',        'DESIGNER', 'DESIGNER_PARTY'),
  ('IN_PROGRESS',        'DESIGNER_SUBMITTED', 'DESIGNER', 'DESIGNER_PARTY'),
  ('IN_PROGRESS',        'DISPUTED',           'CLIENT',   'CLIENT_PARTY'),
  ('DESIGNER_SUBMITTED', 'QC_REVIEW',          'OPS',      'STAFF'),
  ('QC_REVIEW',          'REVISION_REQUESTED', 'QC',       'STAFF'),
  ('QC_REVIEW',          'CLIENT_PREVIEW',     'QC',       'STAFF'),
  ('REVISION_REQUESTED', 'IN_PROGRESS',        'DESIGNER', 'DESIGNER_PARTY'),
  ('CLIENT_PREVIEW',     'APPROVED',           'CLIENT',   'CLIENT_PARTY'),
  ('CLIENT_PREVIEW',     'REVISION_REQUESTED', 'CLIENT',   'CLIENT_PARTY'),
  ('CLIENT_PREVIEW',     'DISPUTED',           'CLIENT',   'CLIENT_PARTY'),
  ('APPROVED',           'DELIVERED',          'OPS',      'STAFF'),
  ('DELIVERED',          'CLOSED',             'CLIENT',   'CLIENT_PARTY'),
  ('DELIVERED',          'CLOSED',             'OPS',      'STAFF'),
  ('CLOSED',             'PAYOUT_RELEASED',    'FINANCE',  'STAFF'),
  ('DISPUTED',           'REFUNDED',           'FINANCE',  'STAFF'),
  ('DISPUTED',           'IN_PROGRESS',        'OPS',      'STAFF');

-- Create a DRAFT order owned by the current user. Money fields start at 0 (a
-- quote sets them later). Audited as ORDER_CREATED.
CREATE OR REPLACE FUNCTION public.create_order(
  p_id           text,
  p_product_type text,
  p_currency     text DEFAULT 'USD'
)
RETURNS text
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

  INSERT INTO public.orders
    (id, client_id, product_type, status, currency,
     price_total, designer_payout, qc_payout, platform_commission)
  VALUES
    (p_id, v_clerk_id, p_product_type, 'DRAFT', p_currency, 0, 0, 0, 0);

  PERFORM audit.log_event(
    'ORDER_CREATED', 'order', p_id, v_clerk_id, app.current_user_role(),
    jsonb_build_object('product_type', p_product_type, 'currency', p_currency)
  );

  RETURN p_id;
END
$$;

-- The single sanctioned way to change an order's status.
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
  v_clerk_id   text;
  v_role       public.role;
  v_order      public.orders%ROWTYPE;
  v_scope      text;
  v_designer   text;
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
    PERFORM 1 FROM public.users
      WHERE id = v_designer AND role = 'DESIGNER' AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'designer_id is not a valid DESIGNER';
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

REVOKE ALL ON FUNCTION public.create_order(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_order(text, order_status, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_order(text, order_status, jsonb) TO authenticated, service_role;
