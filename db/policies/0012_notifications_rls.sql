-- 0012_notifications_rls.sql
-- You can read ONLY your own notifications. Writes happen through the fan-out
-- trigger (SECURITY DEFINER) and mark_notifications_read() — there is no direct
-- write policy, so default-deny blocks every direct write.

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON notifications TO authenticated;

CREATE POLICY notifications_read_own ON notifications
  FOR SELECT TO authenticated
  USING (user_id = app.current_clerk_id());
