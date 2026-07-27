-- 0021_settlement_ledger.sql
-- Prepares the money layer for a real payment processor. Deliberately
-- PROCESSOR-AGNOSTIC: nothing here names Stripe or Razorpay. The integration
-- slice supplies external ids; this slice makes the ledger able to hold them
-- and able to express what actually happens to money in the wild.
--
-- What the ledger could not represent before, and now can:
--
--   RECONCILIATION — no way to tie a row to the processor's object, so a
--   webhook could not be matched to a ledger entry. Adds external_ref.
--
--   RETRY SAFETY — processors deliver webhooks more than once. Without a
--   dedupe key, a redelivered "payout succeeded" would write a second leg and
--   silently double-count. Adds a UNIQUE idempotency_key.
--
--   REAL-WORLD EVENTS — kind was HOLD/RELEASE/REFUND only. A chargeback, a
--   failed-and-returned payout, or the processor's own fee had nowhere to go.
--
--   PARTIAL REFUNDS — refund_escrow refunded the entire held amount and took no
--   amount at all, so "refund half" was impossible. Now optional-amount.
--
--   POST-TERMINAL MONEY — a chargeback arrives AFTER an order is finished.
--   Money events no longer require an order status change, so the ledger can
--   record what happened without inventing a new lifecycle state.
--
--   CONSERVATION AS A RULE — "money is conserved" lived only inside the escrow
--   functions. Any other write path (a service-role script, a future webhook
--   handler) could violate it. Now enforced by a trigger on the table itself.

-- ---------------------------------------------------------------- columns --

ALTER TABLE escrow_ledger
  -- The processor's own id for this movement (payment intent, transfer,
  -- refund, dispute). Opaque to us; used for reconciliation and support.
  ADD COLUMN external_ref text,
  -- Dedupe key for at-least-once webhook delivery. UNIQUE, so a redelivered
  -- event fails its INSERT instead of double-counting.
  ADD COLUMN idempotency_key text,
  -- Rate used if this movement crossed currencies. NULL under single-currency
  -- operation; present so multi-currency does not need a ledger rewrite.
  ADD COLUMN fx_rate numeric(18, 8) CHECK (fx_rate IS NULL OR fx_rate > 0);

CREATE UNIQUE INDEX escrow_ledger_idempotency_idx
  ON escrow_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX escrow_ledger_external_ref_idx
  ON escrow_ledger (external_ref)
  WHERE external_ref IS NOT NULL;

-- ------------------------------------------------------------------ kinds --

ALTER TABLE escrow_ledger DROP CONSTRAINT escrow_ledger_kind_check;
ALTER TABLE escrow_ledger ADD CONSTRAINT escrow_ledger_kind_check CHECK (
  kind IN (
    'HOLD',           -- client funds land in escrow                    (+)
    'RELEASE',        -- funds paid out to a party                      (-)
    'REFUND',         -- funds returned to the client                   (-)
    'PROCESSOR_FEE',  -- the processor's cut                            (-)
    'CHARGEBACK',     -- the client's bank claws funds back             (-)
    'REVERSAL'        -- a RELEASE/REFUND that failed and came back     (+)
  )
);

ALTER TABLE escrow_ledger DROP CONSTRAINT escrow_ledger_party_check;
ALTER TABLE escrow_ledger ADD CONSTRAINT escrow_ledger_party_check CHECK (
  party IN ('CLIENT', 'DESIGNER', 'QC', 'PLATFORM', 'PROCESSOR')
);

-- The one HOLD per order rule no longer holds: a failed capture may need
-- re-authorisation. Replaced by "at most one SUCCESSFUL hold at a time", which
-- the conservation trigger enforces via the running balance.
DROP INDEX IF EXISTS escrow_ledger_one_hold;

-- --------------------------------------------------------------- the math --

-- Direction of each kind, in ONE place. The old inline
--   CASE kind WHEN 'HOLD' THEN amount ELSE -amount END
-- was a trap: every kind added later would silently subtract. A kind with no
-- entry here raises rather than guessing.
CREATE OR REPLACE FUNCTION app.escrow_sign(p_kind text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN CASE p_kind
    WHEN 'HOLD'          THEN  1
    WHEN 'REVERSAL'      THEN  1
    WHEN 'RELEASE'       THEN -1
    WHEN 'REFUND'        THEN -1
    WHEN 'PROCESSOR_FEE' THEN -1
    WHEN 'CHARGEBACK'    THEN -1
    ELSE NULL
  END;
END
$$;

CREATE OR REPLACE FUNCTION app.escrow_held(p_order_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(sum(app.escrow_sign(kind) * amount), 0)::integer
  FROM public.escrow_ledger
  WHERE order_id = p_order_id
$$;

-- CONSERVATION, enforced by the table rather than by the functions that write
-- to it. You cannot take out more than went in — by any write path, including
-- service-role scripts and future webhook handlers.
CREATE OR REPLACE FUNCTION app.enforce_escrow_conservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sign integer;
  v_held integer;
BEGIN
  v_sign := app.escrow_sign(NEW.kind);
  IF v_sign IS NULL THEN
    RAISE EXCEPTION 'escrow_ledger: unknown kind % has no defined direction', NEW.kind;
  END IF;

  -- Serialise per order so two concurrent debits cannot both see enough funds.
  PERFORM pg_advisory_xact_lock(hashtext('escrow_ledger:' || NEW.order_id));

  v_held := app.escrow_held(NEW.order_id);

  IF v_sign < 0 AND NEW.amount > v_held THEN
    RAISE EXCEPTION 'escrow conservation: cannot take % out of order % which holds %',
      NEW.amount, NEW.order_id, v_held;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER escrow_ledger_conservation
  BEFORE INSERT ON escrow_ledger
  FOR EACH ROW EXECUTE FUNCTION app.enforce_escrow_conservation();

-- ------------------------------------------------------- settlement state --

-- The TRUTH about an order's money, derived from the ledger rather than
-- duplicated into order_status.
--
-- This is the honest answer to a real modelling problem: order_status conflates
-- fulfilment with settlement (PAYMENT_HELD / PAYOUT_RELEASED / REFUNDED are
-- money facts wearing a lifecycle costume), and it cannot express a chargeback
-- after an order closed. Rather than rewrite the whole state machine — a large,
-- risky change touching every transition, screen and test — settlement is now
-- DERIVED here, and the ledger is authoritative when the two disagree.
CREATE OR REPLACE FUNCTION public.settlement_state(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH legs AS (
    SELECT kind, amount FROM public.escrow_ledger WHERE order_id = p_order_id
  ), totals AS (
    SELECT
      coalesce(sum(amount) FILTER (WHERE kind = 'HOLD'), 0)::integer          AS funded,
      coalesce(sum(amount) FILTER (WHERE kind = 'RELEASE'), 0)::integer       AS released,
      coalesce(sum(amount) FILTER (WHERE kind = 'REFUND'), 0)::integer        AS refunded,
      coalesce(sum(amount) FILTER (WHERE kind = 'PROCESSOR_FEE'), 0)::integer AS fees,
      coalesce(sum(amount) FILTER (WHERE kind = 'CHARGEBACK'), 0)::integer    AS charged_back,
      coalesce(sum(amount) FILTER (WHERE kind = 'REVERSAL'), 0)::integer      AS reversed
    FROM legs
  )
  SELECT jsonb_build_object(
    'held',         app.escrow_held(p_order_id),
    'funded',       t.funded,
    'released',     t.released,
    'refunded',     t.refunded,
    'fees',         t.fees,
    'charged_back', t.charged_back,
    'reversed',     t.reversed,
    'state', CASE
      WHEN t.charged_back > 0                        THEN 'CHARGED_BACK'
      WHEN t.funded = 0                              THEN 'UNFUNDED'
      WHEN app.escrow_held(p_order_id) > 0
           AND t.refunded > 0                        THEN 'PARTIALLY_REFUNDED'
      WHEN app.escrow_held(p_order_id) > 0           THEN 'HELD'
      WHEN t.refunded > 0 AND t.released = 0         THEN 'REFUNDED'
      WHEN t.released > 0 AND t.refunded > 0         THEN 'SETTLED_WITH_REFUND'
      ELSE 'SETTLED'
    END
  )
  FROM totals t
$$;

-- --------------------------------------------------------- partial refund --

-- The single-argument version must GO, not merely be replaced: adding an
-- optional second parameter creates an OVERLOAD, and refund_escrow($1) would
-- then be ambiguous — breaking resolve_dispute() and the app's RPC call.
DROP FUNCTION IF EXISTS public.refund_escrow(text);

-- refund_escrow now takes an OPTIONAL amount. NULL keeps the old behaviour
-- (refund everything held); a smaller amount is a genuine partial refund, which
-- a dispute resolved as "return half" needs and which was previously
-- impossible. The order only reaches REFUNDED when nothing is left held.
CREATE OR REPLACE FUNCTION public.refund_escrow(
  p_order_id text,
  p_amount   integer DEFAULT NULL
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
  v_held     integer;
  v_amount   integer;
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

  v_amount := coalesce(p_amount, v_held);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'refund amount must be positive';
  END IF;
  IF v_amount > v_held THEN
    RAISE EXCEPTION 'cannot refund % — only % is held', v_amount, v_held;
  END IF;

  INSERT INTO public.escrow_ledger
    (order_id, kind, party, amount, currency, created_by, payee_id)
  VALUES
    (p_order_id, 'REFUND', 'CLIENT', v_amount, v_order.currency, v_clerk_id, v_order.client_id);

  -- Only a refund that empties escrow ends the order as REFUNDED; a partial one
  -- leaves it where it was, with funds still held for the remaining work.
  IF app.escrow_held(p_order_id) = 0 THEN
    UPDATE public.orders SET status = 'REFUNDED' WHERE id = p_order_id;
  END IF;

  PERFORM audit.log_event(
    'ESCROW_REFUNDED', 'order', p_order_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_order.status, 'amount', v_amount,
                       'partial', app.escrow_held(p_order_id) > 0,
                       'to', CASE WHEN app.escrow_held(p_order_id) = 0
                                  THEN 'REFUNDED' ELSE v_order.status::text END)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'refunded', v_amount,
                            'held', app.escrow_held(p_order_id));
END
$$;

-- ------------------------------------------- processor-driven money events --

-- The single entry point for money events that originate at the PROCESSOR
-- rather than at a person: fees, chargebacks, and reversals of failed payouts.
--
-- Callable only by service_role — this is the webhook handler's door, not a
-- user action. Idempotency is enforced by the UNIQUE index: a redelivered
-- event raises unique_violation, which the caller treats as "already applied".
--
-- Deliberately does NOT change order_status. A chargeback can arrive long after
-- an order is CLOSED or PAYOUT_RELEASED; forcing a lifecycle change would
-- corrupt fulfilment history to describe a money fact. settlement_state()
-- reports the truth instead.
CREATE OR REPLACE FUNCTION public.record_settlement_event(
  p_order_id        text,
  p_kind            text,
  p_amount          integer,
  p_idempotency_key text,
  p_external_ref    text DEFAULT NULL,
  p_payee_id        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_party  text;
BEGIN
  IF p_kind NOT IN ('PROCESSOR_FEE', 'CHARGEBACK', 'REVERSAL') THEN
    RAISE EXCEPTION 'record_settlement_event handles PROCESSOR_FEE, CHARGEBACK and REVERSAL only';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'an idempotency key is required for processor-driven events';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  v_party := CASE p_kind
    WHEN 'PROCESSOR_FEE' THEN 'PROCESSOR'
    WHEN 'CHARGEBACK'    THEN 'CLIENT'
    ELSE 'PLATFORM'
  END;

  INSERT INTO public.escrow_ledger
    (order_id, kind, party, amount, currency, created_by, payee_id,
     external_ref, idempotency_key)
  VALUES
    (p_order_id, p_kind, v_party, p_amount, v_order.currency, NULL, p_payee_id,
     p_external_ref, btrim(p_idempotency_key));

  PERFORM audit.log_event(
    'SETTLEMENT_EVENT', 'order', p_order_id, NULL, NULL,
    jsonb_build_object('kind', p_kind, 'amount', p_amount, 'external_ref', p_external_ref)
  );

  RETURN jsonb_build_object('order_id', p_order_id, 'kind', p_kind,
                            'held', app.escrow_held(p_order_id),
                            'settlement', public.settlement_state(p_order_id));
END
$$;

-- ------------------------------------------------------------------ grants --

REVOKE ALL ON FUNCTION public.refund_escrow(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_escrow(text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settlement_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settlement_state(text) TO authenticated, service_role;

-- Processor events are server-to-server only: never a user action.
REVOKE ALL ON FUNCTION public.record_settlement_event(text, text, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_settlement_event(text, text, integer, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION app.escrow_sign(text) TO authenticated, service_role;
