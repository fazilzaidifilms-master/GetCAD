-- 0018_payment_intents_rls.sql
-- Zero allow policies. A payment intent is server-side bookkeeping: the client
-- learns what they need from the checkout handoff, not by reading this table.
-- open_payment_intent()/confirm_payment() run as the function owner and are the
-- only way in, matching every other write path in this schema.

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents FORCE  ROW LEVEL SECURITY;
