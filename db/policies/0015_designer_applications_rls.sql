-- 0015_designer_applications_rls.sql
-- Zero allow policies — direct access is denied to every role, anon included.
-- The only way in is submit_designer_application(), which runs as the
-- function owner (SECURITY DEFINER) and bypasses RLS for its own insert.
-- Staff review reads the table via the service-role admin client, which has
-- BYPASSRLS regardless of policies here — there is no self-service read path.

ALTER TABLE designer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE designer_applications FORCE  ROW LEVEL SECURITY;
