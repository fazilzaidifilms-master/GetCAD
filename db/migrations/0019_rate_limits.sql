-- 0019_rate_limits.sql
-- Abuse control for the PUBLIC, unauthenticated forms (Contact Sales, designer
-- application). Those two are the only surfaces an anonymous visitor can write
-- through, and until now nothing bounded how often they could do it.
--
-- Deliberately database-backed rather than in-process: the app is deployed
-- serverless, so an in-memory counter would reset on every cold start and be
-- per-instance — i.e. no limit at all in practice.
--
-- PRIVACY: this table never stores an IP. The caller hashes the client address
-- with a server-side salt (lib/rateLimit.ts) and passes only the digest, so the
-- row is an opaque bucket key. Consistent with the rest of the schema: the
-- table carries no grants and the SECURITY DEFINER function is the only path in.

CREATE TABLE rate_limit_events (
  id      bigserial   PRIMARY KEY,
  bucket  text        NOT NULL,
  hit_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rate_limit_events_bucket_idx ON rate_limit_events (bucket, hit_at DESC);

-- Sliding-window limiter. Returns true if the caller may proceed (and records
-- the hit), false if they are over the limit (recording nothing, so a sustained
-- attacker cannot inflate the table).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket         text,
  p_max_hits       integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window interval;
  v_hits   integer;
BEGIN
  IF p_bucket IS NULL OR btrim(p_bucket) = '' THEN
    RAISE EXCEPTION 'bucket is required';
  END IF;
  IF p_max_hits IS NULL OR p_max_hits < 1 THEN
    RAISE EXCEPTION 'max_hits must be >= 1';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'window_seconds must be >= 1';
  END IF;

  v_window := make_interval(secs => p_window_seconds);

  -- Opportunistic prune: this bucket's rows that have aged out of the window.
  DELETE FROM public.rate_limit_events
  WHERE bucket = p_bucket AND hit_at < now() - v_window;

  SELECT count(*) INTO v_hits
  FROM public.rate_limit_events
  WHERE bucket = p_bucket AND hit_at >= now() - v_window;

  IF v_hits >= p_max_hits THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_events (bucket) VALUES (p_bucket);
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  TO anon, authenticated, service_role;
