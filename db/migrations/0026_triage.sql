-- 0026_triage.sql
-- The staff side of the two public inboxes. Designer applications (0018) and
-- contact leads (0017) could be written by the public and read by nobody
-- through the app — reviewing them meant opening the database by hand. This
-- adds the sanctioned staff read + decision paths so they can be worked in the
-- product, without weakening the zero-allow posture: the tables stay unreadable
-- by every role, and these SECURITY DEFINER functions are the only door.
--
-- LEAST PRIVILEGE. Applications and leads carry real contact PII (names,
-- emails, phones). Only the roles that actually recruit and sell — OPS and
-- SALES — may see or act on them. QC and FINANCE are staff but have no business
-- reading an applicant's phone number, so they are refused here even though
-- they can see the order queue.
--
-- ACCEPTING IS A DECISION, NOT AN ACCOUNT. An accepted application is a signal,
-- recorded and audited; it does NOT mint a designer account. A designer still
-- becomes real only by signing up and passing the agreement gate (0009/0011).
-- This preserves the "conversion is manual, per-candidate" model from 0018.

-- ----------------------------------------------------- decision columns --

ALTER TABLE designer_applications
  ADD COLUMN reviewed_at  timestamptz,
  ADD COLUMN reviewed_by  text REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN review_notes text CHECK (review_notes IS NULL OR char_length(review_notes) <= 2000);

-- Leads gain a worked/not-worked state so the inbox can be triaged.
ALTER TABLE marketing_leads
  ADD COLUMN status     text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'HANDLED')),
  ADD COLUMN handled_at timestamptz,
  ADD COLUMN handled_by text REFERENCES users (id) ON DELETE RESTRICT;

CREATE INDEX marketing_leads_status_idx ON marketing_leads (status, created_at DESC);

-- ---------------------------------------------------------- role gate --

-- The one place the triage-staff rule lives. OPS and SALES only.
CREATE OR REPLACE FUNCTION app.require_triage_staff()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role public.role;
BEGIN
  IF app.current_clerk_id() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_role := app.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('OPS', 'SALES') THEN
    RAISE EXCEPTION 'only OPS or SALES may review applications and leads';
  END IF;
END
$$;

-- ------------------------------------------------ designer applications --

CREATE OR REPLACE FUNCTION public.list_designer_applications(p_status text DEFAULT NULL)
RETURNS TABLE (
  id                  text,
  full_name           text,
  email               text,
  phone               text,
  country             text,
  years_experience    integer,
  primary_software    text,
  categories          text[],
  portfolio_url       text,
  portfolio_file_keys text[],
  status              text,
  review_notes        text,
  reviewed_at         timestamptz,
  created_at          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app.require_triage_staff();
  IF p_status IS NOT NULL AND p_status NOT IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED') THEN
    RAISE EXCEPTION 'invalid status filter';
  END IF;

  RETURN QUERY
  SELECT a.id, a.full_name, a.email, a.phone, a.country, a.years_experience,
         a.primary_software, a.categories, a.portfolio_url, a.portfolio_file_keys,
         a.status, a.review_notes, a.reviewed_at, a.created_at
  FROM public.designer_applications a
  WHERE p_status IS NULL OR a.status = p_status
  ORDER BY
    -- Unreviewed first, then most recent.
    CASE WHEN a.status = 'PENDING_REVIEW' THEN 0 ELSE 1 END,
    a.created_at DESC;
END
$$;

REVOKE ALL ON FUNCTION public.list_designer_applications(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_designer_applications(text) TO authenticated, service_role;

-- Record a review decision. Audited; sets who decided and when. Does NOT create
-- a designer account (see the header). Re-reviewable: a decision can be revised,
-- which is why moving back to PENDING_REVIEW is allowed.
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

  RETURN jsonb_build_object('id', p_id, 'status', p_decision);
END
$$;

REVOKE ALL ON FUNCTION public.review_designer_application(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_designer_application(text, text, text) TO authenticated, service_role;

-- --------------------------------------------------------------- leads --

CREATE OR REPLACE FUNCTION public.list_marketing_leads(p_status text DEFAULT NULL)
RETURNS TABLE (
  id         text,
  name       text,
  company    text,
  email      text,
  role       text,
  message    text,
  status     text,
  handled_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app.require_triage_staff();
  IF p_status IS NOT NULL AND p_status NOT IN ('NEW', 'HANDLED') THEN
    RAISE EXCEPTION 'invalid status filter';
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, l.company, l.email, l.role, l.message,
         l.status, l.handled_at, l.created_at
  FROM public.marketing_leads l
  WHERE p_status IS NULL OR l.status = p_status
  ORDER BY
    CASE WHEN l.status = 'NEW' THEN 0 ELSE 1 END,
    l.created_at DESC;
END
$$;

REVOKE ALL ON FUNCTION public.list_marketing_leads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_marketing_leads(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_lead_status(p_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_lead     public.marketing_leads%ROWTYPE;
BEGIN
  PERFORM app.require_triage_staff();
  v_clerk_id := app.current_clerk_id();
  v_role     := app.current_user_role();

  IF p_status IS NULL OR p_status NOT IN ('NEW', 'HANDLED') THEN
    RAISE EXCEPTION 'status must be NEW or HANDLED';
  END IF;

  SELECT * INTO v_lead FROM public.marketing_leads WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead not found'; END IF;

  UPDATE public.marketing_leads
  SET status     = p_status,
      handled_by = CASE WHEN p_status = 'HANDLED' THEN v_clerk_id ELSE NULL END,
      handled_at = CASE WHEN p_status = 'HANDLED' THEN now() ELSE NULL END
  WHERE id = p_id;

  -- marketing_leads has no audit entry on submit (0017: a form submitter is not
  -- a platform user), but a STAFF action on the lead is a platform action, so
  -- it is recorded with its actor.
  PERFORM audit.log_event(
    'LEAD_STATUS_CHANGED', 'marketing_lead', p_id, v_clerk_id, v_role,
    jsonb_build_object('from', v_lead.status, 'to', p_status)
  );

  RETURN jsonb_build_object('id', p_id, 'status', p_status);
END
$$;

REVOKE ALL ON FUNCTION public.set_lead_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_lead_status(text, text) TO authenticated, service_role;
