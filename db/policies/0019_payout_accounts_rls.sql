-- 0019_payout_accounts_rls.sql
-- ZERO allow policies — deliberately stricter than any other identity table.
--
-- Everywhere else, the owning user may SELECT their own row (policies/0003).
-- Not here. A designer reading `payout_accounts` directly would pull back their
-- own full PAN and full bank account number, which means a stolen session token
-- exfiltrates both. There is no product reason for that: the owner already
-- knows their bank details, and the only legitimate need is to confirm WHICH
-- account is on file — which my_payout_account() answers with last-four
-- fragments and no secrets.
--
-- So the read path is a SECURITY DEFINER function that returns strictly less
-- than the row contains, and the table itself is unreadable by every client
-- role. Same shape as rate_limit_events (0016) and the application tables
-- (0014, 0015): the function is the only door.
--
-- The double-blind needs no extra work here. With no policy, a client, a
-- designer looking at another designer, QC, SALES and OPS all get zero rows.

ALTER TABLE payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_accounts FORCE  ROW LEVEL SECURITY;
