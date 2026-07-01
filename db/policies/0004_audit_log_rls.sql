-- 0004_audit_log_rls.sql
-- Lock the audit log shut. RLS default-deny (no allow policies) plus strict
-- grants: only the trusted server (service_role, which is BYPASSRLS) may read
-- and APPEND — never update or delete. anon and authenticated get nothing: they
-- cannot even reach the `audit` schema.

ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log FORCE  ROW LEVEL SECURITY;

-- Least privilege for untrusted roles: no access to the schema at all.
REVOKE ALL ON SCHEMA audit           FROM anon, authenticated;
REVOKE ALL ON audit.audit_log        FROM anon, authenticated;

-- Functions default to EXECUTE for PUBLIC — revoke that so only granted roles run them.
REVOKE ALL ON FUNCTION audit.log_event(text, text, text, text, public.role, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.verify_chain()                                                  FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.chain_before_insert()                                           FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.prevent_mutation()                                              FROM PUBLIC;

-- The trusted server role may read + append (and run the helpers). Never UPDATE/DELETE.
GRANT USAGE ON SCHEMA audit TO service_role;
GRANT SELECT, INSERT ON audit.audit_log TO service_role;
GRANT USAGE ON SEQUENCE audit.audit_log_seq TO service_role;
GRANT EXECUTE ON FUNCTION audit.log_event(text, text, text, text, public.role, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION audit.verify_chain() TO service_role;
