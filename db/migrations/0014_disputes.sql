-- 0014_disputes.sql
-- Structured dispute resolution. A client raises a dispute WITH A REASON; staff
-- resolve it as REWORK (back to the designer) or REFUND (money returned via the
-- escrow layer). Both events are recorded on a first-class `disputes` row and
-- audited.
--
-- Like the money layer, these transitions leave the generic transition_order:
--   * you cannot reach DISPUTED via transition_order (a reason is required) —
--     use raise_dispute();
--   * you cannot move a DISPUTED order via transition_order (an outcome must be
--     recorded) — use resolve_dispute().
-- The order_transitions graph rows stay for staff visibility (0006).

CREATE TABLE disputes (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id         text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  raised_by        text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reason           text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 5000),
  status           text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution       text        CHECK (resolution IN ('REWORK', 'REFUND')),
  resolved_by      text        REFERENCES users (id) ON DELETE RESTRICT,
  resolution_notes text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

CREATE INDEX disputes_order_idx ON disputes (order_id);
-- At most one OPEN dispute per order.
CREATE UNIQUE INDEX disputes_one_open ON disputes (order_id) WHERE status = 'OPEN';

-- A resolved row must carry an outcome; an open row must not.
ALTER TABLE disputes ADD CONSTRAINT disputes_resolution_shape CHECK (
  (status = 'OPEN'     AND resolution IS NULL     AND resolved_by IS NULL AND resolved_at IS NULL) OR
  (status = 'RESOLVED' AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
);

-- Raise a dispute (the order's client only), from a state where work is in
-- flight or under client preview. Records the reason and moves to DISPUTED.
CREATE OR REPLACE FUNCTION public.raise_dispute(
  p_order_id text,
  p_reason   text
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
  v_id       text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();

  IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a dispute reason is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  IF v_role IS DISTINCT FROM 'CLIENT' OR v_order.client_id IS DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'only the order''s client may raise a dispute';
  END IF;
  IF v_order.status NOT IN ('IN_PROGRESS', 'CLIENT_PREVIEW') THEN
    RAISE EXCEPTION 'a dispute can only be raised while work is in progress or under preview (is %)',
      v_order.status;
  END IF;

  INSERT INTO public.disputes (order_id, raised_by, reason)
  VALUES (p_order_id, v_clerk_id, btrim(p_reason))
  RETURNING id INTO v_id;

  UPDATE public.orders SET status = 'DISPUTED' WHERE id = p_order_id;

  PERFORM audit.log_event(
    'DISPUTE_RAISED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('dispute_id', v_id, 'from', v_order.status, 'to', 'DISPUTED')
  );

  RETURN jsonb_build_object('dispute_id', v_id, 'status', 'DISPUTED');
END
$$;

-- Resolve the open dispute on an order.
--   REWORK  (OPS)     -> order back to IN_PROGRESS.
--   REFUND  (FINANCE) -> escrow refunded (reuses refund_escrow), order REFUNDED.
CREATE OR REPLACE FUNCTION public.resolve_dispute(
  p_order_id   text,
  p_resolution text,
  p_notes      text DEFAULT NULL
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
  v_dispute  public.disputes%ROWTYPE;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();

  IF p_resolution NOT IN ('REWORK', 'REFUND') THEN
    RAISE EXCEPTION 'resolution must be REWORK or REFUND';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_order.status <> 'DISPUTED' THEN
    RAISE EXCEPTION 'order is not disputed (is %)', v_order.status;
  END IF;

  SELECT * INTO v_dispute
  FROM public.disputes
  WHERE order_id = p_order_id AND status = 'OPEN'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open dispute for this order'; END IF;

  IF p_resolution = 'REWORK' THEN
    IF v_role IS DISTINCT FROM 'OPS' THEN
      RAISE EXCEPTION 'only OPS may send a dispute back for rework';
    END IF;
    UPDATE public.orders SET status = 'IN_PROGRESS' WHERE id = p_order_id;
  ELSE  -- REFUND
    IF v_role IS DISTINCT FROM 'FINANCE' THEN
      RAISE EXCEPTION 'only FINANCE may refund a dispute';
    END IF;
    PERFORM public.refund_escrow(p_order_id);  -- moves order -> REFUNDED, records the ledger entry
  END IF;

  UPDATE public.disputes
    SET status = 'RESOLVED', resolution = p_resolution, resolved_by = v_clerk_id,
        resolution_notes = p_notes, resolved_at = now()
    WHERE id = v_dispute.id;

  PERFORM audit.log_event(
    'DISPUTE_RESOLVED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('dispute_id', v_dispute.id, 'resolution', p_resolution)
  );

  RETURN jsonb_build_object('dispute_id', v_dispute.id, 'resolution', p_resolution);
END
$$;

-- Reissue transition_order with dispute guards added to the money guards
-- (carrying forward the 0009 designer gate + 0012 money guard).
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

  -- Money-bearing status changes belong to the escrow/quote functions.
  IF p_new_status IN ('QUOTED', 'PAYMENT_HELD', 'PAYOUT_RELEASED', 'REFUNDED') THEN
    RAISE EXCEPTION 'money-bearing transition to %: use quote_order / hold_escrow / release_escrow / refund_escrow',
      p_new_status;
  END IF;
  -- Raising a dispute requires a reason.
  IF p_new_status = 'DISPUTED' THEN
    RAISE EXCEPTION 'raising a dispute requires a reason: use raise_dispute()';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  -- Resolving a dispute must record an outcome.
  IF v_order.status = 'DISPUTED' THEN
    RAISE EXCEPTION 'a disputed order must be resolved via resolve_dispute()';
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

REVOKE ALL ON FUNCTION public.raise_dispute(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_dispute(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raise_dispute(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_dispute(text, text, text) TO authenticated, service_role;
