-- 0002_grants.sql
-- Table-level GRANTs to anon/authenticated, mirroring Supabase's defaults.
--
-- Why grant at all on an anonymity-critical system? Because this is exactly how
-- the "fails closed" guarantee is proven. With these grants, the anon role is
-- ALLOWED to issue `SELECT * FROM orders` — it does not hit a "permission
-- denied" error. Instead, the DEFAULT-DENY RLS from 0001 returns ZERO rows.
-- That is the difference between "the door is missing" and "the door is locked":
-- we want a locked door (RLS), proven by a caller who is permitted to knock.
--
-- Security therefore comes from RLS, never from withholding these grants. This
-- is the same model Supabase uses, so local/CI behaviour matches production.

GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, client_profiles, designer_profiles, orders
  TO anon, authenticated;

-- service_role is BYPASSRLS (trusted server-side); give it full table access.
GRANT ALL
  ON users, client_profiles, designer_profiles, orders
  TO service_role;
