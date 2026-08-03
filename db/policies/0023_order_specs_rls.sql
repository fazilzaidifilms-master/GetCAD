-- 0023_order_specs_rls.sql
-- Who may read a brief.
--
-- THE ANSWER IS DERIVED, NOT RESTATED. "Who can see this order" is already
-- decided by five policies on `orders` (client, designer, QC, staff-by-legal-
-- move, QC reviewer). Writing a sixth set of the same conditions here would be
-- two copies of one rule, and the copies would drift the first time either
-- changes.
--
-- So the policy asks whether the ORDER is visible, and lets Postgres apply the
-- orders policies to that subquery. A role that cannot see an order cannot see
-- its brief, automatically and forever — including for a visibility rule that
-- does not exist yet.
--
-- The brief carries no identity: no names, no company, no contact. It describes
-- a piece of jewellery. The double-blind is unaffected by opening it to the
-- designer, which is the entire point of collecting it.

ALTER TABLE order_specs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_spec_accents ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_specs        FORCE ROW LEVEL SECURITY;
ALTER TABLE order_spec_accents FORCE ROW LEVEL SECURITY;

CREATE POLICY order_specs_visible_with_order ON order_specs
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_specs.order_id)
  );

CREATE POLICY order_spec_accents_visible_with_order ON order_spec_accents
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_spec_accents.order_id)
  );

-- No INSERT/UPDATE/DELETE policy on either table, deliberately. Default-deny
-- means writes are refused outright; `upsert_order_spec` and `set_order_accents`
-- are the only ways in, and they check ownership and the quote freeze.
