-- 0022_email_outbox_rls.sql
-- Zero allow policies on `email_outbox`.
--
-- The rows hold recipient email addresses and are pure operational
-- bookkeeping — no user has a reason to read the send queue, and a recipient
-- address is exactly the kind of contact detail the double-blind keeps out of
-- reach. Everything here is written and drained server-side (enqueue_email,
-- claim_emails, record_email_result). Same shape as payment_intents (0018),
-- payout_accounts (0019) and payouts (0020): the functions are the only door.

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE  ROW LEVEL SECURITY;
