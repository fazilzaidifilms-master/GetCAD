-- 0014_marketing_leads_rls.sql
-- marketing_leads carries NO policy at all — RLS enabled and forced with zero
-- allow rules means every direct SELECT/INSERT/UPDATE/DELETE is denied to
-- anon/authenticated, matching the table's zero direct grants (0017). The only
-- way in is submit_marketing_lead() (SECURITY DEFINER, bypasses RLS). Leads are
-- reviewed via direct database/service-role access, not exposed through the app.

ALTER TABLE marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_leads FORCE  ROW LEVEL SECURITY;
