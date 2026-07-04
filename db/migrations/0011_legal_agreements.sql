-- 0011_legal_agreements.sql
-- Wire the REAL, versioned legal document behind the designer gate (0009).
--
-- Slice 9 modelled the gate but stored only a placeholder version string
-- ('UNWIRED_V0'). This slice supplies the actual document and the provable
-- consent trail the gate was always meant to protect:
--
--   * agreement_documents  — immutable, versioned legal text. Each (kind,version)
--     is published once and NEVER edited; a correction is a new version. Its
--     content_sha256 is a fingerprint of the exact body, computed by the DB (same
--     sha256 built-in the audit chain uses) so it cannot lie.
--   * agreement_acceptances — immutable signatures: who accepted which document
--     version and the exact fingerprint they saw. One per (document, user).
--
-- The gate now requires acceptance of the CURRENT version, so publishing a new
-- version automatically re-gates every designer until they accept it. Old
-- signatures remain on file as historical proof.
--
-- Both tables are APPEND-ONLY (UPDATE/DELETE rejected by trigger): a published
-- legal document and a signature must never be rewritten, even by a privileged
-- connection.

-- Immutable, versioned legal documents.
CREATE TABLE agreement_documents (
  id             text        PRIMARY KEY,
  kind           text        NOT NULL,          -- e.g. 'DESIGNER'
  version        text        NOT NULL,          -- e.g. 'v1'
  title          text        NOT NULL,
  body           text        NOT NULL,          -- the legal text (markdown)
  content_sha256 text        NOT NULL,          -- fingerprint of body, DB-computed
  published_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

-- Immutable signatures: the exact fingerprint is snapshotted so the record of
-- what was signed survives independently of the document row.
CREATE TABLE agreement_acceptances (
  id             text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agreement_id   text        NOT NULL REFERENCES agreement_documents (id) ON DELETE RESTRICT,
  user_id        text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  content_sha256 text        NOT NULL,          -- snapshot of what they signed
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, user_id)
);

CREATE INDEX agreement_acceptances_user_idx ON agreement_acceptances (user_id);

-- Append-only enforcement for both tables.
CREATE OR REPLACE FUNCTION app.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END
$$;

CREATE TRIGGER agreement_documents_no_update
  BEFORE UPDATE ON agreement_documents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER agreement_documents_no_delete
  BEFORE DELETE ON agreement_documents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER agreement_acceptances_no_update
  BEFORE UPDATE ON agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER agreement_acceptances_no_delete
  BEFORE DELETE ON agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- The current (latest published) document for a kind.
CREATE OR REPLACE FUNCTION app.current_agreement(p_kind text)
RETURNS public.agreement_documents
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM public.agreement_documents
  WHERE kind = p_kind
  ORDER BY published_at DESC, version DESC
  LIMIT 1
$$;

-- Seed the initial DESIGNER agreement (v1). The fingerprint is computed by the
-- DB from the exact body so it is always consistent. This is a STARTER document
-- to be replaced by counsel-drafted text as a new version — never edited here.
INSERT INTO agreement_documents (id, kind, version, title, body, content_sha256)
SELECT
  'agr_designer_v1',
  'DESIGNER',
  'v1',
  'Designer Services & Confidentiality Agreement',
  body,
  encode(sha256(convert_to(body, 'UTF8')), 'hex')
FROM (
  SELECT $doc$# Designer Services & Confidentiality Agreement (v1)

_This is a starter agreement to be replaced by counsel-drafted text in a later
version. It is stored here so the acceptance flow binds to a real, fingerprinted
document._

By accepting this agreement you agree that:

1. **Double-blind confidentiality.** You will never attempt to discover, and will
   not use or disclose, the identity of any client. All client materials are
   confidential and used solely to fulfil the assigned order.

2. **Anonymity of deliverables.** You will not embed your identity, contact
   details, watermarks, or any identifying metadata in files you deliver.

3. **No off-platform contact.** You will not solicit or conduct business with a
   client outside the platform, nor attempt to de-anonymise any counterparty.

4. **Ownership.** On payment, deliverables and their intellectual property
   transfer to the client as described in the order terms.

5. **Conduct.** You will perform work professionally, meet agreed scope and
   deadlines, and comply with the platform's policies.

Acceptance is recorded with the version and a cryptographic fingerprint of this
exact text.$doc$ AS body
) s;

-- A designer is assignable only if they are an ACTIVE designer who has accepted
-- the CURRENT agreement version. Tying to the current version means publishing a
-- new version automatically re-gates everyone until they re-accept.
CREATE OR REPLACE FUNCTION app.designer_is_assignable(p_designer_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.designer_profiles dp ON dp.user_id = u.id
    WHERE u.id = p_designer_id
      AND u.role = 'DESIGNER'
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
      AND dp.deleted_at IS NULL
      AND dp.agreement_accepted_at IS NOT NULL
      AND dp.agreement_version = (SELECT version FROM app.current_agreement('DESIGNER'))
  )
$$;

-- Accept the current designer agreement. Verifies the fingerprint the caller saw
-- still matches the current document (rejects a stale/forged signature), records
-- an immutable signature, flips the designer to ACTIVE, and audits it with the
-- version + fingerprint. Idempotent per version.
--
-- Signature changes from 0009 (was p_version), so drop the old one first.
DROP FUNCTION IF EXISTS public.accept_designer_agreement(text);

CREATE FUNCTION public.accept_designer_agreement(
  p_expected_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_doc      public.agreement_documents;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.designer_profiles
    WHERE user_id = v_clerk_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a designer applicant: apply as a designer first';
  END IF;

  SELECT * INTO v_doc FROM app.current_agreement('DESIGNER');
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'no designer agreement is published';
  END IF;

  IF p_expected_sha256 IS DISTINCT FROM v_doc.content_sha256 THEN
    RAISE EXCEPTION 'agreement changed since you loaded it: reload and read the current version';
  END IF;

  -- Idempotent for the current version.
  IF EXISTS (
    SELECT 1 FROM public.agreement_acceptances
    WHERE agreement_id = v_doc.id AND user_id = v_clerk_id
  ) THEN
    RETURN jsonb_build_object('user_id', v_clerk_id, 'accepted', true,
                              'already', true, 'version', v_doc.version);
  END IF;

  INSERT INTO public.agreement_acceptances (agreement_id, user_id, content_sha256)
  VALUES (v_doc.id, v_clerk_id, v_doc.content_sha256);

  UPDATE public.designer_profiles
    SET agreement_accepted_at = now(), agreement_version = v_doc.version
    WHERE user_id = v_clerk_id;
  UPDATE public.users
    SET status = 'ACTIVE'
    WHERE id = v_clerk_id AND role = 'DESIGNER';

  PERFORM audit.log_event(
    'DESIGNER_AGREEMENT_ACCEPTED', 'user', v_clerk_id, v_clerk_id, 'DESIGNER',
    jsonb_build_object('agreement_id', v_doc.id, 'agreement_version', v_doc.version,
                       'content_sha256', v_doc.content_sha256)
  );

  RETURN jsonb_build_object('user_id', v_clerk_id, 'accepted', true, 'version', v_doc.version);
END
$$;

REVOKE ALL ON FUNCTION public.accept_designer_agreement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_designer_agreement(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_agreement(text) TO authenticated, service_role;
