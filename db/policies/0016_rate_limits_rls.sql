-- 0016_rate_limits_rls.sql
-- Zero allow policies — the limiter's bookkeeping is not readable or writable
-- by any client role. check_rate_limit() runs as the function owner and is the
-- only way in, exactly like marketing_leads and designer_applications.

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_events FORCE  ROW LEVEL SECURITY;
