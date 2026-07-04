-- 0012_escrow.sql
-- The money layer: a quote sets the price + split, then money moves through an
-- APPEND-ONLY escrow ledger (HOLD -> RELEASE | REFUND). Provider-agnostic: we
-- record the movements now; a real processor (Stripe) is wired in a later slice
-- by having its webhook call these same functions.
--
-- CROWN-JEWEL INVARIANT — MONEY IS CONSERVED. Every cent released or refunded
-- traces back to a cent that was held; nothing is created or lost. Enforced:
--   * amounts are INTEGER MINOR UNITS, CHECK (amount > 0);
--   * a quote's split MUST sum to the price total;
--   * a release's legs MUST sum to the amount currently held;
--   * exactly one HOLD per order; release and refund are mutually exclusive
--     (each needs a positive held balance, and both drive it to zero).
--
-- Money-bearing status changes are REMOVED from the generic transition_order and
-- live ONLY in these functions, so an order's status and its money can never
-- diverge (you cannot be PAYMENT_HELD without a real hold on the ledger).

-- The money-bearing / quote edges STAY in order_transitions: they still power
-- staff visibility (0006 derives "can act on" from this graph) and document the
-- legal moves. But transition_order must REFUSE to execute them, so money-bearing
-- status changes can only happen through the money functions below (keeping an
-- order's status and its money inseparable). Redefine transition_order (carrying
-- forward the 0009 designer gate) with that guard.
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

-- Append-only escrow ledger. Each row is one money movement for an order.
CREATE TABLE escrow_ledger (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id   text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  kind       text        NOT NULL CHECK (kind IN ('HOLD', 'RELEASE', 'REFUND')),
  party      text        NOT NULL CHECK (party IN ('CLIENT', 'DESIGNER', 'QC', 'PLATFORM')),
  amount     integer     NOT NULL CHECK (amount > 0),        -- minor units
  currency   text        NOT NULL,
  created_by text,                                            -- actor (users.id)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX escrow_ledger_order_idx ON escrow_ledger (order_id);
-- At most one HOLD per order.
CREATE UNIQUE INDEX escrow_ledger_one_hold ON escrow_ledger (order_id) WHERE kind = 'HOLD';

-- Append-only: a recorded money movement is never rewritten.
CREATE TRIGGER escrow_ledger_no_update
  BEFORE UPDATE ON escrow_ledger
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER escrow_ledger_no_delete
  BEFORE DELETE ON escrow_ledger
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Net amount currently held for an order: HOLD - RELEASE - REFUND.
CREATE OR REPLACE FUNCTION app.escrow_held(p_order_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    sum(CASE kind WHEN 'HOLD' THEN amount ELSE -amount END), 0
  )::integer
  FROM public.escrow_ledger
  WHERE order_id = p_order_id
$$;

-- SALES sets the quote: price + conserving split. Moves SUBMITTED -> QUOTED.
CREATE OR REPLACE FUNCTION public.quote_order(
  p_order_id            text,
  p_price_total         integer,
  p_designer_payout     integer,
  p_qc_payout           integer,
  p_platform_commission integer
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
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();
  IF v_role IS DISTINCT FROM 'SALES' THEN
    RAISE EXCEPTION 'only SALES may quote an order';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_order.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'can only quote a SUBMITTED order (is %)', v_order.status;
  END IF;

  IF p_price_total <= 0
     OR p_designer_payout < 0 OR p_qc_payout < 0 OR p_platform_commission < 0 THEN
    RAISE EXCEPTION 'amounts must be non-negative and price_total positive';
  END IF;
  IF p_designer_payout + p_qc_payout + p_platform_commission <> p_price_total THEN
    RAISE EXCEPTION 'split must sum to price_total (% + % + % <> %)',
      p_designer_payout, p_qc_payout, p_platform_commission, p_price_total;
  END IF;

  UPDATE public.orders
    SET price_total = p_price_total,
        designer_payout = p_designer_payout,
        qc_payout = p_qc_payout,
        platform_commission = p_platform_commission,
        status = 'QUOTED'
    WHERE id = p_order_id;

  PERFORM audit.log_event(
    'ORDER_QUOTED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_order.status, 'to', 'QUOTED',
                       'price_total', p_price_total,
                       'designer_payout', p_designer_payout,
                       'qc_payout', p_qc_payout,
                       'platform_commission', p_platform_commission)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'QUOTED', 'price_total', p_price_total);
END
$$;

-- The order's CLIENT funds escrow: HOLD the full price. Moves QUOTED -> PAYMENT_HELD.
CREATE OR REPLACE FUNCTION public.hold_escrow(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_order    public.orders%ROWTYPE;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  IF v_role IS DISTINCT FROM 'CLIENT' OR v_order.client_id IS DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'only the order''s client may fund it';
  END IF;
  IF v_order.status <> 'QUOTED' THEN
    RAISE EXCEPTION 'can only fund a QUOTED order (is %)', v_order.status;
  END IF;
  IF v_order.price_total <= 0 THEN
    RAISE EXCEPTION 'order has no positive price to fund';
  END IF;

  INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by)
  VALUES (p_order_id, 'HOLD', 'CLIENT', v_order.price_total, v_order.currency, v_clerk_id);

  UPDATE public.orders SET status = 'PAYMENT_HELD' WHERE id = p_order_id;

  PERFORM audit.log_event(
    'ESCROW_HELD', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', 'QUOTED', 'to', 'PAYMENT_HELD', 'amount', v_order.price_total)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PAYMENT_HELD',
                            'held', app.escrow_held(p_order_id));
END
$$;

-- FINANCE releases the held funds to the payout legs. Moves CLOSED -> PAYOUT_RELEASED.
CREATE OR REPLACE FUNCTION public.release_escrow(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_order    public.orders%ROWTYPE;
  v_held     integer;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();
  IF v_role IS DISTINCT FROM 'FINANCE' THEN
    RAISE EXCEPTION 'only FINANCE may release funds';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_order.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'can only release a CLOSED order (is %)', v_order.status;
  END IF;

  v_held := app.escrow_held(p_order_id);
  IF v_held <= 0 THEN
    RAISE EXCEPTION 'nothing is held for this order';
  END IF;
  -- Conservation: the payout legs must exactly consume what is held.
  IF v_order.designer_payout + v_order.qc_payout + v_order.platform_commission <> v_held THEN
    RAISE EXCEPTION 'payout split (% + % + %) must equal held amount %',
      v_order.designer_payout, v_order.qc_payout, v_order.platform_commission, v_held;
  END IF;

  IF v_order.designer_payout > 0 THEN
    INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by)
    VALUES (p_order_id, 'RELEASE', 'DESIGNER', v_order.designer_payout, v_order.currency, v_clerk_id);
  END IF;
  IF v_order.qc_payout > 0 THEN
    INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by)
    VALUES (p_order_id, 'RELEASE', 'QC', v_order.qc_payout, v_order.currency, v_clerk_id);
  END IF;
  IF v_order.platform_commission > 0 THEN
    INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by)
    VALUES (p_order_id, 'RELEASE', 'PLATFORM', v_order.platform_commission, v_order.currency, v_clerk_id);
  END IF;

  UPDATE public.orders SET status = 'PAYOUT_RELEASED' WHERE id = p_order_id;

  PERFORM audit.log_event(
    'ESCROW_RELEASED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', 'CLOSED', 'to', 'PAYOUT_RELEASED',
                       'designer_payout', v_order.designer_payout,
                       'qc_payout', v_order.qc_payout,
                       'platform_commission', v_order.platform_commission)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PAYOUT_RELEASED',
                            'held', app.escrow_held(p_order_id));
END
$$;

-- FINANCE refunds the held funds to the client. Moves PAYMENT_HELD | DISPUTED -> REFUNDED.
CREATE OR REPLACE FUNCTION public.refund_escrow(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_order    public.orders%ROWTYPE;
  v_held     integer;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_role := app.current_user_role();
  IF v_role IS DISTINCT FROM 'FINANCE' THEN
    RAISE EXCEPTION 'only FINANCE may refund';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_order.status NOT IN ('PAYMENT_HELD', 'DISPUTED') THEN
    RAISE EXCEPTION 'can only refund a PAYMENT_HELD or DISPUTED order (is %)', v_order.status;
  END IF;

  v_held := app.escrow_held(p_order_id);
  IF v_held <= 0 THEN
    RAISE EXCEPTION 'nothing is held for this order';
  END IF;

  INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by)
  VALUES (p_order_id, 'REFUND', 'CLIENT', v_held, v_order.currency, v_clerk_id);

  UPDATE public.orders SET status = 'REFUNDED' WHERE id = p_order_id;

  PERFORM audit.log_event(
    'ESCROW_REFUNDED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_order.status, 'to', 'REFUNDED', 'amount', v_held)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'REFUNDED',
                            'held', app.escrow_held(p_order_id));
END
$$;

REVOKE ALL ON FUNCTION public.quote_order(text, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_escrow(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_escrow(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_escrow(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_order(text, integer, integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hold_escrow(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_escrow(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_escrow(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.escrow_held(text) TO authenticated, service_role;
