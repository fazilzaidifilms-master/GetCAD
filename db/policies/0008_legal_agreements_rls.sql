-- 0008_legal_agreements_rls.sql
-- Legal documents are readable by any authenticated user (you must be able to
-- read the agreement you are asked to sign). Signatures are private: you can read
-- only your own. All WRITES go exclusively through the SECURITY DEFINER function
-- accept_designer_agreement() — there is no INSERT/UPDATE/DELETE policy, so the
-- default-deny posture blocks every direct write.

ALTER TABLE agreement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_documents FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON agreement_documents TO authenticated;

CREATE POLICY agreement_documents_read ON agreement_documents
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_acceptances FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON agreement_acceptances TO authenticated;

CREATE POLICY agreement_acceptances_read_own ON agreement_acceptances
  FOR SELECT TO authenticated
  USING (user_id = app.current_clerk_id());
