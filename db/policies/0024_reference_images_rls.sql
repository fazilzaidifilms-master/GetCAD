-- 0024_reference_images_rls.sql
-- Who may see a reference picture and its pins.
--
-- Derived from the order's own visibility, exactly as the brief is (0023): the
-- policy asks whether the ORDER is visible and lets Postgres apply the five
-- policies on `orders` to that subquery. Restating those conditions here would
-- be a second copy that drifts the first time either changes.
--
-- Pins hang off images, so their policy asks the same question one join
-- further out. A pin whose image is invisible is invisible.
--
-- These pictures are the client's own photographs, which makes them the most
-- identity-rich thing in the system — but by the time a row exists here the
-- bytes have been through the sanitization gate and the object key is opaque.
-- Showing them to the assigned designer is the entire point of collecting them.

ALTER TABLE order_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_reference_pins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_reference_images FORCE ROW LEVEL SECURITY;
ALTER TABLE order_reference_pins   FORCE ROW LEVEL SECURITY;

CREATE POLICY order_reference_images_visible_with_order ON order_reference_images
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_reference_images.order_id)
  );

CREATE POLICY order_reference_pins_visible_with_image ON order_reference_pins
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM order_reference_images i
      WHERE i.id = order_reference_pins.image_id
    )
  );

-- No write policies, deliberately. Default-deny refuses direct writes outright;
-- add_reference_image, set_reference_pins, set_primary_reference and
-- remove_reference_image are the only ways in, and each checks ownership and
-- the quote freeze.
