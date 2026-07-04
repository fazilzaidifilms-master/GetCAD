-- 0010_messages_rls.sql
-- You can read an order's messages exactly when you can read the order (the
-- subquery runs under the caller's RLS on `orders`, inheriting the
-- client/designer/staff visibility rules). Writes go only through post_message()
-- — there is no write policy, so default-deny blocks every direct write.
--
-- Double-blind holds: messages carry no identity, and this policy never joins to
-- a profile table, so reading a thread reveals nothing about who the counterparty
-- is beyond their party label.

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON messages TO authenticated;

CREATE POLICY messages_read ON messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = messages.order_id));
