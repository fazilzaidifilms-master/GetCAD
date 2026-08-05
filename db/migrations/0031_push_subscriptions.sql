-- 0031_push_subscriptions.sql
-- Deliver the notifications we already generate (0015) to a device.
--
-- WHY THERE IS NO SECOND OUTBOX. Email needed one (0025) because an email is a
-- thing that does not otherwise exist: a recipient address, a template and a
-- payload with no home in any table. A push notification has a home already —
-- `notifications` is literally a table of "person X should be told Y", written
-- transactionally by the fan-out trigger. Adding a parallel push_outbox would
-- mean two queues that can disagree about what happened. Instead this migration
-- gives `notifications` the two columns a queue needs and leaves the rest
-- alone.
--
-- WHAT A SUBSCRIPTION IS. A push endpoint is a CAPABILITY URL: anyone holding
-- it can send a notification to that device, forever, without authenticating to
-- us. It is closer to a bearer token than to an address, which is why the table
-- is readable only by its owner and why nothing here is ever returned to a
-- client other than the person it belongs to.

CREATE TABLE push_subscriptions (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  -- Issued by the browser's push service (FCM, Mozilla, Apple). Unique across
  -- the table because it identifies a BROWSER PROFILE, not a person — see the
  -- ownership transfer in save_push_subscription below.
  endpoint     text        NOT NULL UNIQUE,

  -- The client's public key and auth secret, used to encrypt each payload so
  -- the push service relays ciphertext it cannot read. Base64url, no padding.
  --
  -- Alphabet and length are checked separately rather than as one {n,m} regex:
  -- Postgres caps regex repetition counts at 255, so a bound written that way
  -- is a runtime error on a value nobody tested with, not a rejected input.
  p256dh       text        NOT NULL
                 CHECK (p256dh ~ '^[A-Za-z0-9_-]+$' AND char_length(p256dh) BETWEEN 20 AND 255),
  auth         text        NOT NULL
                 CHECK (auth ~ '^[A-Za-z0-9_-]+$' AND char_length(auth) BETWEEN 8 AND 64),

  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Deliberately NOT stored: user agent, device name, IP, locale. None of it is
-- needed to send a notification, and a device fingerprint attached to an
-- identity is the kind of record that only ever becomes a liability. The cost
-- is that the account screen cannot say "iPhone" — it says "this device",
-- which is the only thing the person reading it needs to know anyway.

GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT ALL    ON public.push_subscriptions TO service_role;

-- ------------------------------------------------------------- register --

-- Register (or re-register) the calling user's subscription for this browser.
--
-- THE ON CONFLICT IS A SECURITY RULE, NOT A CONVENIENCE. The endpoint belongs
-- to a browser profile, and browser profiles get handed over: a designer signs
-- out on a shared workshop laptop and a colleague signs in. The push service
-- issues that browser the SAME endpoint. If the row kept its original owner,
-- the second person's device would receive the first person's notifications —
-- across the double-blind, on a lock screen, with no way for either to know.
-- So the most recent authenticated registrant takes ownership.
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_id       text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_endpoint IS NULL
     OR p_endpoint !~ '^https://[^[:space:]]+$'
     OR char_length(p_endpoint) NOT BETWEEN 20 AND 2000 THEN
    RAISE EXCEPTION 'push endpoint must be an https URL';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (v_clerk_id, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id      = v_clerk_id,
        p256dh       = EXCLUDED.p256dh,
        auth         = EXCLUDED.auth,
        last_used_at = NULL,
        created_at   = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) TO authenticated, service_role;

-- Turn notifications off for this device. Scoped to the caller so knowing
-- someone else's endpoint does not let you silence them.
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_count    integer;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = v_clerk_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated, service_role;

-- Drop a subscription the push service has told us is dead (404/410). Called by
-- the dispatcher under the service role, so it is not scoped to a caller — but
-- it is also not reachable by anyone else.
CREATE OR REPLACE FUNCTION public.expire_push_subscription(p_endpoint text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.expire_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_push_subscription(text) TO service_role;

-- --------------------------------------------------- notifications queue --

ALTER TABLE notifications
  ADD COLUMN pushed_at     timestamptz,
  ADD COLUMN push_attempts integer NOT NULL DEFAULT 0 CHECK (push_attempts >= 0);

-- The dispatcher's queue. Partial, so it stays the size of the backlog rather
-- than the size of the table — this index is read every run and most rows in
-- `notifications` are long since delivered.
CREATE INDEX notifications_push_queue_idx ON notifications (created_at)
  WHERE pushed_at IS NULL;

-- Take the next batch to push.
--
-- STALE NOTIFICATIONS ARE DROPPED, NOT DELIVERED. A phone that has been off for
-- three days should not vibrate eleven times when it comes back, announcing
-- events the person has already seen in the app. Anything past the cutoff is
-- marked done without being sent — the notification still exists in the app,
-- where it belongs; it just stops being urgent. This also bounds the damage
-- from a dispatcher that has not run in a week.
--
-- SKIP LOCKED so two dispatchers never claim the same row, matching the email
-- and payout workers.
CREATE OR REPLACE FUNCTION public.claim_push_notifications(
  p_limit    integer  DEFAULT 50,
  p_max_age  interval DEFAULT interval '24 hours',
  p_attempts integer  DEFAULT 3
)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Retire anything too old to be worth sending, in one statement, before the
  -- claim below can pick it up.
  UPDATE public.notifications
  SET pushed_at = now()
  WHERE pushed_at IS NULL
    AND created_at < now() - p_max_age;

  RETURN QUERY
  UPDATE public.notifications n
  SET push_attempts = n.push_attempts + 1
  WHERE n.id IN (
    SELECT id FROM public.notifications
    WHERE pushed_at IS NULL
      AND push_attempts < p_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(p_limit, 0)
  )
  RETURNING n.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_push_notifications(integer, interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_push_notifications(integer, interval, integer) TO service_role;

-- Mark a batch delivered (or deliberately skipped — a recipient with no
-- registered device is "done", not "failed", and must not be retried forever).
CREATE OR REPLACE FUNCTION public.mark_push_sent(p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.notifications
  SET pushed_at = now()
  WHERE id = ANY(coalesce(p_ids, ARRAY[]::text[]))
    AND pushed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.mark_push_sent(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_push_sent(text[]) TO service_role;

-- Everything already in the table predates push. Marking it delivered stops the
-- first dispatcher run from pushing the entire history at everyone at once —
-- the single worst first impression this feature could make.
UPDATE notifications SET pushed_at = now() WHERE pushed_at IS NULL;
