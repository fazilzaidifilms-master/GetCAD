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
  - `0018_designer_applications.sql` — `designer_applications`: Stage 1 of designer onboarding, a public screening lead (NOT a `users`/`designer_profiles` row — conversion happens manually per-candidate after staff review). Sole write path is `public.submit_designer_application()` (SECURITY DEFINER, no direct table grants); unlike `marketing_leads` this DOES write an audited `APPLICATION_SUBMITTED` entry (actor_id/actor_role NULL — the applicant isn't a platform user), since staff need an operational record of applications. Enforces exactly one portfolio path (a URL, or 2-3 sanitized file keys) at both the table CHECK and the function.
  - `0019_rate_limits.sql` — `rate_limit_events` + `public.check_rate_limit()`: a sliding-window limiter for the PUBLIC forms. Database-backed on purpose (an in-process counter resets on every serverless cold start). Stores only a salted hash of the client address, never an IP; blocked calls record nothing, so a sustained attacker cannot inflate the table.
  - `0020_qc_identity.sql` — makes independent QC a real constraint: `orders.qc_reviewer_id` (who actually reviewed) and `escrow_ledger.payee_id` (who a payout is FOR — `created_by` only ever recorded who pushed the button). `record_qc_decision()` records the reviewer and REFUSES self-review (you cannot review work you produced, or your own order); `transition_order` refuses QC_REVIEW→CLIENT_PREVIEW/REVISION_REQUESTED so a decision always carries a reviewer, and refuses assigning an order to its own reviewer. `release_escrow` now stamps each leg with its payee and REFUSES to release a QC payout when no reviewer is recorded. Claim-on-action, not pre-assignment: QC stays a pool, but the reviewer is recorded and checked at decision time.
  - `0021_settlement_ledger.sql` — prepares the money layer for a real processor, PROCESSOR-AGNOSTIC (nothing names Stripe/Razorpay). Adds `external_ref` (reconciliation), a UNIQUE `idempotency_key` (webhooks arrive more than once), and a nullable `fx_rate`. New kinds `PROCESSOR_FEE`/`CHARGEBACK`/`REVERSAL` and a `PROCESSOR` party. `app.escrow_sign()` puts each kind's direction in ONE place — the old inline `CASE kind WHEN 'HOLD' THEN amount ELSE -amount END` silently subtracted anything new, so a REVERSAL would have removed money that actually returned. **Conservation is now a TRIGGER on the table**, not just logic inside the escrow functions, so no write path (service-role script, future webhook handler) can overdraw an order. `refund_escrow(order, amount DEFAULT NULL)` supports partial refunds — the order only reaches REFUNDED when escrow empties. `record_settlement_event()` (service_role only) records processor-driven money WITHOUT changing `order_status`, so a chargeback after PAYOUT_RELEASED is representable. `settlement_state()` derives the money truth from the ledger.
  - `0022_payment_collection.sql` — **real money in**. Until now `hold_escrow()` was a button the CLIENT pressed, with no payment behind it — fine while the money layer was a simulation, a hole the moment a processor exists. Funding moves from "the client asserts it" to "the processor confirms it": `hold_escrow` is **REVOKED from `authenticated`**, and `confirm_payment()` (service_role only, called behind a verified HMAC signature) is the new door. `payment_intents` records what we asked to collect BEFORE the client touches the processor, so a confirmation is validated against **our** amount, never the webhook's. Idempotent by intent status + ledger key, so redelivery is a no-op. Still processor-agnostic at the SQL layer.
  - `0023_payout_accounts.sql` — **real money out.** `release_escrow` would write a RELEASE leg draining escrow to zero with no record anywhere of a bank account to send it to, so the ledger said "paid" while the designer was not. `payout_accounts` (keyed on `user_id`, not designer — QC reviewers are paid through the same legs) holds validated Indian payout identity: PAN, account number, IFSC, account type, with `account_last4`/`pan_last4` as GENERATED columns. Shapes come from `core/payouts/bankAccountIn`, the same module the form and the Server Action use, so the browser cannot accept what the database rejects. **Strictest table in the schema:** zero allow policies (see `policies/0019`) — not even the owner SELECTs it; `my_payout_account()` returns last-four fragments only. `upsert_payout_account()` takes **no user_id**, so identity comes from the token and no argument can redirect someone else's money; changing the destination **resets `VERIFIED` to `PENDING_VERIFICATION`** and drops the processor handles, closing a payout-hijack path. `set_payout_account_status()` is service_role only. `release_escrow` now REFUSES a designer or QC payout whose payee has no VERIFIED account. Drops the old unstructured `designer_profiles.payout_details` free-text sink.
  - `0024_payout_execution.sql` — **real money out.** `escrow_ledger` says what we OWE (a RELEASE leg is an obligation); `payouts` says what we have SENT. Conflating the two is how a platform believes it paid someone because it wrote a row about it. **One payout per RELEASE leg, forever** — a UNIQUE constraint on `ledger_id`, not careful code, because the failure mode is paying a designer twice and every retry path eventually re-runs the same instruction. `open_payouts_for_order()` derives instructions from the legs (idempotent; PLATFORM legs get no row — that money is already ours) and re-checks the payee is still VERIFIED, since release and execution are separate doors. `claim_payouts()` is a real work queue: `FOR UPDATE SKIP LOCKED` so two executors take different rows, flipping to PROCESSING and counting the attempt in the SAME statement so a crash mid-send leaves evidence. A PROCESSING row is deliberately NOT re-claimed — a transfer may be in flight — so `stale_payouts()` surfaces it for reconciliation against the processor instead. `record_payout_result()` (service_role only) is idempotent per state; REVERSED is the money-bearing one and writes a REVERSAL leg keyed off the payout, so a redelivered reversal cannot credit escrow twice. It accepts REVERSED from PROCESSING as well as PAID, because a reversal can beat our own success webhook and refusing it would 500 forever against Razorpay's retries. `my_payouts()` gives a payee amounts and states with no processor internals; `payout_state()` derives owed-versus-sent for reconciliation.

  - `0026_triage.sql` — the STAFF side of the two public inboxes. Applications (0018) and leads (0017) could be written by the public and read by nobody through the app; reviewing meant opening the database by hand. Adds staff read + decision paths WITHOUT weakening the zero-allow posture — the tables stay grant-less and unreadable directly, and these SECURITY DEFINER functions are the only door. LEAST PRIVILEGE: `app.require_triage_staff()` admits only OPS and SALES (QC/FINANCE are staff but have no business seeing an applicant's phone number). `list_designer_applications()` / `review_designer_application()` (audited `APPLICATION_REVIEWED` with the actor; accepting records a DECISION, it does NOT mint a designer account — conversion stays manual per 0018) and `list_marketing_leads()` / `set_lead_status()` (audited `LEAD_STATUS_CHANGED` — a staff action on a lead IS a platform action, unlike the public submit). Adds `reviewed_by/at`, `review_notes` to applications and `status/handled_by/at` to leads.
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
  - `0015_designer_applications_rls.sql` — same zero-allow-policy treatment for `designer_applications`. Staff review reads the table via the service-role admin client (BYPASSRLS), never through a client-scoped policy.
  - `0016_rate_limits_rls.sql` — zero allow policies on `rate_limit_events`; `check_rate_limit()` is the only path in.
  - `0018_payment_intents_rls.sql` — zero allow policies on `payment_intents`: server-side bookkeeping only. The client learns what it needs from the checkout handoff, never by reading the table.
  - `0022_email_outbox_rls.sql` — zero allow policies on `email_outbox`: the rows hold recipient addresses and are pure server-side bookkeeping. No user reads the send queue, and a recipient address is exactly the contact detail the double-blind keeps out of reach. Written and drained only through the functions.
  - `0020_payouts_rls.sql` — zero allow policies on `payouts`: the rows carry processor transfer references and the linked-account handle money was sent to. A payee's legitimate question ("what am I owed, and did it arrive?") is answered by `my_payouts()` with a deliberately narrower column list.
  - `0019_payout_accounts_rls.sql` — zero allow policies on `payout_accounts`, deliberately stricter than the other identity tables. Everywhere else the owning user may read their own row; here that would mean a stolen session exfiltrates a full PAN and bank account number for no product benefit — the owner already knows their own bank details. `my_payout_account()` answers the only legitimate question ("which account is on file?") with fragments.
  - `0017_qc_reviewer_read.sql` — a QC reviewer keeps visibility of orders they personally reviewed (0003's QC policy only covers the live queue, so an order would otherwise vanish the instant they decided). Orders carry no identity, so this is not an identity-piercing read.

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
# Apply everything not yet applied (safe to re-run):
DATABASE_URL=postgres://user:pass@host:5432/db npm run db:apply

# See what is applied vs pending, change nothing:
DATABASE_URL=... npm run db:status

# ONE-TIME, for a database that already has the schema but no ledger:
DATABASE_URL=... npm run db:baseline
```

`scripts/apply-migrations.mjs` applies each pending file in `migrations/` then
`policies/` in filename order, inside a transaction per file — and records it in
`public.schema_migrations` in that same transaction, so a failed file records
nothing and can be retried.

**Re-running is safe.** Applied files are skipped, not replayed. (Before this
ledger existed the script replayed everything and died on the first
`CREATE TYPE`/`CREATE TABLE` that already existed, which made it unusable
against any live database.) A database built before the ledger existed needs
`npm run db:baseline` once — that records the current files as applied without
executing them; afterwards `db:apply` only ever runs genuinely new files.

## Non-negotiables encoded here

- Opaque text IDs only — no sequential integers, no serial/identity columns.
- Money is `integer` minor units with `CHECK (>= 0)` — never floats.
- Identity is isolated in the profile tables — never on `users` or `orders`.
- All FKs are `ON DELETE RESTRICT`.
- Default-deny RLS on every table; allow policies come in a later slice.
