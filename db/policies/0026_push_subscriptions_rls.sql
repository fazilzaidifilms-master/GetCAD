-- 0026_push_subscriptions_rls.sql
-- You can read ONLY your own push subscriptions, and you can write none of them
-- directly. Registration goes through save_push_subscription() and removal
-- through delete_push_subscription(), both SECURITY DEFINER and both scoped to
-- the caller.
--
-- WHY READ IS SCOPED AS TIGHTLY AS WRITE. An endpoint is a capability: whoever
-- holds it can push a notification to that device without authenticating to us
-- at all. A policy that let one authenticated user read another's row would
-- hand out a permanent, unrevocable-by-the-victim channel to their lock
-- screen. That is worse than most read leaks, because the victim cannot even
-- tell where it came from.

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_read_own ON push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = app.current_clerk_id());
