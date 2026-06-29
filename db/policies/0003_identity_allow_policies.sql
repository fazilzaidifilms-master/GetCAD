-- 0003_identity_allow_policies.sql
-- The FIRST identity-gated ALLOW policies. Everything here is READ-only
-- (FOR SELECT). Default-deny from 0001 still governs every command that has no
-- matching policy: ALL writes (INSERT/UPDATE/DELETE) remain locked shut, and so
-- does any read not listed below.
--
-- These policies are granted TO authenticated, so the anon role keeps seeing
-- nothing at all. Identity comes from app.current_clerk_id() (the verified Clerk
-- sub); role comes from app.current_user_role().
--
-- DOUBLE-BLIND INVARIANT: no policy below ever lets one side of a trade read the
-- OTHER side's identity table. A client reads its own client_profile; a designer
-- reads its own designer_profile; neither can read the other's. Orders carry no
-- identity (only opaque FKs), so seeing an order reveals no person.
--
-- DEFERRED (NOT in this slice): write/transition policies (the order
-- state-machine slice) and any staff/admin identity-piercing read (which must
-- go through the append-only audit log — a later slice). Until those exist,
-- default-deny keeps them out.

-- users: a user may read ONLY their own row.
CREATE POLICY users_self_select ON users
  FOR SELECT TO authenticated
  USING (id = app.current_clerk_id());

-- client_profiles: the owning user only.
CREATE POLICY client_profiles_self_select ON client_profiles
  FOR SELECT TO authenticated
  USING (user_id = app.current_clerk_id());

-- designer_profiles: the owning user only.
CREATE POLICY designer_profiles_self_select ON designer_profiles
  FOR SELECT TO authenticated
  USING (user_id = app.current_clerk_id());

-- orders: a CLIENT sees the orders they own.
CREATE POLICY orders_client_select ON orders
  FOR SELECT TO authenticated
  USING (client_id = app.current_clerk_id());

-- orders: a DESIGNER sees the orders assigned to them.
CREATE POLICY orders_designer_select ON orders
  FOR SELECT TO authenticated
  USING (designer_id = app.current_clerk_id());

-- orders: QC (the mandatory review gate) sees orders currently in review.
-- Orders expose no identity, so this preserves the double-blind.
CREATE POLICY orders_qc_select ON orders
  FOR SELECT TO authenticated
  USING (
    app.current_user_role() = 'QC'
    AND status IN ('QC_REVIEW', 'REVISION_REQUESTED')
  );
