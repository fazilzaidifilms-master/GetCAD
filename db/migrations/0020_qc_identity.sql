-- 0020_qc_identity.sql
-- Makes independent QC a REAL constraint instead of a convention.
--
-- Three defects this closes, all found by audit:
--
--   1. NO REVIEWER WAS EVER RECORDED. `orders` had client_id and designer_id
--      but no QC column at all, so "reviewed by someone who did not design it"
--      was a claim with nothing behind it.
--
--   2. NOTHING PREVENTED SELF-REVIEW. QC transitions were gated only on
--      actor_role = 'QC'; STAFF-scope moves skip the party check entirely. The
--      only thing stopping a designer reviewing their own work was the accident
--      that users.role holds a single value — not a rule, and it does not
--      survive one person holding two accounts.
--
--   3. THE QC PAYOUT HAD NO PAYEE. release_escrow wrote a RELEASE leg to
--      party='QC' with no record of WHICH reviewer earned it. That is an
--      unattributable payout obligation sitting in the money ledger.
--
-- MODEL: claim-on-action, not pre-assignment. QC stays a pool — whoever is free
-- picks up the queue — but the reviewer is recorded at the moment they decide,
-- and independence is checked then. This adds attribution without adding an
-- assignment bottleneck, and pre-assignment can be layered on later without
-- reworking any of it.

-- Who actually performed the QC review. Nullable: an order has no reviewer
-- until one acts. Opaque FK, exactly like client_id/designer_id — this adds no
-- identity to the orders table.
ALTER TABLE orders
  ADD COLUMN qc_reviewer_id text REFERENCES users (id) ON DELETE RESTRICT;

CREATE INDEX orders_qc_reviewer_idx ON orders (qc_reviewer_id);

-- Who a money movement is FOR. `created_by` records who pushed the button
-- (FINANCE); it never said who gets paid. Nullable because PLATFORM legs and
-- client refunds have no individual payee.
ALTER TABLE escrow_ledger
  ADD COLUMN payee_id text REFERENCES users (id) ON DELETE RESTRICT;

-- The QC decision, pulled OUT of the generic transition_order — the same
-- pattern the money layer (0012) and disputes (0014) already follow: when a
-- transition must capture more than "status changed", it gets its own function
-- and transition_order refuses to perform it.
CREATE OR REPLACE FUNCTION public.record_qc_decision(
  p_order_id text,
  p_outcome  text,               -- 'PASS' | 'REVISION'
  p_notes    text DEFAULT NULL
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
  v_to       public.order_status;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  v_role := app.current_user_role();
  IF v_role IS DISTINCT FROM 'QC' THEN
    RAISE EXCEPTION 'only QC may record a review decision';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('PASS', 'REVISION') THEN
    RAISE EXCEPTION 'outcome must be PASS or REVISION';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  IF v_order.status <> 'QC_REVIEW' THEN
    RAISE EXCEPTION 'can only review an order in QC_REVIEW (is %)', v_order.status;
  END IF;

  -- INDEPENDENCE. The whole product claim rests on this line: the reviewer must
  -- not be the person who produced the work, nor the party who ordered it.
  IF v_order.designer_id IS NOT DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'independent QC: you cannot review work you produced';
  END IF;
  IF v_order.client_id IS NOT DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'independent QC: you cannot review your own order';
  END IF;

  v_to := CASE p_outcome WHEN 'PASS' THEN 'CLIENT_PREVIEW' ELSE 'REVISION_REQUESTED' END;

  UPDATE public.orders
    SET status = v_to, qc_reviewer_id = v_clerk_id
    WHERE id = p_order_id;

  -- Logged as an ordinary status change so the existing client-safe timeline
  -- (0016) and notification fan-out (0015) pick it up unchanged. The reviewer's
  -- id is NOT in the payload — only actor_role travels to the client.
  PERFORM audit.log_event(
    'ORDER_STATUS_CHANGED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_order.status, 'to', v_to, 'qc_outcome', p_outcome)
      || CASE WHEN p_notes IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('notes', p_notes) END
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'from', v_order.status, 'to', v_to);
END
$$;

-- Reissue transition_order with the QC guard added (carrying forward the 0009
-- designer gate, the 0012 money guard and the 0014 dispute guards).
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

  -- A QC decision must record WHO reviewed, and be checked for independence.
  IF v_order.status = 'QC_REVIEW'
     AND p_new_status IN ('CLIENT_PREVIEW', 'REVISION_REQUESTED') THEN
    RAISE EXCEPTION 'a QC decision must be recorded via record_qc_decision()';
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
    -- A designer may not be handed work they are already the reviewer of.
    IF v_order.qc_reviewer_id IS NOT DISTINCT FROM v_designer THEN
      RAISE EXCEPTION 'independent QC: cannot assign the order to its own reviewer';
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

-- Reissue release_escrow so every payout leg records WHO it is for, and so a
-- QC payout can never be released to nobody.
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

  -- Every payout must have someone to pay. Releasing to an unknown payee is how
  -- money goes missing.
  IF v_order.designer_payout > 0 AND v_order.designer_id IS NULL THEN
    RAISE EXCEPTION 'cannot release a designer payout: no designer is assigned';
  END IF;
  IF v_order.qc_payout > 0 AND v_order.qc_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'cannot release a QC payout: no reviewer is recorded for this order';
  END IF;

  IF v_order.designer_payout > 0 THEN
    INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by, payee_id)
    VALUES (p_order_id, 'RELEASE', 'DESIGNER', v_order.designer_payout, v_order.currency,
            v_clerk_id, v_order.designer_id);
  END IF;
  IF v_order.qc_payout > 0 THEN
    INSERT INTO public.escrow_ledger (order_id, kind, party, amount, currency, created_by, payee_id)
    VALUES (p_order_id, 'RELEASE', 'QC', v_order.qc_payout, v_order.currency,
            v_clerk_id, v_order.qc_reviewer_id);
  END IF;
  IF v_order.platform_commission > 0 THEN
    -- The platform is not a user row, so this leg has no individual payee.
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

REVOKE ALL ON FUNCTION public.record_qc_decision(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_qc_decision(text, text, text) TO authenticated, service_role;
