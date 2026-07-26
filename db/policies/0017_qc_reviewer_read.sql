-- 0017_qc_reviewer_read.sql
-- A QC reviewer keeps visibility of the orders they personally reviewed.
--
-- Without this, an order vanishes from the reviewer's view the instant they
-- decide (0003's QC policy is scoped to QC_REVIEW/REVISION_REQUESTED), so they
-- could not see the outcome of their own work or verify the payout attributed
-- to them in 0020.
--
-- Orders carry no identity, so this reveals nothing about either party — it is
-- the same non-identity-piercing read the other order policies grant.

CREATE POLICY orders_qc_reviewer_select ON orders
  FOR SELECT TO authenticated
  USING (qc_reviewer_id = app.current_clerk_id());
