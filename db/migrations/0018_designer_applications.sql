-- 0018_designer_applications.sql
-- Stage 1 of designer onboarding: a public, low-friction application (a
-- lead), NOT a full designer account. No `users`/`designer_profiles` row is
-- created here — that conversion happens manually, per-candidate, after
-- staff review and a test order (apply_as_designer / accept_designer_agreement,
-- 0009/0011, remain the real onboarding gate for accepted applicants).
--
-- Deliberately outside the double-blind order/user identity model: an
-- applicant isn't a platform participant yet, so this table carries no FKs to
-- users/orders and plays no part in RLS-scoped order visibility.
--
-- Follows the SAME convention as every other table in this schema: no direct
-- grants to anon/authenticated. The sole write path is
-- submit_designer_application() (SECURITY DEFINER).

CREATE TABLE designer_applications (
  id                  text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  full_name           text        NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 200),
  email               text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text        NOT NULL CHECK (char_length(phone) BETWEEN 3 AND 40),
  country             text        NOT NULL CHECK (char_length(country) BETWEEN 1 AND 100),
  years_experience    integer     NOT NULL CHECK (years_experience BETWEEN 0 AND 60),
  primary_software    text        NOT NULL CHECK (primary_software IN ('RHINO', 'MATRIX', '3DESIGN', 'OTHER')),
  categories          text[]      NOT NULL CHECK (
                        cardinality(categories) >= 1
                        AND categories <@ ARRAY['RINGS', 'PENDANTS', 'EARRINGS', 'BRACELETS', 'BANGLES']::text[]
                      ),
  portfolio_url       text        CHECK (portfolio_url IS NULL OR char_length(portfolio_url) <= 2000),
  portfolio_file_keys text[]      CHECK (
                        portfolio_file_keys IS NULL
                        OR cardinality(portfolio_file_keys) BETWEEN 2 AND 3
                      ),
  status              text        NOT NULL DEFAULT 'PENDING_REVIEW'
                        CHECK (status IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Exactly one portfolio path — a URL, or 2-3 sanitized file keys, never both/neither.
  CONSTRAINT designer_applications_portfolio_xor CHECK (
    (portfolio_url IS NOT NULL AND portfolio_file_keys IS NULL)
    OR
    (portfolio_url IS NULL AND portfolio_file_keys IS NOT NULL)
  )
);

CREATE INDEX designer_applications_status_idx ON designer_applications (status, created_at DESC);

-- The single sanctioned way to submit an application. Re-validates everything
-- the table CHECK constraints already enforce (defense in depth, and clearer
-- error messages than a raw constraint-violation would give an applicant).
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

  RETURN p_id;
END
$$;

REVOKE ALL ON FUNCTION public.submit_designer_application(
  text, text, text, text, text, integer, text, text[], text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_designer_application(
  text, text, text, text, text, integer, text, text[], text, text[]
) TO anon, authenticated, service_role;
