-- 0001_enable_rls_default_deny.sql
-- DEFAULT-DENY. Every table has Row-Level Security ENABLED and ZERO allow
-- policies. In Postgres, RLS-enabled + no policy = no row is ever visible or
-- writable to a non-superuser, non-BYPASSRLS role. The table is locked shut.
--
-- This is the safety net for the whole system: until a later slice writes
-- explicit, per-role ALLOW policies, the data is unreachable by anon and
-- authenticated. There are intentionally NO allow policies in this slice.
--
-- FORCE makes RLS apply even to the table OWNER, so a future bug that runs app
-- queries as the owner role still can't bypass the lock. (Superuser and
-- BYPASSRLS roles — i.e. migration/service_role — still bypass, by design.)

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             FORCE  ROW LEVEL SECURITY;

ALTER TABLE client_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles   FORCE  ROW LEVEL SECURITY;

ALTER TABLE designer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE designer_profiles FORCE  ROW LEVEL SECURITY;

ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders            FORCE  ROW LEVEL SECURITY;
