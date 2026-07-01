# db/

The database is the source of truth and the last line of defense. Everything
here is **versioned SQL in the repo**. Schema changes are applied via Supabase
**migrations**, NEVER by clicking around the Supabase dashboard — the dashboard
leaves no reviewable, replayable history.

## Layout

- `migrations/` — schema, applied in filename order:
  - `0000_roles.sql` — create Supabase-compatible roles on a bare Postgres (no-op on Supabase).
  - `0001_enums.sql` — native Postgres enums (`role`, `user_status`, `order_status`).
  - `0002_users.sql` — Clerk-synced accounts, **no identity**.
  - `0003_profiles.sql` — `client_profiles` + `designer_profiles`, identity isolated, one per side.
  - `0004_orders.sql` — orders; money as integer minor units; opaque FKs only.
  - `0005_auth_identity.sql` — `app` schema identity helpers (`app.current_clerk_id()`, `app.current_user_role()`) the policies use; the DB side of the Clerk→Supabase bridge.
  - `0006_audit_log.sql` — append-only, hash-chained `audit.audit_log` + helpers (`audit.log_event()`, `audit.verify_chain()`).
- `policies/` — Row-Level Security, applied after migrations:
  - `0001_enable_rls_default_deny.sql` — RLS on every table, **zero allow policies** (locked shut).
  - `0002_grants.sql` — anon/authenticated grants mirroring Supabase, so default-deny is proven at the RLS layer.
  - `0003_identity_allow_policies.sql` — first identity-gated **READ** policies (self-read on users/profiles; client/designer/QC reads on orders). Writes and staff identity-piercing reads stay deferred.
  - `0004_audit_log_rls.sql` — locks the audit log shut (RLS default-deny + grants: only `service_role` may read/append, never update/delete).

## Audit log (append-only, hash-chained)

`audit.audit_log` records every state change and identity-piercing read as an
immutable entry. Enforced by the database:

- **Append-only** — an `UPDATE`/`DELETE`/`TRUNCATE` trigger raises, so history
  cannot be rewritten (even by a privileged connection).
- **Tamper-evident** — each entry's `hash` = SHA-256 over its contents + the
  previous entry's `hash` (a chain). `audit.verify_chain()` recomputes the chain
  and returns `{valid:false, broken_at:<seq>}` if any past entry was altered.
- Written only via `audit.log_event(...)`; readable only by `service_role`.
- Hashing uses Postgres built-ins (`sha256`) — identical on local PG and Supabase.

## Clerk → Supabase identity bridge

Verified Clerk JWT claims arrive in the `request.jwt.claims` setting (set by
Supabase/PostgREST). `app.current_clerk_id()` reads the `sub` from there — it is
the portable equivalent of Supabase's `auth.jwt()->>'sub'`, and equals our
`users.id`. RLS policies gate every row on it.

> **Config exception (flagged):** registering Clerk as a Supabase **Third-Party
> Auth** provider is a project setting (Supabase dashboard / Management API), not
> SQL. That one step is config — all schema and RLS stay versioned SQL here.

## Applying

```bash
# Local throwaway Postgres or any database:
DATABASE_URL=postgres://user:pass@host:5432/db npm run db:apply
```

`scripts/apply-migrations.mjs` runs every file in `migrations/` then `policies/`
in filename order, inside a transaction per file.

## Non-negotiables encoded here

- Opaque text IDs only — no sequential integers, no serial/identity columns.
- Money is `integer` minor units with `CHECK (>= 0)` — never floats.
- Identity is isolated in the profile tables — never on `users` or `orders`.
- All FKs are `ON DELETE RESTRICT`.
- Default-deny RLS on every table; allow policies come in a later slice.
