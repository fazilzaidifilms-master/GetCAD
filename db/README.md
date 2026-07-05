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
  - `0007_onboarding.sql` — `public.ensure_self()`: audited, idempotent self-signup (creates the caller's `users` row + a `USER_CREATED` audit entry).
  - `0008_order_state_machine.sql` — `order_transitions` (legal-move graph as data), `public.create_order()`, and `public.transition_order()` (role-gated, audited status changes).
  - `0009_designer_onboarding_gate.sql` — gated designer onboarding: `apply_as_designer()`, `accept_designer_agreement()` (audited), `app.designer_is_assignable()`; `transition_order`'s ASSIGNED step enforces the gate.
  - `0010_file_versions.sql` — `file_versions` (opaque keys only) + `public.add_file_version()` (audited, sets `orders.current_version_id`). Every key comes from the single sanitization gate (`core/files`).
  - `0011_legal_agreements.sql` — the real document behind the gate: `agreement_documents` (immutable, versioned, `content_sha256`-fingerprinted) + `agreement_acceptances` (immutable signatures); `app.current_agreement()`; `accept_designer_agreement()` now verifies the fingerprint and records a signature; the gate requires acceptance of the **current** version (new version ⇒ auto re-gate).
  - `0012_escrow.sql` — the money layer: append-only `escrow_ledger` (HOLD/RELEASE/REFUND) + `app.escrow_held()`; `quote_order()` (SALES, conserving split), `hold_escrow()` (client), `release_escrow()` / `refund_escrow()` (FINANCE). Money-bearing status changes live ONLY here; `transition_order` refuses `QUOTED`/`PAYMENT_HELD`/`PAYOUT_RELEASED`/`REFUNDED` so status and money can't diverge. **Money is conserved** (split sums to total; release legs sum to held; one HOLD per order).
  - `0013_messages.sql` — double-blind messaging: append-only `messages` (opaque `sender_id` + `sender_party` label, no identity columns) + `post_message()` (order's client/designer only; party derived, audited `MESSAGE_POSTED`).
  - `0014_disputes.sql` — structured disputes: `disputes` (reason + resolution) + `raise_dispute()` (client, with reason) and `resolve_dispute()` (OPS `REWORK` → IN_PROGRESS, or FINANCE `REFUND` reusing `refund_escrow`). `transition_order` refuses reaching/leaving `DISPUTED` so a reason + outcome are always captured. Audited `DISPUTE_RAISED`/`DISPUTE_RESOLVED`.
  - `0015_notifications.sql` — in-app `notifications` generated from the audit log by an AFTER INSERT trigger (`app.fanout_notifications`) — no existing function changes. Identity-free summaries to the order's parties (never the actor); best-effort (never breaks the business action). `mark_notifications_read()`.
  - `0016_order_timeline.sql` — `public.order_timeline(order_id)`: a client-safe, order-scoped window onto the audit log (whitelisted lifecycle actions only, every row stripped of `actor_id` — only `actor_role` travels). Re-derives the exact visibility of orders RLS (0003 client/designer/QC + 0006 staff-queue) since a SECURITY DEFINER function bypasses RLS. Powers the order timeline + the visible independent-QC milestone.
  - `0017_marketing_leads.sql` — `marketing_leads` (public Contact Sales inbox), deliberately isolated from the order/user domain (no FKs, no audit-log entry — a form submitter is not a platform user). Sole write path is `public.submit_marketing_lead()` (SECURITY DEFINER); the table itself carries no direct grants, matching the same "no public table grants direct writes" convention as everywhere else.
- `policies/` — Row-Level Security, applied after migrations:
  - `0001_enable_rls_default_deny.sql` — RLS on every table, **zero allow policies** (locked shut).
  - `0002_grants.sql` — anon/authenticated grants mirroring Supabase, so default-deny is proven at the RLS layer.
  - `0003_identity_allow_policies.sql` — first identity-gated **READ** policies (self-read on users/profiles; client/designer/QC reads on orders). Writes and staff identity-piercing reads stay deferred.
  - `0004_audit_log_rls.sql` — locks the audit log shut (RLS default-deny + grants: only `service_role` may read/append, never update/delete).
  - `0005_order_transitions_rls.sql` — RLS on the transition graph; authenticated users may read it (reference data), never write it.
  - `0006_staff_order_read.sql` — staff order visibility tied to the state machine (a role reads an order only when it has a legal move on it); orders carry no identity, so not an identity-piercing read.
  - `0007_file_versions_rls.sql` — you can read a file version only if you can read its order (inherits order visibility).
  - `0008_legal_agreements_rls.sql` — agreement documents readable by any authenticated user (you must read what you sign); signatures readable only by their signer; all writes go through `accept_designer_agreement()` (no direct-write policy).
  - `0009_escrow_rls.sql` — you can read an order's escrow ledger only if you can read the order (inherits order visibility); all writes go through the escrow functions (no direct-write policy).
  - `0010_messages_rls.sql` — you can read an order's messages only if you can read the order; never joins a profile, so it reveals nothing about the counterparty beyond their party label. Writes go through `post_message()` (no direct-write policy).
  - `0011_disputes_rls.sql` — you can read an order's disputes only if you can read the order; writes go through `raise_dispute()`/`resolve_dispute()` (no direct-write policy).
  - `0012_notifications_rls.sql` — you can read ONLY your own notifications; writes go through the fan-out trigger + `mark_notifications_read()` (no direct-write policy).
  - `0013_harden_base_grants.sql` — defense-in-depth: revokes `INSERT/UPDATE/DELETE` on the base tables (`users`, `orders`, `client_profiles`, `designer_profiles`) from `anon`/`authenticated`. All writes go through SECURITY DEFINER functions (which bypass grants+RLS), so direct writes are locked at the grant level — the ONLY write path is the audited functions. `SELECT` stays (RLS scopes it).
  - `0014_marketing_leads_rls.sql` — RLS enabled + forced on `marketing_leads` with **zero** allow policies (not even SELECT) — direct access is denied to every role, anon included. The only way in is `submit_marketing_lead()`, which runs as the function owner and bypasses RLS entirely.

## Order state machine

An order changes status **only** via `public.transition_order(order_id, new_status, payload)`.
It is enforced end-to-end:

- **Legal moves only** — the move must exist in the `order_transitions` graph
  (`DRAFT → SUBMITTED → QUOTED → PAYMENT_HELD → ASSIGNED → IN_PROGRESS →
  DESIGNER_SUBMITTED → QC_REVIEW → CLIENT_PREVIEW → APPROVED → DELIVERED → CLOSED
  → PAYOUT_RELEASED`, plus CANCELLED/DISPUTED/REFUNDED exits).
- **Right role + right party** — the caller's role (`app.current_user_role()`)
  must match, and for CLIENT_PARTY/DESIGNER_PARTY moves they must be the order's
  client / assigned designer. Identity comes from the verified token.
- **Audited** — each move appends an `ORDER_STATUS_CHANGED` entry; `create_order`
  appends `ORDER_CREATED`. Atomic with the status change.

The transition matrix is a **first cut** (data-driven, easy to revise).

## Onboarding

- **Client** — light: `public.ensure_self()` creates a `CLIENT/ACTIVE` row on
  first login, audited (`USER_CREATED`).
- **Designer** — gated: `public.apply_as_designer()` sets role DESIGNER /
  status PENDING and creates the identity profile (audited `DESIGNER_APPLIED`).
  The designer is **not assignable** until `public.accept_designer_agreement()`
  records a signature and flips them to ACTIVE (audited `SIGNED_AGREEMENT`).
  `transition_order`'s ASSIGNED step calls `app.designer_is_assignable()` to
  enforce this — which checks for a real signature against the current version.

> The agreement **document is now wired** (`0011`): a real, versioned
> `agreement_documents` row is fingerprinted with `content_sha256`, and
> `accept_designer_agreement(expected_sha256)` verifies the caller signed the
> current text before recording an **immutable** `agreement_acceptances` row
> (version + fingerprint, audited). The gate requires acceptance of the **current**
> version, so publishing a new version auto re-gates every designer until they
> re-accept; old signatures remain as proof. Counsel-drafted text replaces the
> starter body as a new version — the seeded `v1` body is never edited in place.

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
