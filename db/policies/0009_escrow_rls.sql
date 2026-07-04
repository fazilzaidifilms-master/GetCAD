-- 0009_escrow_rls.sql
-- You can read an order's escrow ledger exactly when you can read the order (the
-- subquery runs under the caller's RLS on `orders`, inheriting all the
-- client/designer/QC/staff visibility rules). All WRITES go only through the
-- escrow functions (hold/release/refund/quote) — there is no write policy, so
-- default-deny blocks every direct write.
--
-- FLAGGED: this exposes every leg (incl. platform_commission) to any order
-- participant. Amounts carry no identity, so this is not a double-blind leak, but
-- a later slice may restrict a designer to seeing only their own payout leg.

ALTER TABLE escrow_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_ledger FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON escrow_ledger TO authenticated;

CREATE POLICY escrow_ledger_read ON escrow_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = escrow_ledger.order_id));
