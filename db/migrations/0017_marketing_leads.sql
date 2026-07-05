-- 0017_marketing_leads.sql
-- Public marketing site lead capture (Contact Sales). Deliberately isolated
-- from the double-blind order/user domain: no FKs to users/orders, no audit
-- log entanglement — a visitor submitting this form is not a platform user and
-- this table plays no part in the marketplace's security model. It exists only
-- to capture inbound interest.
--
-- Follows the SAME convention as every other table in this schema: the table
-- itself carries NO direct grants to anon/authenticated. The only write path is
-- submit_marketing_lead() (SECURITY DEFINER) below — so an anonymous visitor
-- can submit a lead, but cannot read, update, or delete any row directly.

CREATE TABLE marketing_leads (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  company    text        CHECK (company IS NULL OR char_length(company) <= 200),
  email      text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role       text        NOT NULL DEFAULT 'BUSINESS' CHECK (role IN ('BUSINESS', 'DESIGNER', 'OTHER')),
  message    text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketing_leads_created_idx ON marketing_leads (created_at DESC);

-- The single sanctioned way to submit a lead. Re-validates everything the table
-- CHECK constraints already enforce (defense in depth, and clearer error
-- messages than a raw constraint-violation would give a form submitter).
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

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.submit_marketing_lead(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_marketing_lead(text, text, text, text, text)
  TO anon, authenticated, service_role;
