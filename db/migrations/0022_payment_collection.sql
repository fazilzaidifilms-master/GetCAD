-- 0022_payment_collection.sql
-- Real money in. Until now `hold_escrow()` was a button: the CLIENT called it
-- and the ledger recorded a HOLD, with no payment behind it. That was fine
-- while the money layer was a simulation. The moment a processor exists it is
-- a hole — a client could fund their own order for free.
--
-- So: funding moves from "the client asserts it" to "the processor confirms
-- it". hold_escrow is revoked from `authenticated` and becomes internal;
-- confirm_payment() is the new door, and only the trusted server (which has
-- verified an HMAC signature from Razorpay) can open it.
--
-- Still PROCESSOR-AGNOSTIC at the SQL layer: nothing here mentions Razorpay.
-- The function takes an external reference and an idempotency key; which
-- processor produced them is the app layer's business.

-- ------------------------------------------------------------------- intent --

-- A payment we have STARTED but not yet confirmed. Created when the client
-- opens checkout; resolved (or abandoned) when the webhook arrives.
--
-- This exists so a confirmation can be validated against something we recorded
-- BEFORE the client touched the processor. Without it we would have to trust
-- the amount the webhook reports, which is the one number an attacker would
-- most like to choose.
CREATE TABLE payment_intents (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id     text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  -- The processor's order/intent id (Razorpay `order_xxx`).
  external_ref text        NOT NULL UNIQUE,
  amount       integer     NOT NULL CHECK (amount > 0),   -- minor units
  currency     text        NOT NULL,
  status       text        NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX payment_intents_order_idx ON payment_intents (order_id, created_at DESC);

-- ------------------------------------------------------- open a collection --

-- Record that we are about to collect. Server-only: the amount comes from the
-- ORDER, never from the caller, so a client cannot ask to pay less than quoted.
CREATE OR REPLACE FUNCTION public.open_payment_intent(
  p_order_id     text,
  p_external_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_id    text;
BEGIN
  IF p_external_ref IS NULL OR btrim(p_external_ref) = '' THEN
    RAISE EXCEPTION 'an external reference is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_order.status <> 'QUOTED' THEN
    RAISE EXCEPTION 'can only collect payment for a QUOTED order (is %)', v_order.status;
  END IF;
  IF v_order.price_total <= 0 THEN
    RAISE EXCEPTION 'order has no positive price to collect';
  END IF;

  INSERT INTO public.payment_intents (order_id, external_ref, amount, currency)
  VALUES (p_order_id, btrim(p_external_ref), v_order.price_total, v_order.currency)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('intent_id', v_id, 'amount', v_order.price_total,
                            'currency', v_order.currency);
END
$$;

-- ------------------------------------------------------ confirm a payment --

-- The webhook's door. Called ONLY by the trusted server, and only after it has
-- verified the processor's signature over the raw request body.
--
-- Three checks stand between a webhook and the ledger:
--   1. the intent must exist (we opened this collection ourselves),
--   2. the amount must match what we recorded — not what the webhook claims,
--   3. the idempotency key must be new (redelivery is normal, not an error).
CREATE OR REPLACE FUNCTION public.confirm_payment(
  p_external_ref     text,
  p_amount           integer,
  p_currency         text,
  p_idempotency_key  text,
  p_payment_ref      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_order  public.orders%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'an idempotency key is required';
  END IF;

  SELECT * INTO v_intent FROM public.payment_intents
    WHERE external_ref = p_external_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payment intent for external reference %', p_external_ref;
  END IF;

  -- Already handled: a redelivered webhook is a no-op, not a failure.
  IF v_intent.status = 'CONFIRMED' THEN
    RETURN jsonb_build_object('order_id', v_intent.order_id, 'already_confirmed', true,
                              'held', app.escrow_held(v_intent.order_id));
  END IF;

  -- The processor must have collected exactly what we asked for. A short
  -- payment is not a partial success; it is a mismatch we refuse to settle.
  IF p_amount IS DISTINCT FROM v_intent.amount THEN
    RAISE EXCEPTION 'payment amount % does not match the intent amount %',
      p_amount, v_intent.amount;
  END IF;
  IF upper(coalesce(p_currency, '')) IS DISTINCT FROM upper(v_intent.currency) THEN
    RAISE EXCEPTION 'payment currency % does not match the intent currency %',
      p_currency, v_intent.currency;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_intent.order_id FOR UPDATE;
  IF v_order.status <> 'QUOTED' THEN
    RAISE EXCEPTION 'order % is no longer awaiting payment (is %)', v_order.id, v_order.status;
  END IF;

  INSERT INTO public.escrow_ledger
    (order_id, kind, party, amount, currency, created_by, payee_id,
     external_ref, idempotency_key)
  VALUES
    (v_intent.order_id, 'HOLD', 'CLIENT', v_intent.amount, v_intent.currency,
     NULL, v_order.client_id, coalesce(p_payment_ref, p_external_ref), btrim(p_idempotency_key));

  UPDATE public.payment_intents
    SET status = 'CONFIRMED', confirmed_at = now()
    WHERE id = v_intent.id;

  UPDATE public.orders SET status = 'PAYMENT_HELD' WHERE id = v_intent.order_id;

  PERFORM audit.log_event(
    'ESCROW_HELD', 'order', v_intent.order_id, NULL, NULL,
    jsonb_build_object('from', 'QUOTED', 'to', 'PAYMENT_HELD',
                       'amount', v_intent.amount, 'external_ref', p_external_ref)
  );

  RETURN jsonb_build_object('order_id', v_intent.order_id, 'already_confirmed', false,
                            'held', app.escrow_held(v_intent.order_id));
END
$$;

-- Mark a collection attempt failed (payment.failed webhook). Purely
-- informational — no money moved, so nothing touches the ledger or the order.
CREATE OR REPLACE FUNCTION public.fail_payment_intent(p_external_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.payment_intents
    SET status = 'FAILED'
    WHERE external_ref = p_external_ref AND status = 'PENDING';
  RETURN jsonb_build_object('external_ref', p_external_ref, 'status', 'FAILED');
END
$$;

-- ------------------------------------------------------------------ grants --

-- THE SECURITY CHANGE: a client can no longer declare their own order funded.
-- hold_escrow stays for internal/administrative use but leaves the client's
-- reach entirely; confirm_payment (behind a verified signature) replaces it.
REVOKE EXECUTE ON FUNCTION public.hold_escrow(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.open_payment_intent(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment(text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_payment_intent(text) FROM PUBLIC;

-- Server-to-server only. Every one of these runs behind a verified signature
-- or a server-side authorization check; none is ever called from a browser.
GRANT EXECUTE ON FUNCTION public.open_payment_intent(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payment(text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payment_intent(text) TO service_role;
