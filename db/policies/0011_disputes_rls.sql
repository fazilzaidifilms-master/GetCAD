-- 0011_disputes_rls.sql
-- You can read an order's disputes exactly when you can read the order (inherits
-- the order's client/designer/staff visibility). Writes go only through
-- raise_dispute() / resolve_dispute() — no write policy, so default-deny blocks
-- every direct write. Disputes carry no identity beyond opaque user ids.

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON disputes TO authenticated;

CREATE POLICY disputes_read ON disputes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = disputes.order_id));
