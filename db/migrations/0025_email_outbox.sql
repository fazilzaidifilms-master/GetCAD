-- 0025_email_outbox.sql
-- Transactional email, as an OUTBOX rather than a fire-and-forget send.
--
-- WHY AN OUTBOX. An email provider is a network call that fails, times out, and
-- rate-limits. If the business action sent the email inline and the provider
-- was down, the applicant would either get a 500 (their application lost over a
-- transient email hiccup) or nothing (silently dropped). Instead the action
-- writes a row saying "this email is owed", in the SAME transaction as the work
-- it acknowledges, and a separate dispatcher sends it. An email is never lost
-- because the provider blinked, and the send can be retried.
--
-- This mirrors the payout worker (0024) on purpose: enqueue -> claim -> record,
-- with an idempotency key so at-least-once delivery does not become
-- at-least-twice. Email is lower-stakes than money (a duplicate is annoying,
-- not a double payment), so the rules are the same shape but less severe.
--
-- ANONYMITY. The outbox stores a recipient address and a small payload. It is
-- only ever used, in this slice, for emails a person receives ABOUT THEIR OWN
-- action (an application they filed, a message they sent us) — there is no
-- counterparty, so nothing crosses the double-blind. The payload carries only
-- what the template needs, and the table is unreadable by every client role
-- (see policies/0022). The rendered BODY lives in core/email, which is given
-- only these fields.

CREATE TABLE email_outbox (
  id                   text        PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Which message to render. Checked against the set core/email knows how to
  -- build; adding one is a migration, which keeps the DB and the renderer from
  -- silently disagreeing about what a template is.
  template             text        NOT NULL CHECK (template IN (
                         'DESIGNER_APPLICATION_RECEIVED',
                         'CONTACT_RECEIVED'
                       )),

  recipient_email      text        NOT NULL CHECK (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  -- Only the fields the template needs. Never a counterparty identity.
  payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,

  status               text        NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),

  attempts             integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),

  -- OUR key, deterministic from the event (e.g. email:application:<id>), so an
  -- action that runs twice enqueues once and a redelivered send is a no-op.
  idempotency_key      text        NOT NULL UNIQUE,

  provider_message_ref text,
  failure_reason       text        CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,

  -- A terminal state must carry its evidence: what the provider called it, or
  -- why it failed.
  CONSTRAINT email_outbox_sent_has_ref CHECK (
    status <> 'SENT' OR (provider_message_ref IS NOT NULL AND sent_at IS NOT NULL)
  ),
  CONSTRAINT email_outbox_failed_has_reason CHECK (
    status <> 'FAILED' OR failure_reason IS NOT NULL
  )
);

-- The dispatcher's queue: what still needs sending, oldest first.
CREATE INDEX email_outbox_queue_idx ON email_outbox (status, created_at)
  WHERE status IN ('PENDING', 'FAILED', 'SENDING');

-- Same convention as every table since 0013: SELECT only, so default-deny RLS
-- is what stops reads (a locked door, not a missing one). No direct writes.
GRANT SELECT ON public.email_outbox TO anon, authenticated;
GRANT ALL    ON public.email_outbox TO service_role;

-- ------------------------------------------------------------- enqueue --

-- Record that an email is owed. Called from inside the business functions that
-- have the recipient's address, so the row is written in the SAME transaction:
-- if the action rolls back, so does its email, and vice versa.
--
-- BEST-EFFORT, exactly like app.notify (0015): a problem enqueuing an
-- acknowledgement must never roll back the application or lead it acknowledges.
-- The internal handler swallows anything, so the worst case is a missing email,
-- never a lost submission. ON CONFLICT makes a re-run harmless.
CREATE OR REPLACE FUNCTION app.enqueue_email(
  p_template        text,
  p_recipient       text,
  p_payload         jsonb,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_recipient IS NULL OR p_recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN;  -- no usable address; nothing to send
  END IF;

  INSERT INTO public.email_outbox (template, recipient_email, payload, idempotency_key)
  VALUES (p_template, btrim(p_recipient), coalesce(p_payload, '{}'::jsonb), p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let an acknowledgement break the thing it acknowledges.
    RETURN;
END
$$;

-- ------------------------------------------------------- claim / record --

-- Take the next batch to send. SKIP LOCKED so two dispatchers never grab the
-- same row. Reclaims a SENDING row that has been stuck past the threshold: a
-- lost provider response for an email is low-stakes (worst case a duplicate,
-- deduped by the provider's own idempotency where available), so unlike a
-- payout it is safe to retry rather than strand.
CREATE OR REPLACE FUNCTION public.claim_emails(p_limit integer DEFAULT 20)
RETURNS SETOF public.email_outbox
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
    SELECT id FROM public.email_outbox
    WHERE status IN ('PENDING', 'FAILED')
       OR (status = 'SENDING' AND updated_at < now() - interval '5 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_outbox e
  SET status = 'SENDING',
      attempts = e.attempts + 1,
      failure_reason = NULL,
      updated_at = now()
  FROM claimed c
  WHERE e.id = c.id
  RETURNING e.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_emails(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_emails(integer) TO service_role;

-- Record what the provider did. Idempotent: a row already in the target state
-- is a no-op, so a redelivered result does not rewrite it.
CREATE OR REPLACE FUNCTION public.record_email_result(
  p_idempotency_key text,
  p_status          text,
  p_provider_ref    text DEFAULT NULL,
  p_failure_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.email_outbox%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('SENT', 'FAILED') THEN
    RAISE EXCEPTION 'email result must be SENT or FAILED';
  END IF;

  SELECT * INTO v_row FROM public.email_outbox
    WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no email for key %', p_idempotency_key;
  END IF;

  IF v_row.status = p_status THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', p_status, 'applied', false);
  END IF;

  IF p_status = 'SENT' THEN
    IF p_provider_ref IS NULL OR btrim(p_provider_ref) = '' THEN
      RAISE EXCEPTION 'a sent email must record the provider reference';
    END IF;
    UPDATE public.email_outbox
    SET status = 'SENT', provider_message_ref = btrim(p_provider_ref),
        failure_reason = NULL, sent_at = now(), updated_at = now()
    WHERE id = v_row.id;
  ELSE  -- FAILED, and left retryable
    IF btrim(coalesce(p_failure_reason, '')) = '' THEN
      RAISE EXCEPTION 'a failed email must record why';
    END IF;
    UPDATE public.email_outbox
    SET status = 'FAILED', failure_reason = btrim(p_failure_reason), updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'status', p_status, 'applied', true);
END
$$;

REVOKE ALL ON FUNCTION public.record_email_result(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_email_result(text, text, text, text) TO service_role;

-- ----------------------------------- wire the two public acknowledgements --

-- Both are redefined (bodies carried forward verbatim) with a single
-- enqueue_email call added before RETURN, the same technique release_escrow
-- used across 0012 -> 0020 -> 0023. The payload carries only the recipient's
-- own first name; there is no counterparty to leak.

CREATE OR REPLACE FUNCTION public.submit_marketing_lead(
  p_name    text,
  p_email   text,
  p_message text,
  p_company text DEFAULT NULL,
  p_role    text DEFAULT 'BUSINESS'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id text;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;
  IF p_message IS NULL OR btrim(p_message) = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;
  IF p_role NOT IN ('BUSINESS', 'DESIGNER', 'OTHER') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  INSERT INTO public.marketing_leads (name, company, email, role, message)
  VALUES (
    btrim(p_name),
    NULLIF(btrim(coalesce(p_company, '')), ''),
    btrim(p_email),
    p_role,
    btrim(p_message)
  )
  RETURNING id INTO v_id;

  -- Acknowledge receipt. Best-effort; a mail hiccup never loses the lead.
  PERFORM app.enqueue_email(
    'CONTACT_RECEIVED',
    btrim(p_email),
    jsonb_build_object('name', btrim(p_name)),
    'email:contact:' || v_id
  );

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.submit_designer_application(
  p_id                  text,
  p_full_name           text,
  p_email               text,
  p_phone               text,
  p_country             text,
  p_years_experience    integer,
  p_primary_software    text,
  p_categories          text[],
  p_portfolio_url       text    DEFAULT NULL,
  p_portfolio_file_keys text[]  DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_portfolio_url text := NULLIF(btrim(coalesce(p_portfolio_url, '')), '');
BEGIN
  IF p_id IS NULL OR btrim(p_id) = '' THEN
    RAISE EXCEPTION 'id is required';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'full name is required';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'phone is required';
  END IF;
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RAISE EXCEPTION 'country is required';
  END IF;
  IF p_years_experience IS NULL OR p_years_experience < 0 OR p_years_experience > 60 THEN
    RAISE EXCEPTION 'years of experience must be between 0 and 60';
  END IF;
  IF p_primary_software IS NULL OR p_primary_software NOT IN ('RHINO', 'MATRIX', '3DESIGN', 'OTHER') THEN
    RAISE EXCEPTION 'invalid primary software';
  END IF;
  IF p_categories IS NULL OR cardinality(p_categories) < 1 THEN
    RAISE EXCEPTION 'select at least one jewelry category';
  END IF;
  IF NOT (p_categories <@ ARRAY['RINGS', 'PENDANTS', 'EARRINGS', 'BRACELETS', 'BANGLES']::text[]) THEN
    RAISE EXCEPTION 'invalid jewelry category';
  END IF;
  IF (v_portfolio_url IS NULL) = (p_portfolio_file_keys IS NULL) THEN
    RAISE EXCEPTION 'provide either a portfolio URL or portfolio files, not both';
  END IF;
  IF p_portfolio_file_keys IS NOT NULL AND cardinality(p_portfolio_file_keys) NOT BETWEEN 2 AND 3 THEN
    RAISE EXCEPTION 'upload between 2 and 3 portfolio files';
  END IF;

  INSERT INTO public.designer_applications
    (id, full_name, email, phone, country, years_experience, primary_software, categories,
     portfolio_url, portfolio_file_keys)
  VALUES
    (p_id, btrim(p_full_name), btrim(p_email), btrim(p_phone), btrim(p_country), p_years_experience,
     p_primary_software, p_categories, v_portfolio_url, p_portfolio_file_keys);

  -- Applicant isn't a platform user yet, so actor_id/actor_role are NULL.
  -- Payload deliberately excludes contact PII (name/email/phone) — staff
  -- review the full row directly; the audit entry is an operational marker.
  PERFORM audit.log_event(
    'APPLICATION_SUBMITTED',
    'designer_application',
    p_id,
    NULL,
    NULL,
    jsonb_build_object(
      'country', p_country,
      'primary_software', p_primary_software,
      'categories', to_jsonb(p_categories),
      'years_experience', p_years_experience
    )
  );

  -- Acknowledge receipt. Best-effort; a mail hiccup never loses the application.
  PERFORM app.enqueue_email(
    'DESIGNER_APPLICATION_RECEIVED',
    btrim(p_email),
    jsonb_build_object('full_name', btrim(p_full_name)),
    'email:application:' || p_id
  );

  RETURN p_id;
END
$$;
