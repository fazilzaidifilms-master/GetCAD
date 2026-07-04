-- 0005_order_transitions_rls.sql
-- The transition graph is non-sensitive reference data (the rulebook), so any
-- authenticated user may READ it (e.g. to show which actions are available).
-- It is never written at runtime — only via migrations — so no write policy.

ALTER TABLE order_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_transitions FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON order_transitions TO authenticated;

CREATE POLICY order_transitions_read ON order_transitions
  FOR SELECT TO authenticated
  USING (true);
