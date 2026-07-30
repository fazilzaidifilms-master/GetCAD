-- 0027_lifecycle_emails.sql
-- Close the loop the platform still left open: an applicant now hears the
-- DECISION on their application, and a designer hears when a payout is on its
-- way. Both reuse the outbox (0025) — enqueue transactionally with the event,
-- drain separately — so a mail-provider outage can't turn a review or a payout
-- into a lost email.
--
-- ANONYMITY. Both emails are to a person about their OWN thing: an application
-- they filed, a payout owed to them. There is no counterparty, and the payloads
-- carry only the recipient's own name (or nothing). The order reference on a
-- payout email is an opaque id the payee already sees on their payouts page.
--
-- DELIBERATELY NOT HERE: emailing a designer that a payout FAILED. A failure is
-- usually a transient the worker retries, and "your payout failed" would alarm
-- someone about a problem that is already being handled. When a failure needs
-- the payee to act (e.g. a beneficiary-name mismatch), that is a distinct,
-- action-carrying message for a later slice — not a raw failure ping.

-- Allow the new templates the renderer (core/email) now knows how to build.
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_template_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_template_check CHECK (template IN (
  'DESIGNER_APPLICATION_RECEIVED',
  'CONTACT_RECEIVED',
  'DESIGNER_APPLICATION_ACCEPTED',
  'DESIGNER_APPLICATION_REJECTED',
  'PAYOUT_SENT'
));

-- ------------------------------------------- application decision -> email --

-- Redefined from 0026 (body carried forward verbatim) with one enqueue added:
-- an ACCEPTED/REJECTED decision emails the applicant. A move back to
-- PENDING_REVIEW (reopening) sends nothing — that is an internal correction,
-- not something to notify a person about.
CREATE OR REPLACE FUNCTION public.review_designer_application(
  p_id       text,
  p_decision text,
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
  v_app      public.designer_applications%ROWTYPE;
BEGIN
  PERFORM app.require_triage_staff();
  v_clerk_id := app.current_clerk_id();
  v_role     := app.current_user_role();

  IF p_decision IS NULL OR p_decision NOT IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED') THEN
    RAISE EXCEPTION 'decision must be ACCEPTED, REJECTED or PENDING_REVIEW';
  END IF;

  SELECT * INTO v_app FROM public.designer_applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found'; END IF;

  UPDATE public.designer_applications
  SET status       = p_decision,
      review_notes = NULLIF(btrim(coalesce(p_notes, '')), ''),
      reviewed_by  = CASE WHEN p_decision = 'PENDING_REVIEW' THEN NULL ELSE v_clerk_id END,
      reviewed_at  = CASE WHEN p_decision = 'PENDING_REVIEW' THEN NULL ELSE now() END
  WHERE id = p_id;

  -- Payload excludes contact PII, matching APPLICATION_SUBMITTED (0018): staff
  -- read the row directly; the audit entry is an operational marker of WHO
  -- decided WHAT, so here the actor IS recorded (unlike the public submit).
  PERFORM audit.log_event(
    'APPLICATION_REVIEWED', 'designer_application', p_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_app.status, 'to', p_decision)
  );

  -- Tell the applicant, best-effort. Keyed by (application, decision) so a
  -- toggle can't spam — one accept email and one reject email per application,
  -- ever, and re-clicking the same decision is a no-op.
  IF p_decision = 'ACCEPTED' THEN
    PERFORM app.enqueue_email(
      'DESIGNER_APPLICATION_ACCEPTED', v_app.email,
      jsonb_build_object('full_name', v_app.full_name),
      'email:app_decision:accepted:' || p_id
    );
  ELSIF p_decision = 'REJECTED' THEN
    PERFORM app.enqueue_email(
      'DESIGNER_APPLICATION_REJECTED', v_app.email,
      jsonb_build_object('full_name', v_app.full_name),
      'email:app_decision:rejected:' || p_id
    );
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', p_decision);
END
$$;

-- ------------------------------------------------- payout paid -> email --

-- Redefined from 0024 (body carried forward verbatim) with one enqueue added,
-- on PAID only: tell the payee their money is on its way. The recipient address
-- comes from designer_profiles; a payee without one (e.g. a QC reviewer with no
-- profile) simply gets no email — enqueue_email skips a null recipient, so the
-- payout still records fine.
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
  v_email        text;
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

  -- Money on its way -> tell the payee, best-effort. Keyed by payout id, so a
  -- redelivered PAID webhook enqueues at most one email. A payee with no
  -- profile email (a QC reviewer) simply gets none.
  IF p_status = 'PAID' THEN
    SELECT email INTO v_email FROM public.designer_profiles WHERE user_id = v_payout.payee_id;
    IF v_email IS NOT NULL THEN
      PERFORM app.enqueue_email(
        'PAYOUT_SENT', v_email,
        jsonb_build_object(
          'amount_minor', v_payout.amount,
          'currency', v_payout.currency,
          'order_ref', left(v_payout.order_id, 12)
        ),
        'email:payout_sent:' || v_payout.id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('payout_id', v_payout.id, 'status', p_status, 'applied', true);
END
$$;
