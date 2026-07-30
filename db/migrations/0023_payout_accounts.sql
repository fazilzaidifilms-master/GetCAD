-- 0023_payout_accounts.sql
-- Payout identity: who we are actually allowed to send money to.
--
-- THE PROBLEM THIS FIXES. `release_escrow` (0012, extended in 0020) will happily
-- write a RELEASE leg to a designer, reducing the escrow balance to zero, with
-- no record anywhere of a bank account to send that money to. The ledger then
-- says the designer has been paid and reality says they have not. 0020 closed
-- half of this ("every payout must have someone to pay") by requiring a payee
-- id. This closes the other half: the payee must be someone we can PAY.
--
-- WHY `payout_accounts` AND NOT `designer_payout_accounts`. QC reviewers are
-- paid out of the same escrow, through the same RELEASE legs, by the same
-- processor. Keying on user_id instead of designer_id costs nothing today and
-- avoids a table rename the first time a QC reviewer needs paying.
--
-- WHY NOT `designer_profiles.payout_details`. That column (0003) was a single
-- free-text field. It could not be validated, could not be masked, could not
-- record a verification state, and put the most sensitive data in the system
-- inside a table the owning user can SELECT directly. It is dropped below.
--
-- SENSITIVITY. This is the strongest identity data the platform holds — a
-- government tax id and a bank account, tied to a real person. It gets the
-- strictest treatment in the schema: ZERO allow policies (see policies/0019),
-- so not even the owner reads the table directly. Every read goes through
-- my_payout_account(), which returns last-four fragments and never the full
-- PAN or account number. The double-blind is unaffected for free: a client has
-- no policy, no grant, and no function that can reach any of this.

-- ------------------------------------------------------------------ table --

CREATE TABLE payout_accounts (
  id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- One current account per user. History lives in the audit log, not here:
  -- keeping superseded bank details on hand is a liability, not a feature.
  user_id           text        NOT NULL UNIQUE
                                  REFERENCES users (id) ON DELETE RESTRICT,

  -- The country tripwire. This table encodes the Indian IMPS/NEFT rail, where
  -- an IFSC is meaningful. A designer outside India cannot be silently stored
  -- here with an IFSC-shaped nothing; the constraint forces a real decision
  -- about the international rail instead.
  country           text        NOT NULL DEFAULT 'IN' CHECK (country = 'IN'),

  -- Name as held at the bank. Payouts fail when this disagrees with the account.
  beneficiary_name  text        NOT NULL CHECK (char_length(beneficiary_name) BETWEEN 2 AND 120),

  -- Permanent Account Number: 5 letters, 4 digits, 1 letter. Stored uppercase.
  pan               text        NOT NULL CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),

  account_number    text        NOT NULL CHECK (account_number ~ '^[0-9]{9,18}$'),

  -- Indian Financial System Code; the '0' in position 5 is fixed by RBI.
  ifsc              text        NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),

  account_type      text        NOT NULL CHECK (account_type IN ('SAVINGS', 'CURRENT')),

  -- Displayable fragments, derived so they can never drift from the source.
  -- These are what leaves the database; the full values never do.
  account_last4     text        GENERATED ALWAYS AS (right(account_number, 4)) STORED,
  pan_last4         text        GENERATED ALWAYS AS (right(pan, 4)) STORED,

  status            text        NOT NULL DEFAULT 'PENDING_VERIFICATION'
                                  CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
  rejection_reason  text        CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),

  -- The processor's handles for this beneficiary, filled in by the payout
  -- integration. Deliberately processor-agnostic names, matching 0021.
  processor_account_ref      text,
  processor_fund_account_ref text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A rejection must say why, or the person cannot fix it.
  CONSTRAINT payout_accounts_rejection_has_reason CHECK (
    status <> 'REJECTED' OR rejection_reason IS NOT NULL
  )
);

CREATE INDEX payout_accounts_status_idx ON payout_accounts (status, updated_at DESC);

-- Same convention as every table since 0013: no direct write grants. SELECT is
-- granted so the "locked door, not missing door" property from policies/0002
-- still holds — RLS (policies/0019) returns zero rows to everyone.
GRANT SELECT ON public.payout_accounts TO anon, authenticated;
GRANT ALL    ON public.payout_accounts TO service_role;

-- ------------------------------------------------- retire the free-text sink --

-- Nothing in the application ever read or wrote this column (verified by
-- search across app/, lib/, core/ and scripts/). Dropping it removes an
-- unvalidatable, unmaskable PII field from a table its owner can SELECT.
ALTER TABLE designer_profiles DROP COLUMN payout_details;

-- ----------------------------------------------------------------- helper --

-- Payout readiness for one user, as a single value the money functions can
-- ask for. Returns NULL when the user has submitted nothing at all, which
-- reads differently from 'REJECTED' and should.
CREATE OR REPLACE FUNCTION app.payout_account_status(p_user_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT status FROM public.payout_accounts WHERE user_id = p_user_id;
$$;

-- --------------------------------------------------------------- write path --

-- The only sanctioned way to record payout identity. Self-service: a user can
-- only ever write their OWN account, taken from the verified token — the
-- caller cannot name a user_id, so there is no way to point someone else's
-- payouts at your bank.
CREATE OR REPLACE FUNCTION public.upsert_payout_account(
  p_beneficiary_name text,
  p_pan              text,
  p_account_number   text,
  p_ifsc             text,
  p_account_type     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_status   text;
  v_name     text;
  v_pan      text;
  v_acct     text;
  v_ifsc     text;
  v_existing public.payout_accounts%ROWTYPE;
  v_replaced boolean;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT role, status INTO v_role, v_status FROM public.users WHERE id = v_clerk_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no user record'; END IF;

  -- Only the roles that actually receive escrow releases. A CLIENT has no
  -- payout leg, so storing their bank details would be collecting sensitive
  -- data we have no use for.
  IF v_role NOT IN ('DESIGNER', 'QC') THEN
    RAISE EXCEPTION 'only a designer or QC reviewer has a payout account';
  END IF;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'account is not active';
  END IF;

  v_name := btrim(regexp_replace(coalesce(p_beneficiary_name, ''), '\s+', ' ', 'g'));
  v_pan  := upper(regexp_replace(coalesce(p_pan, ''),  '\s',    '', 'g'));
  v_ifsc := upper(regexp_replace(coalesce(p_ifsc, ''), '\s',    '', 'g'));
  v_acct :=       regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g');

  -- Re-validated here rather than left to the CHECK constraints, so a designer
  -- sees which field is wrong instead of a constraint name.
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'beneficiary name is required';
  END IF;
  IF v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN
    RAISE EXCEPTION 'PAN must be five letters, four digits, then one letter';
  END IF;
  IF v_acct !~ '^[0-9]{9,18}$' THEN
    RAISE EXCEPTION 'account number must be 9 to 18 digits';
  END IF;
  IF v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'IFSC must be four letters, a zero, then six characters';
  END IF;
  IF p_account_type IS NULL OR p_account_type NOT IN ('SAVINGS', 'CURRENT') THEN
    RAISE EXCEPTION 'account type must be SAVINGS or CURRENT';
  END IF;

  SELECT * INTO v_existing FROM public.payout_accounts WHERE user_id = v_clerk_id FOR UPDATE;
  -- Captured now: FOUND is reset by the INSERT/UPDATE below, so reading it
  -- afterwards would report "replaced" for a first-time submission too.
  v_replaced := FOUND;

  IF NOT v_replaced THEN
    INSERT INTO public.payout_accounts
      (user_id, beneficiary_name, pan, account_number, ifsc, account_type)
    VALUES
      (v_clerk_id, v_name, v_pan, v_acct, v_ifsc, p_account_type);
  ELSE
    -- CHANGING THE DESTINATION UNDOES VERIFICATION. If an already-VERIFIED
    -- account could be re-pointed at a different bank account while keeping
    -- its verified state, a stolen session would redirect every future payout
    -- with no review. Any change to the money destination resets to
    -- PENDING_VERIFICATION and drops the processor handles, which belong to
    -- the OLD beneficiary and would otherwise pay the wrong person.
    UPDATE public.payout_accounts
    SET beneficiary_name = v_name,
        pan              = v_pan,
        account_number   = v_acct,
        ifsc             = v_ifsc,
        account_type     = p_account_type,
        status           = 'PENDING_VERIFICATION',
        rejection_reason = NULL,
        processor_account_ref      = NULL,
        processor_fund_account_ref = NULL,
        updated_at       = now()
    WHERE user_id = v_clerk_id;
  END IF;

  -- Payload carries NO account number and NO PAN — only the fragments already
  -- safe to display. An audit log that leaks what it audits is a liability.
  PERFORM audit.log_event(
    'PAYOUT_ACCOUNT_SUBMITTED', 'payout_account', v_clerk_id, v_clerk_id, v_role,
    jsonb_build_object(
      'account_last4', right(v_acct, 4),
      'pan_last4',     right(v_pan, 4),
      'ifsc',          v_ifsc,
      'account_type',  p_account_type,
      'replaced',      v_replaced
    )
  );

  RETURN jsonb_build_object('status', 'PENDING_VERIFICATION', 'account_last4', right(v_acct, 4));
END
$$;

REVOKE ALL ON FUNCTION public.upsert_payout_account(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_payout_account(text, text, text, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------- read path --

-- The ONLY way anyone reads their payout account. Returns display fragments,
-- never the account number and never the full PAN — so a compromised session
-- cannot exfiltrate what it did not already know.
CREATE OR REPLACE FUNCTION public.my_payout_account()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_row      public.payout_accounts%ROWTYPE;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO v_row FROM public.payout_accounts WHERE user_id = v_clerk_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'beneficiary_name', v_row.beneficiary_name,
    'pan_last4',        v_row.pan_last4,
    'account_last4',    v_row.account_last4,
    'ifsc',             v_row.ifsc,
    'account_type',     v_row.account_type,
    'status',           v_row.status,
    'rejection_reason', v_row.rejection_reason,
    'updated_at',       v_row.updated_at
  );
END
$$;

REVOKE ALL ON FUNCTION public.my_payout_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_payout_account() TO authenticated, service_role;

-- -------------------------------------------------------- verification path --

-- Records the outcome of beneficiary verification. Server-to-server only: this
-- decides who the platform is willing to send money to, so it is never
-- reachable from a browser session, exactly like confirm_payment (0022).
CREATE OR REPLACE FUNCTION public.set_payout_account_status(
  p_user_id                    text,
  p_status                     text,
  p_reason                     text DEFAULT NULL,
  p_processor_account_ref      text DEFAULT NULL,
  p_processor_fund_account_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.payout_accounts%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED') THEN
    RAISE EXCEPTION 'invalid payout account status';
  END IF;
  IF p_status = 'REJECTED' AND btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'a rejection must carry a reason';
  END IF;

  SELECT * INTO v_row FROM public.payout_accounts WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no payout account for this user'; END IF;

  UPDATE public.payout_accounts
  SET status           = p_status,
      rejection_reason = CASE WHEN p_status = 'REJECTED' THEN btrim(p_reason) ELSE NULL END,
      processor_account_ref      = coalesce(p_processor_account_ref, processor_account_ref),
      processor_fund_account_ref = coalesce(p_processor_fund_account_ref, processor_fund_account_ref),
      updated_at       = now()
  WHERE user_id = p_user_id;

  -- actor is the operator/automation running as service_role, not a platform
  -- user, so actor_id/actor_role are NULL — same convention as 0018.
  PERFORM audit.log_event(
    'PAYOUT_ACCOUNT_' || p_status, 'payout_account', p_user_id, NULL, NULL,
    jsonb_build_object('from', v_row.status, 'to', p_status,
                       'account_last4', v_row.account_last4)
  );

  RETURN jsonb_build_object('user_id', p_user_id, 'status', p_status);
END
$$;

REVOKE ALL ON FUNCTION public.set_payout_account_status(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_payout_account_status(text, text, text, text, text)
  TO service_role;

-- ------------------------------------------- the gate on releasing the money --

-- Replaces the 0020 version. Everything below the marked block is unchanged;
-- the addition is that a payout leg now requires a payee we can actually pay.
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

  -- ---- NEW IN 0023 ----
  -- ...and that someone must be payable. A RELEASE leg drains escrow to zero;
  -- writing one for a payee with no verified bank account produces a ledger
  -- that says "paid" and a person who has not been. Blocking here is
  -- recoverable (the payee submits their details and FINANCE retries); the
  -- alternative is not.
  IF v_order.designer_payout > 0
     AND coalesce(app.payout_account_status(v_order.designer_id), 'MISSING') <> 'VERIFIED' THEN
    RAISE EXCEPTION 'cannot release a designer payout: the designer has no verified payout account';
  END IF;
  IF v_order.qc_payout > 0
     AND coalesce(app.payout_account_status(v_order.qc_reviewer_id), 'MISSING') <> 'VERIFIED' THEN
    RAISE EXCEPTION 'cannot release a QC payout: the reviewer has no verified payout account';
  END IF;
  -- ---- END NEW ----

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
