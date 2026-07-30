-- 0020_payouts_rls.sql
-- Zero allow policies on `payouts`.
--
-- The rows carry processor transfer references and the linked-account handle
-- money was sent to. A payee has a legitimate need to see their own amounts and
-- states, but no need whatsoever for our integration's identifiers — and a
-- client, a designer looking at another designer, QC, SALES and OPS have no
-- business here at all. my_payouts() serves the legitimate need with a
-- deliberately narrower column list.
--
-- Same shape as payment_intents (0018) and payout_accounts (0019): the money
-- machinery is server-side bookkeeping, and the function is the only door.

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts FORCE  ROW LEVEL SECURITY;
