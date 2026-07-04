-- 0006_staff_order_read.sql
-- Staff visibility into orders, tied to the state machine: a STAFF-role user may
-- READ an order exactly when their role has a legal move on it right now (i.e.
-- there is a STAFF-scope transition out of the order's current status for their
-- role). So sales sees SUBMITTED (to quote), ops sees PAYMENT_HELD (to assign),
-- finance sees CLOSED (to release payout), etc. — and each order leaves their
-- queue once they act on it.
--
-- Orders carry NO identity (only opaque FKs), so this is NOT an identity-piercing
-- read — no audit gate required. Reading the people behind an order
-- (client/designer profiles) remains locked and will be a separate, audited slice.

CREATE POLICY orders_staff_select ON orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM order_transitions t
      WHERE t.from_status = orders.status
        AND t.actor_role  = app.current_user_role()
        AND t.actor_scope = 'STAFF'
    )
  );
