-- 0024_payout_execution.sql
-- Real money OUT. 0022 made funding real ("the processor confirms it, not the
-- client"); this does the same for the other direction.
--
-- THE SEPARATION THAT MATTERS. `escrow_ledger` records what we OWE — a RELEASE
-- leg is an obligation, written the moment FINANCE releases an order. `payouts`
-- records what we have SENT — one execution attempt per obligation, with a
-- status that tracks the processor's reality. Conflating the two is how a
-- platform ends up believing it paid someone because it wrote a row about it.
--
-- THE INVARIANT: one payout per RELEASE leg, forever. Enforced by a UNIQUE
-- constraint on ledger_id rather than by careful code, because the failure mode
-- is paying a designer twice out of platform funds, and every retry path in a
-- distributed payment system eventually re-runs the same instruction.
--
-- WHY PLATFORM LEGS GET NO ROW. The platform's commission is already in the
-- platform's account; there is nothing to send. Creating a "payout" for it
-- would model an outbound transfer that must never happen, and every executor
-- would then need a special case to skip it. Money still conserves: the ledger
-- accounts for the commission, this table only tracks transfers.
--
-- PROCESSOR-AGNOSTIC, like 0021 and 0022. Nothing here names Razorpay. The
-- integration supplies `processor_*` refs; the SQL only cares that they exist.

CREATE TABLE payouts (
  id                     text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id               text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  -- The obligation this executes. UNIQUE: a release leg is payable exactly once.
  ledger_id              text        NOT NULL UNIQUE
                                       REFERENCES escrow_ledger (id) ON DELETE RESTRICT,

  payee_id               text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  party                  text        NOT NULL CHECK (party IN ('DESIGNER', 'QC')),

  amount                 integer     NOT NULL CHECK (amount > 0),   -- minor units
  currency               text        NOT NULL,

  status                 text        NOT NULL DEFAULT 'PENDING'
                                       CHECK (status IN ('PENDING', 'PROCESSING', 'PAID',
                                                         'FAILED', 'REVERSED')),

  -- How many times we have handed this to the processor. A payout that keeps
  -- failing is an operational signal, not something to retry forever.
  attempts               integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),

  -- OUR key, not the processor's. Deterministic from the ledger leg, so a
  -- re-run of the executor produces the same key and can recognise its own
  -- earlier attempt at the processor (see reconcile-before-create in
  -- lib/razorpay/transfers.ts).
  idempotency_key        text        NOT NULL UNIQUE,

  -- The captured payment this transfer draws from. Route-style processors
  -- transfer OUT OF a specific payment, so the executor needs it to hand.
  source_payment_ref     text,

  -- Where it was sent, snapshotted at claim time. If the payee later changes
  -- their bank details, this still records where THIS money actually went.
  processor_account_ref  text,
  processor_transfer_ref text,

  failure_reason         text        CHECK (failure_reason IS NULL
                                            OR char_length(failure_reason) <= 500),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  paid_at                timestamptz,

  -- A terminal success must record where the money went, and a failure must
  -- say why — otherwise neither state can be acted on by a human.
  CONSTRAINT payouts_paid_has_ref CHECK (
    status <> 'PAID' OR (processor_transfer_ref IS NOT NULL AND paid_at IS NOT NULL)
  ),
  CONSTRAINT payouts_failed_has_reason CHECK (
    status <> 'FAILED' OR failure_reason IS NOT NULL
  )
);

CREATE INDEX payouts_order_idx  ON payouts (order_id);
CREATE INDEX payouts_payee_idx  ON payouts (payee_id, created_at DESC);
-- The executor's queue: what still needs sending, oldest first.
CREATE INDEX payouts_queue_idx  ON payouts (status, created_at) WHERE status IN ('PENDING', 'FAILED');

-- Same convention as every table since 0013: SELECT only, so default-deny RLS
-- is what stops reads (a locked door, not a missing one). No direct writes.
GRANT SELECT ON public.payouts TO anon, authenticated;
GRANT ALL    ON public.payouts TO service_role;

-- ------------------------------------------------------- deriving the work --

-- Turn an order's RELEASE legs into payout instructions. Idempotent: running it
-- twice produces nothing the second time, because ledger_id is UNIQUE.
--
-- Server-to-server only. This creates instructions to move real money, so it is
-- never reachable from a browser session — same rule as confirm_payment (0022).
CREATE OR REPLACE FUNCTION public.open_payouts_for_order(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_leg     record;
  v_payment text;
  v_acct    record;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  -- Payouts execute obligations. If nothing has been released there is no
  -- obligation, and creating rows here would let money leave ahead of the
  -- ledger entry that authorises it.
  IF NOT EXISTS (
    SELECT 1 FROM public.escrow_ledger WHERE order_id = p_order_id AND kind = 'RELEASE'
  ) THEN
    RAISE EXCEPTION 'nothing has been released for this order';
  END IF;

  -- The payment these transfers draw from.
  SELECT external_ref INTO v_payment
  FROM public.escrow_ledger
  WHERE order_id = p_order_id AND kind = 'HOLD' AND external_ref IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  FOR v_leg IN
    SELECT l.id, l.party, l.amount, l.currency, l.payee_id
    FROM public.escrow_ledger l
    WHERE l.order_id = p_order_id
      AND l.kind = 'RELEASE'
      -- PLATFORM legs are not transfers: that money is already ours.
      AND l.party IN ('DESIGNER', 'QC')
    ORDER BY l.created_at
  LOOP
    IF EXISTS (SELECT 1 FROM public.payouts WHERE ledger_id = v_leg.id) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_leg.payee_id IS NULL THEN
      RAISE EXCEPTION 'release leg % has no payee', v_leg.id;
    END IF;

    -- Re-checked here even though release_escrow (0023) already gated it: this
    -- function is a separate door to the same money, and the account could have
    -- been changed or rejected between release and execution.
    SELECT status, processor_account_ref INTO v_acct
    FROM public.payout_accounts WHERE user_id = v_leg.payee_id;
    IF NOT FOUND OR v_acct.status <> 'VERIFIED' THEN
      RAISE EXCEPTION 'payee % has no verified payout account', v_leg.payee_id;
    END IF;

    INSERT INTO public.payouts
      (order_id, ledger_id, payee_id, party, amount, currency,
       idempotency_key, source_payment_ref, processor_account_ref)
    VALUES
      (p_order_id, v_leg.id, v_leg.payee_id, v_leg.party, v_leg.amount, v_leg.currency,
       'payout:' || v_leg.id, v_payment, v_acct.processor_account_ref);

    v_created := v_created + 1;
  END LOOP;

  IF v_created > 0 THEN
    PERFORM audit.log_event(
      'PAYOUTS_OPENED', 'order', p_order_id, NULL, NULL,
      jsonb_build_object('created', v_created, 'skipped', v_skipped)
    );
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'created', v_created, 'skipped', v_skipped);
END
$$;

REVOKE ALL ON FUNCTION public.open_payouts_for_order(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_payouts_for_order(text) TO service_role;

-- ------------------------------------------------------------ the executor --

-- Atomically take the next batch of work. SKIP LOCKED so two executors running
-- at once take DIFFERENT rows rather than blocking or, worse, both sending the
-- same transfer.
--
-- Claiming flips the row to PROCESSING and bumps `attempts` in the SAME
-- statement that hands it out, so a crash mid-send leaves evidence that an
-- attempt happened. That row will not be re-claimed automatically; it needs a
-- human or a reconciliation pass, which is the correct default when the
-- alternative is a possible double payment.
CREATE OR REPLACE FUNCTION public.claim_payouts(p_limit integer DEFAULT 10)
RETURNS SETOF public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'limit must be between 1 and 100';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.payouts
    WHERE status IN ('PENDING', 'FAILED')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.payouts p
  SET status = 'PROCESSING',
      attempts = p.attempts + 1,
      failure_reason = NULL,
      updated_at = now()
  FROM claimed c
  WHERE p.id = c.id
  RETURNING p.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_payouts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_payouts(integer) TO service_role;

-- Instructions stuck in flight.
--
-- A payout goes PROCESSING the moment it is claimed. If the executor then dies
-- between the HTTP call and recording the result, the row stays PROCESSING
-- forever: claim_payouts deliberately will not pick it up again, because a
-- transfer MAY already be in flight and re-sending it would pay twice.
--
-- That is the safe state, but it is not a resting state. This is how an
-- operator (or the reconcile pass in lib/payouts/execute.ts) finds those rows
-- and asks the processor what actually happened. The age threshold exists so a
-- reconcile running alongside a normal payout run does not fight over
-- instructions that are merely a few seconds old.
CREATE OR REPLACE FUNCTION public.stale_payouts(p_minutes integer DEFAULT 15)
RETURNS SETOF public.payouts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.payouts
  WHERE status = 'PROCESSING'
    AND updated_at < now() - (least(greatest(coalesce(p_minutes, 15), 0), 10080) * interval '1 minute')
  ORDER BY updated_at;
$$;

REVOKE ALL ON FUNCTION public.stale_payouts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stale_payouts(integer) TO service_role;

-- Record what the processor actually did.
--
-- PAID and FAILED are both idempotent against redelivery: a webhook that
-- arrives twice finds the row already terminal and returns without rewriting
-- it. REVERSED is the money-bearing one — the transfer succeeded and then came
-- back — so it writes a REVERSAL leg, putting the funds back into escrow where
-- they can be re-released or refunded.
CREATE OR REPLACE FUNCTION public.record_payout_result(
  p_idempotency_key text,
  p_status          text,
  p_transfer_ref    text DEFAULT NULL,
  p_failure_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payout       public.payouts%ROWTYPE;
  v_transfer_ref text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('PAID', 'FAILED', 'REVERSED') THEN
    RAISE EXCEPTION 'payout result must be PAID, FAILED or REVERSED';
  END IF;

  SELECT * INTO v_payout FROM public.payouts
    WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payout for key %', p_idempotency_key;
  END IF;

  -- Already settled this way: a redelivered event is a no-op, not a failure.
  IF v_payout.status = p_status THEN
    RETURN jsonb_build_object('payout_id', v_payout.id, 'status', p_status, 'applied', false);
  END IF;

  IF p_status = 'PAID' THEN
    IF v_payout.status = 'REVERSED' THEN
      RAISE EXCEPTION 'payout % was reversed and cannot be marked paid again', v_payout.id;
    END IF;
    IF p_transfer_ref IS NULL OR btrim(p_transfer_ref) = '' THEN
      RAISE EXCEPTION 'a successful payout must record the processor reference';
    END IF;
    UPDATE public.payouts
    SET status = 'PAID',
        processor_transfer_ref = btrim(p_transfer_ref),
        failure_reason = NULL,
        paid_at = now(),
        updated_at = now()
    WHERE id = v_payout.id;

  ELSIF p_status = 'FAILED' THEN
    IF v_payout.status IN ('PAID', 'REVERSED') THEN
      RAISE EXCEPTION 'payout % is already settled (%)', v_payout.id, v_payout.status;
    END IF;
    IF btrim(coalesce(p_failure_reason, '')) = '' THEN
      RAISE EXCEPTION 'a failed payout must record why';
    END IF;
    -- Left in FAILED, which claim_payouts picks up again: a transfer that never
    -- left is safe to retry, and the alternative is a designer never paid.
    UPDATE public.payouts
    SET status = 'FAILED',
        failure_reason = btrim(p_failure_reason),
        updated_at = now()
    WHERE id = v_payout.id;

  ELSE -- REVERSED
    -- PROCESSING is accepted, not just PAID. A transfer can be created, settle,
    -- and be reversed before our own `transfer.processed` webhook lands (or
    -- while an executor is crashed mid-run). Refusing that ordering would make
    -- the reversal webhook 500 forever, and Razorpay retries non-2xx — an
    -- infinite loop over an event we genuinely need to record.
    --
    -- PENDING and FAILED are still refused: nothing ever left, so there is
    -- nothing to come back, and crediting escrow would invent money.
    IF v_payout.status NOT IN ('PAID', 'PROCESSING') THEN
      RAISE EXCEPTION 'only a sent payout can be reversed (payout % is %)',
        v_payout.id, v_payout.status;
    END IF;
    UPDATE public.payouts
    SET status = 'REVERSED',
        processor_transfer_ref = coalesce(btrim(p_transfer_ref), processor_transfer_ref),
        failure_reason = btrim(coalesce(p_failure_reason, 'reversed by processor')),
        updated_at = now()
    WHERE id = v_payout.id
    RETURNING processor_transfer_ref INTO v_transfer_ref;

    -- The money genuinely came back, so the ledger must say so. Keyed off the
    -- payout so a redelivered reversal cannot credit escrow twice.
    INSERT INTO public.escrow_ledger
      (order_id, kind, party, amount, currency, payee_id, external_ref, idempotency_key)
    VALUES
      (v_payout.order_id, 'REVERSAL', v_payout.party, v_payout.amount, v_payout.currency,
       v_payout.payee_id, v_transfer_ref,
       'reversal:' || v_payout.idempotency_key)
    -- The unique index from 0021 is PARTIAL, so the conflict target has to
    -- repeat its predicate or Postgres cannot match it to an arbiter index.
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;

  PERFORM audit.log_event(
    'PAYOUT_' || p_status, 'payout', v_payout.id, NULL, NULL,
    jsonb_build_object('order_id', v_payout.order_id, 'party', v_payout.party,
                       'amount', v_payout.amount, 'from', v_payout.status)
  );

  RETURN jsonb_build_object('payout_id', v_payout.id, 'status', p_status, 'applied', true);
END
$$;

REVOKE ALL ON FUNCTION public.record_payout_result(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payout_result(text, text, text, text) TO service_role;

-- ---------------------------------------------------------------- read path --

-- What a payee can see about their own money. Deliberately excludes every
-- processor reference and the account it was sent to: a designer needs to know
-- an amount, a state and a date, not our integration's internals.
CREATE OR REPLACE FUNCTION public.my_payouts(p_limit integer DEFAULT 50)
RETURNS TABLE (
  order_id   text,
  party      text,
  amount     integer,
  currency   text,
  status     text,
  created_at timestamptz,
  paid_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  RETURN QUERY
  SELECT p.order_id, p.party, p.amount, p.currency, p.status, p.created_at, p.paid_at
  FROM public.payouts p
  WHERE p.payee_id = v_clerk_id
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END
$$;

REVOKE ALL ON FUNCTION public.my_payouts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_payouts(integer) TO authenticated, service_role;

-- Operational view for reconciliation: what an order owes versus what has
-- actually been sent. The two disagreeing is the single most important thing
-- to be able to see, and deriving it beats storing a summary that can rot.
CREATE OR REPLACE FUNCTION public.payout_state(p_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'order_id', p_order_id,
    'owed', coalesce((
      SELECT sum(amount)::integer FROM public.escrow_ledger
      WHERE order_id = p_order_id AND kind = 'RELEASE' AND party IN ('DESIGNER', 'QC')
    ), 0),
    'paid', coalesce((
      SELECT sum(amount)::integer FROM public.payouts
      WHERE order_id = p_order_id AND status = 'PAID'
    ), 0),
    'in_flight', coalesce((
      SELECT sum(amount)::integer FROM public.payouts
      WHERE order_id = p_order_id AND status IN ('PENDING', 'PROCESSING')
    ), 0),
    'failed', coalesce((
      SELECT sum(amount)::integer FROM public.payouts
      WHERE order_id = p_order_id AND status = 'FAILED'
    ), 0),
    'reversed', coalesce((
      SELECT sum(amount)::integer FROM public.payouts
      WHERE order_id = p_order_id AND status = 'REVERSED'
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.payout_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payout_state(text) TO service_role;
