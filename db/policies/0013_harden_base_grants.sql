-- 0013_harden_base_grants.sql
-- Defense-in-depth. The base tables (users, orders, client_profiles,
-- designer_profiles) were granted full CRUD to anon/authenticated by 0002
-- (mirroring Supabase's default grants). But EVERY write to them goes through a
-- SECURITY DEFINER function (create_order, ensure_self, apply_as_designer,
-- transition_order, quote_order, the escrow/dispute functions, …) which runs as
-- the owner and bypasses both grants and RLS. The app never writes these tables
-- directly.
--
-- So the direct INSERT/UPDATE/DELETE grants are pure attack surface: revoke them
-- so the ONLY write path is the audited functions, and so a future accidental
-- write policy could not be exploited. SELECT stays (RLS scopes it to the
-- caller's own / permitted rows). This matches every newer table, which is
-- SELECT-only for clients.

REVOKE INSERT, UPDATE, DELETE ON public.users             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orders            FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.client_profiles   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.designer_profiles FROM anon, authenticated;
