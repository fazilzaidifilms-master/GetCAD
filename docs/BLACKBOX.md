# Black-box acceptance tests (A–E)

Run these yourself to confirm the foundation. Each test has a **manual** way to
run it and the **automated** test that encodes it.

## Setup (once)

```bash
npm install
```

The DB tests need a Postgres 16. Either point `DATABASE_URL` at one you have, or
start a throwaway local cluster (no Docker needed):

```bash
# start a throwaway Postgres on port 5433
initdb -D ./pgdata -U postgres --auth=trust
pg_ctl -D ./pgdata -o "-p 5433" -l ./pgdata/log start
export DATABASE_URL="postgres://postgres@127.0.0.1:5433/postgres"
```

---

## A — BOUNDARY: core/ may not import next/* or react

**Manual:**
```bash
# create an offending file in core/ and lint
printf 'import { NextResponse } from "next/server";\nexport const x = NextResponse;\n' > core/_offender.ts
npm run lint        # -> FAILS (BOUNDARY VIOLATION)
rm core/_offender.ts
npm run lint        # -> PASSES
```

**Automated:** `tests/boundary/boundary.test.ts` (creates a temp core file
importing `next/server` and `react`, asserts lint fails; asserts a clean file
passes).

---

## B — ENUM: a bad order status is rejected by the database

**Manual:**
```bash
npm run db:apply
psql "$DATABASE_URL" -c \
  "INSERT INTO orders (id, client_id, product_type, status, currency,
     price_total, designer_payout, qc_payout, platform_commission)
   VALUES ('x','y','CAD','BANANA','USD',1,1,1,1);"
# -> ERROR: invalid input value for enum order_status: "BANANA"
```

**Automated:** `tests/db/schema.test.ts` → "Test B — ENUM rejects bad status".

---

## C — OPAQUE ID: a new order's id is a nanoid, not 1/2/3

**Manual:**
```bash
node -e "import('./core/ids/generateId.ts')" 2>/dev/null || \
  node --experimental-strip-types -e \
  "import('./core/ids/generateId.ts').then(m => console.log(m.generateId()))"
# -> prints something like  7bKq3mZ9tR2vX4nP8dWcs   (21 chars, not 1/2/3)
```

**Automated:** `core/ids/generateId.test.ts` and the "Test C" block in
`tests/db/schema.test.ts` (asserts the stored id matches the opaque-id pattern
and is not all digits).

---

## D — RLS FAILS CLOSED: anon sees zero rows of orders (no error)

**Manual (this is the exact step-8 command):**
```bash
npm run db:apply
# insert a row as the owner (bypasses RLS), then query as anon:
psql "$DATABASE_URL" <<'SQL'
SET ROLE anon;
SELECT * FROM orders;     -- returns 0 rows, NO error
RESET ROLE;
SQL
```

**Automated:** `tests/db/schema.test.ts` → "Test D — RLS fails closed" (inserts
a row, confirms the owner sees it, confirms anon sees zero across every table).

> On the live Supabase project the same `SET ROLE anon; SELECT * FROM orders;`
> in the SQL editor returns 0 rows, because Supabase's `anon` already has the
> table grant and the default-deny RLS blocks every row.

---

## E — CI GREEN on the clean repo

**Manual (runs exactly what CI runs):**
```bash
npm run ci      # typecheck -> lint -> test -> secret-scan
```

**Automated:** `.github/workflows/ci.yml` runs the same four steps on every PR,
with a throwaway `postgres:16` service, under a 5-minute timeout.

---

# Clerk JWT bridge (Sprint 0, next slice)

## F — Token verification accepts good tokens, rejects bad ones

The bridge verifies Clerk tokens **server-side**: signature (against the public
JWKS), issuer, and expiry. A valid token yields the Clerk `sub`; a tampered,
expired, wrong-issuer, wrong-key, or sub-less token is **rejected**.

**Automated (deterministic, offline — mints test JWTs with a throwaway key):**
`core/auth/verifyClerkToken.test.ts`.

## G — Identity reaches RLS (a user sees only what is theirs)

With the verified Clerk id in `request.jwt.claims`, run as the `authenticated`
role:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<a-user-id>"}', true);
set local role authenticated;
select * from orders;            -- only that user's orders
select * from designer_profiles; -- 0 rows unless it's their own
rollback;
```

- A **client** sees their own orders; a **designer** sees orders assigned to
  them; **QC** sees orders in `QC_REVIEW`/`REVISION_REQUESTED`.
- Neither side can read the **other side's identity** table (double-blind).
- No claims (anon) → **0 rows**; all writes remain rejected by default-deny.

**Automated:** `tests/db/policies.test.ts`.

---

# Login UI (Sprint 0, login slice)

## H — Sign in, and the dashboard shows only your data

> **Determinism note:** a real browser login uses live Clerk and can't be made
> deterministic in CI, so this is a **manual** black-box test. The pure
> security-relevant logic (which paths require auth) *is* unit-tested:
> `core/auth/session.test.ts` (`isProtectedPath`). The login flow itself you run
> once with your own keys.

**Setup (your keys — not committed):** copy `.env.example` to `.env.local` and
fill `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Clerk must be
registered as a Supabase Third-Party Auth provider (done) and migrations
`0005` + `0003` applied (done). Then `npm run dev`.

**Steps:**
1. Visit `/dashboard` while **logged out** → you are redirected to sign-in. *(This
   is the `isProtectedPath` decision in `middleware.ts`.)*
2. **Sign in** via Clerk.
3. `/dashboard` now shows your **verified Clerk id** and your row from the
   database — fetched **as you** through the bridge, so RLS governs it.
4. First visit auto-creates your `users` row (audited) — see the onboarding
   slice below; the dashboard is populated with no manual step.

**What it proves:** the verified Clerk session reaches Postgres, and the slice-3
RLS policies apply to a real logged-in user — the bridge, end to end.

> **Flagged / deferred:** the app performs **no writes** this slice. Account
> creation/onboarding is a state change that must go through the append-only
> **audit log** (a later slice); until then you seed the row manually. Running
> `next build`/`npm run dev` requires the keys above — CI does not (it runs only
> tsc → eslint → vitest → secret-scan).

---

# Audit log (append-only, hash-chained)

All three tests are fully deterministic (pure database) — no browser, no keys.
Automated in `tests/db/audit.test.ts`. To run by hand, `npm run db:apply` then
use the `psql` snippets below.

## I — Append-only: history cannot be rewritten

```sql
select audit.log_event('USER_CREATED','user','u1','u1','CLIENT');
update audit.audit_log set action='HACKED';   -- ERROR: append-only … UPDATE
delete from audit.audit_log;                   -- ERROR: append-only … DELETE
truncate audit.audit_log;                      -- ERROR: append-only … TRUNCATE
```

## J — Tamper-evident hash chain

```sql
select audit.log_event('USER_CREATED','user','u1','u1','CLIENT');
select audit.log_event('ORDER_STATUS_CHANGED','order','o1','u2','OPS','{"to":"SUBMITTED"}');
select audit.verify_chain();   -- {"valid": true, "entries": 2}

-- simulate an attacker with raw storage access:
alter table audit.audit_log disable trigger audit_log_no_update;
update audit.audit_log set payload='{"tampered":true}' where seq=1;
alter table audit.audit_log enable trigger audit_log_no_update;
select audit.verify_chain();   -- {"valid": false, "broken_at": 1, "reason": "content hash mismatch"}
```

## K — Locked down: only the trusted server may touch it

```sql
set role authenticated;  select * from audit.audit_log;      -- ERROR: permission denied
set role authenticated;  select audit.log_event('X','user'); -- ERROR: permission denied
reset role;
```
Only `service_role` (BYPASSRLS, server-side) can read/append; `anon` and
`authenticated` cannot reach the `audit` schema at all.

---

# Onboarding (audited self-signup)

## L — First login creates your row, audited and idempotent

Automated (deterministic, pure DB): `tests/db/onboarding.test.ts`.

`public.ensure_self()` takes the current user's Clerk id from the verified token
(never a parameter), creates their `users` row if missing, and — in the same
transaction — appends one `USER_CREATED` entry to the audit log.

```sql
-- simulate a logged-in request
select set_config('request.jwt.claims', '{"sub":"user_alice","role":"authenticated"}', false);
set role authenticated;

select public.ensure_self();   -- {"created": true,  "user_id": "user_alice"}
select public.ensure_self();   -- {"created": false, "user_id": "user_alice"}  (idempotent)
reset role;

select * from users where id = 'user_alice';                 -- CLIENT / ACTIVE
select action from audit.audit_log where entity_id = 'user_alice';  -- exactly one USER_CREATED
select audit.verify_chain();   -- {"valid": true, ...}
```

**Browser (manual, part of test H):** sign in on a fresh account → the dashboard
is already populated (role/status shown) with **no manual `insert`** — the row
was created and audited on first load.

> Flagged: a self-signup defaults to CLIENT / ACTIVE (placeholder); staff and
> designers are provisioned by other paths, and a real flow may use PENDING +
> verification.

---

# Order state machine (Slice 8)

## M — Legal, role-gated, audited transitions

Automated (deterministic, pure DB): `tests/db/order_state_machine.test.ts`.

An order changes status only through `public.transition_order()`, which enforces
the `order_transitions` graph, the caller's role/party, and writes an audit
entry — atomically. `public.create_order()` creates a DRAFT order (audited).

```sql
-- as a client (set request.jwt.claims to their sub, role authenticated):
select public.create_order('ord1','CAD_MODEL');            -- -> DRAFT (ORDER_CREATED)
select public.transition_order('ord1','SUBMITTED');        -- -> SUBMITTED (audited)
select public.transition_order('ord1','APPROVED');         -- ERROR: illegal transition
select public.transition_order('ord1','QUOTED');           -- ERROR: illegal transition (wrong role)

-- as sales:
select public.transition_order('ord1','QUOTED');           -- -> QUOTED

-- a non-participant client:
select public.transition_order('someone-elses-order','SUBMITTED');  -- ERROR: not the client of this order

select audit.verify_chain();   -- {"valid": true, ...} — every move logged
```

**Proves:** legal moves succeed and are audited; illegal jumps, wrong-role moves,
and non-participants are all rejected; the audit chain stays valid.

> Flagged: the transition matrix (who may do what, when) is a first cut in
> `order_transitions`, easy to review/revise. Real pricing/escrow (money fields
> at QUOTED) and the order UI are later slices.

---

# Designer onboarding gate (Slice 9)

## N — A designer cannot be assigned until they accept the agreement

Automated (deterministic, pure DB): `tests/db/designer_gate.test.ts`.

Client onboarding stays light (Test L). The designer path is gated:

```sql
-- as the applicant (request.jwt.claims -> their sub):
select public.apply_as_designer('dp1','Dana','dana@studio.example');  -- DESIGNER / PENDING (audited DESIGNER_APPLIED)

-- as ops, try to assign this designer to a PAYMENT_HELD order:
select public.transition_order('ord1','ASSIGNED','{"designer_id":"<designer>"}');
-- ERROR: designer is not assignable: must be an ACTIVE designer who has accepted the agreement

-- as the designer, sign the CURRENT agreement (pass its fingerprint):
select public.accept_designer_agreement(
  (select content_sha256 from app.current_agreement('DESIGNER'))
);  -- ACTIVE (audited SIGNED_AGREEMENT)

-- as ops, assign again:
select public.transition_order('ord1','ASSIGNED','{"designer_id":"<designer>"}');  -- -> ASSIGNED
```

**Proves:** an unsigned designer is blocked from assignment; signing is
audited and flips them to assignable; a non-designer cannot sign; the chain
stays valid.

> Flagged: applying as a designer changes the user's role (audited). The
> agreement document is now real and versioned (Slice 13 / Test S) — the gate
> requires a signature against the current version.

---

# Order UI (Slice 10)

## O — The order screen only offers legal moves

**Automated (deterministic):** `core/orders/availableTransitions.test.ts` — the
pure `availableTransitions(status, graph, actor)` returns exactly the legal next
moves for the actor's role + party (e.g. a client on their DRAFT order →
`SUBMITTED`, `CANCELLED`; a non-party client → nothing). The buttons are built
from this, so the UI never offers an illegal move; the DB still enforces it.

**Manual (browser):** on `/orders`, signed in as a client:
1. Enter a product type, click **New order** → a `DRAFT` order appears with
   **SUBMITTED** / **CANCELLED** buttons.
2. Click **SUBMITTED** → status becomes `SUBMITTED`.
3. In Supabase, `select * from audit.audit_log order by seq desc limit 2;` shows
   `ORDER_CREATED` then `ORDER_STATUS_CHANGED`.

> Flagged: this is the **client** order screen (fully clickable with today's
> RLS). Staff (sales/ops/finance) and designer screens need their own order-read
> access — a later slice. Browser flow isn't CI-deterministic; the pure action
> logic is unit-tested.

---

# Staff / designer order screens (Slice 11)

## P — Staff see only orders they can act on

Automated (deterministic, pure DB): `tests/db/staff_order_visibility.test.ts`.

A STAFF-role user can READ an order exactly when their role has a legal move out
of its current status (from `order_transitions`). Orders carry no identity, so
this is not an identity-piercing read.

```sql
-- as sales (request.jwt.claims -> a SALES user's sub):
select id, status from orders;   -- only SUBMITTED orders (its quote queue)
-- as ops:   only PAYMENT_HELD / DESIGNER_SUBMITTED / APPROVED / DELIVERED / DISPUTED
-- as finance: only CLOSED / PAYMENT_HELD / DISPUTED
```

**Proves:** sales sees SUBMITTED, ops sees PAYMENT_HELD, finance sees CLOSED +
PAYMENT_HELD; none see states they can't act on; clients still see only their own.

**Browser:** signed in as each staff role, `/orders` shows that role's queue with
the allowed action buttons; ASSIGN takes the designer's **opaque id**.

> Flagged: visibility = "you can act on it now" (state-machine-tied). Assigning
> uses an opaque designer id — an audited designer-roster/picker (which reveals
> identity) is a separate slice. Designers already see their assigned orders.

---

# File pipeline — part (a): sanitization gate + versions (Slice 12)

## Q1 — The single sanitization gate (pure, deterministic)

Automated: `core/files/sanitizationGate.test.ts`. Every upload passes through
`sanitizeUpload()`; nothing bypasses it.

- **ACCEPTS** an allowed type whose **magic bytes match** the declared type, and
  returns an **identity-stripped** object name (opaque id + verified extension —
  the original filename is dropped).
- **REJECTS**: disallowed content types; **disguised** files (declared PDF but
  bytes are an EXE); type/extension mismatches; oversized; empty; too-short
  headers.

## Q2 — File versions (audited, versioned, RLS-gated)

Automated: `tests/db/file_versions.test.ts`.

```sql
-- as the order's designer or client:
select public.add_file_version('<vid>','<order>','<opaque_key>','model/step', 5000);
-- -> version_no increments; orders.current_version_id points at it; FILE_VERSION_ADDED audited
```

**Proves:** only a participant (client/assigned designer) can add a version; each
version increments `version_no` and moves `orders.current_version_id`; every add
is audited; RLS lets participants read versions and blocks unrelated users (you
can read a version only if you can read its order); chain stays valid.

> Part (b) wires real upload/download to Supabase Storage with **signed
> short-TTL URLs** (calling this gate on the real bytes) — its end-to-end check is
> a manual browser test.

## R — Upload/download through the gate (part b, manual)

> Storage-dependent, so this is a manual browser test. The gate logic it relies
> on is already proven deterministically in Q1.

**Setup:** create a **private** Supabase Storage bucket named `order-files`
(Dashboard → Storage → New bucket, "Public" OFF). Add
`SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (Settings → API → service_role).
Restart `npm run dev`.

**Steps** (on `/orders`, as a participant of an order):
1. Under an order's **Files**, choose a valid file (PDF/PNG) and **Upload**.
2. A version `v1` appears; `orders.current_version_id` moves to it; the audit log
   gains `FILE_VERSION_ADDED`. The stored object name is an **opaque id**, not the
   original filename.
3. Click **Download** → you're redirected to a **short-TTL signed URL**
   (`?token=…`, expires in ~60s). A logged-out user hitting `/api/files/<id>` gets
   401; a non-participant gets 404 (RLS).

**What it proves:** files flow through the single gate, are stored under opaque
keys, are never public, and are reachable only via short-lived signed URLs gated
by the same RLS as their order.

## S — Legal document signing (Slice 13a, deterministic)

> `tests/db/legal_signing.test.ts`. Wires the real, versioned agreement behind
> the designer gate (Slice 9 stored only a placeholder version).

**What it proves:**
1. A `DESIGNER` agreement is published and its stored `content_sha256` equals
   `sha256(body)` — the fingerprint cannot lie.
2. Signing with a **wrong/stale fingerprint** is rejected ("changed since you
   loaded it") and records nothing.
3. A correct signature is **immutable** (UPDATE/DELETE rejected), **audited** with
   the version + fingerprint, and flips the designer to assignable.
4. A **published document is immutable** (UPDATE rejected) — a correction is a new
   version, never an edit.
5. Publishing **v2 re-gates** a designer who signed v1 (not assignable until they
   sign v2); the v1 signature stays on file. The audit chain stays valid.

## T — Designer onboarding + signing UI (Slice 13b, manual)

> Clerk + Storage-independent but auth-dependent, so a manual browser test. The
> DB enforcement it drives is already proven deterministically in Test S.

**Setup:** apply the consolidated designer-licensing SQL live (Slice 9 + 13),
so `agreement_documents` has a `DESIGNER / v1` row. Sign in.

**Steps** (on `/onboarding/designer`):
1. **Apply** — fill legal name + email, submit. You become `DESIGNER / PENDING`
   (audited `DESIGNER_APPLIED`); the page now shows the agreement text.
2. **Sign** — read the rendered agreement, click "I have read and agree — sign".
   The hidden fingerprint is passed to `accept_designer_agreement`; you flip to
   `ACTIVE` (audited `SIGNED_AGREEMENT` with version + fingerprint) and the page
   shows the onboarded state.
3. **Gate** — before step 2, ops assigning you to an order fails ("not
   assignable"); after step 2 it succeeds (Test S covers this deterministically).
4. **Re-gate** — publish a `v2` document row; the page returns to the "sign"
   state (you must re-sign) while your `v1` signature remains on file.

**What it proves:** the whole licensing loop is reachable from the UI — apply →
read the real versioned document → sign against its fingerprint → become
assignable — with every step audited and gated by the DB.

## U — Escrow ledger + money conservation (Slice 14a, deterministic)

> `tests/db/escrow.test.ts`. The money layer: quote → hold → release | refund,
> recorded in an append-only ledger. Money-bearing status changes live ONLY in
> the money functions; `transition_order` refuses them.

**What it proves:**
1. A quote whose split doesn't sum to the total is rejected; a conserving quote
   (SALES only) sets the money + `QUOTED`.
2. Holding (the order's client only) records the full price, flips to
   `PAYMENT_HELD`, and cannot happen twice.
3. Releasing (FINANCE only) records payout legs that **sum exactly to the held
   amount**, flips to `PAYOUT_RELEASED`, and leaves net held = 0.
4. Refunding (FINANCE only) returns the held amount, flips to `REFUNDED`, net
   held = 0; release is then impossible (mutually exclusive).
5. Every movement is audited (`ORDER_QUOTED`/`ESCROW_HELD`/`ESCROW_RELEASED`/
   `ESCROW_REFUNDED`); the ledger is append-only; the audit chain stays valid.

## V — Money UI: quote → fund → release/refund (Slice 14b, manual)

> Auth-dependent UI, so a manual browser test. The enforcement it drives (roles,
> states, money conservation) is proven deterministically in Test U.

**Setup:** apply the escrow SQL live (`0012` migration + `0009` policy). Sign in
with users of the relevant roles (SALES, the order's CLIENT, FINANCE).

**Steps** (on `/orders`, per order):
1. **Quote (SALES, SUBMITTED)** — enter Total / Designer / QC (minor units;
   platform = remainder) and submit → order moves to `QUOTED`, money shown.
2. **Fund (client, QUOTED)** — click "Fund escrow — pay $X" → `PAYMENT_HELD`,
   "Held in escrow" appears; the money-state generic buttons are gone (the guard).
3. **Release (FINANCE, CLOSED)** — after the order reaches CLOSED, click "Release
   payout" → `PAYOUT_RELEASED`, held returns to 0.
4. **Refund (FINANCE, PAYMENT_HELD/DISPUTED)** — click "Refund client" →
   `REFUNDED`, held returns to 0.

**What it proves:** the whole money loop is reachable from the UI, each control
gated to the right role + state, and every movement recorded in the append-only
ledger + audit log (Test U covers the invariants).

## W — Double-blind messaging (Slice 15a, deterministic)

> `tests/db/messaging.test.ts`. A per-order thread between the client and the
> assigned designer that structurally cannot leak identity.

**What it proves:**
1. The client and the assigned designer can post; the party label is DERIVED from
   who they are (never from the client). A non-participant cannot post; an empty
   message is rejected.
2. Messages carry NO identity — the table has only `id/order_id/sender_id
   (opaque)/sender_party/body/created_at`; no name/email/avatar.
3. A participant reads the thread but STILL cannot read the counterparty's
   identity row (`designer_profiles` → 0 rows): the double-blind holds.
4. Posting is audited (`MESSAGE_POSTED`); messages are append-only (update/delete
   rejected); threads are order-scoped (an unrelated order's client sees none);
   the audit chain stays valid.

## X — Double-blind chat UI (Slice 15b, manual)

> Auth-dependent UI, so a manual browser test with two sessions. The structural
> guarantee (no identity in the schema; double-blind holds) is proven in Test W.

**Setup:** apply the messaging SQL live (`0013` migration + `0010` policy). Have
an order at `ASSIGNED`+ with a real client and assigned designer. Open two
sessions: one signed in as the client, one as the assigned designer.

**Steps** (on `/orders`, the order's **Messages** section):
1. As the **client**, type a message → Send. It appears labeled **You**.
2. In the **designer** session, refresh → the same message appears labeled
   **Client** (never a name/email). Reply → shows **You** to the designer.
3. Back as the **client**, refresh → the reply appears labeled **Designer**.
4. Neither side's screen ever shows the other's identity — only the role label.

**What it proves:** the two blinded parties can converse end-to-end through the
UI, each seeing the other purely as "Client"/"Designer", with every message
recorded in the append-only, audited thread (Test W covers the invariants).

## Y — Structured dispute resolution (Slice 16a, deterministic)

> `tests/db/disputes.test.ts`. A first-class dispute: raised with a reason,
> resolved as REWORK or REFUND. These transitions leave the generic
> transition_order (reason/outcome always captured).

**What it proves:**
1. The order's client raises a dispute WITH a reason → order `DISPUTED`, an OPEN
   dispute row recorded. A non-client can't; an empty reason is rejected; a
   second dispute can't be raised while one is open.
2. `transition_order` refuses to reach `DISPUTED` (use `raise_dispute`) and
   refuses to move a `DISPUTED` order (use `resolve_dispute`).
3. OPS resolves `REWORK` → order back to `IN_PROGRESS`, dispute `RESOLVED`.
4. FINANCE resolves `REFUND` → escrow refunded (reuses `refund_escrow`, held → 0),
   order `REFUNDED`, dispute `RESOLVED`. Wrong roles are blocked.
5. Both events are audited (`DISPUTE_RAISED`/`DISPUTE_RESOLVED`); chain valid.

## Z — Dispute UI (Slice 16b, manual)

> Auth-dependent UI, so a manual browser test. The enforcement (roles, states,
> escrow refund) is proven deterministically in Test Y.

**Setup:** apply the disputes SQL live (`0014` migration + `0011` policy). Have an
order at `IN_PROGRESS` (funded + assigned). Sign in as the client, and separately
as OPS and FINANCE.

**Steps** (on `/orders`, the order's **Dispute** section):
1. As the **client**, type a reason → "Raise a dispute" → order shows `DISPUTED`
   with a "⚠️ Dispute open" banner showing the reason. The generic `DISPUTED`
   button no longer appears.
2. As **OPS**, the banner shows "Resolve: send back for rework" → click → order
   returns to `IN_PROGRESS`, dispute closes.
3. (Other order) As **FINANCE**, "Resolve: refund the client" → order `REFUNDED`,
   escrow shows the refund (Money section), dispute closes.

**What it proves:** the dispute loop is reachable from the UI, each control gated
to the right role + state, with the reason + outcome recorded and audited (Test Y
covers the invariants).

## AA — Notifications from the audit log (Slice 17a, deterministic)

> `tests/db/notifications.test.ts`. Notifications are generated by an AFTER INSERT
> trigger on the audit log, so no existing function changes. Best-effort (a
> notification failure never breaks the business action).

**What it proves:**
1. A quote notifies the client; an assignment notifies the designer; a message
   notifies the OTHER party (never the sender).
2. Notification text is identity-free (no names/emails).
3. A user reads ONLY their own notifications (RLS); `mark_notifications_read()`
   clears the caller's unread and no one else's; the audit chain stays valid.

## AB — Notifications panel (Slice 17b, manual)

> Auth-dependent UI, so a manual browser test. The generation + RLS is proven in
> Test AA.

**Setup:** apply the notifications SQL live (`0015` migration + `0012` policy).

**Steps** (on `/dashboard`):
1. Trigger events on an order (get a quote, receive a message, get assigned). The
   **Notifications** panel shows identity-free summaries with an unread count.
2. Click **Mark all read** → the badge clears and the items dim.
3. Sign in as the counterparty → they see *their* notifications, never yours.

**What it proves:** each party sees only their own identity-free notifications,
surfaced from the events they care about, with a working read state.

## AC — Staff-role helper (Slice 18, deterministic)

> `core/auth/roles.test.ts`. `isStaffRole` gates the staff console UI.
> Authorization itself stays in the DB (RLS + definer functions); this only
> decides what to show.

**What it proves:** every staff role (SALES/OPS/QC/FINANCE) is recognised;
CLIENT/DESIGNER/unknown/null are rejected.

## AD — Staff console (Slice 18, manual)

> Auth-dependent UI, no new SQL. Uses the existing staff order RLS (0006).

**Steps** (on `/admin`, the new "Staff" nav link):
1. As a **client/designer**, `/admin` shows a "staff only" message.
2. Set your role to a staff role (e.g. OPS) and reload → the console lists the
   orders your role can act on, **grouped by status** with a plain-language label
   ("Ready to assign", "Ready for payout", "Dispute — needs resolution"), the
   available next-status chips, and an "Act →" link to `/orders`.
3. Different staff roles see different queues (SALES: awaiting quote; FINANCE:
   payout/refund; QC: review), driven by the same graph as staff visibility.

**What it proves:** staff get a focused, role-aware work queue without flipping
SQL — and orders carry no identity, so the console never exposes one.

## AE — Security invariants (Slice 19 hardening, deterministic)

> `tests/db/hardening.test.ts`. Locks the whole-system security posture in as
> assertions so it can't regress.

**What it proves:**
1. Every `public` table has RLS **enabled and forced**.
2. **No** `public` table grants `INSERT/UPDATE/DELETE` to `anon`/`authenticated`
   (0013 revoked the base-table writes) — the only write path is the SECURITY
   DEFINER functions, and writes still succeed through them.
3. Every SECURITY DEFINER function sets `search_path = ''`.
4. No `public` table has a direct write policy (writes are function-only).
5. Double-blind holds: a client can't read the designer's identity row and vice
   versa; each can read only their own.

## AF — Design system foundation (Slice 20, deterministic + manual)

> `core/orders/status.test.ts` (deterministic) + manual visual review.

**Automated:** `statusMeta` maps every order status to a label + functional tone
(neutral/info/attention/success/danger) and humanises unknowns without throwing.

**Manual (visual):** the app now renders in "The CAD Pillar" identity —
near-monochrome with one functional accent, Inter type, mono for ids/amounts,
consistent borders/radius, light + dark tokens. The shell (top bar + wordmark),
landing, and dashboard are re-skinned with `StatusBadge`, `Badge`, `Skeleton`,
and the persistent `TrustLine` ("Designer identity protected · All actions
logged · Independent QC required"). Subsequent slices re-skin the remaining
surfaces against these tokens.

## AG — Orders list + detail reskin (Slice 21, manual)

> Visual/UX review against the design system. Behaviour unchanged (proven by the
> DB tests); this restructures the orders surface.

**What it delivers:**
- **List** (`/orders`): a dense, status-led table — StatusBadge, product type, mono
  reference, price/held; each row opens the detail. Clear empty state.
- **Detail** (`/orders?focus=<id>`): the order as titled panels — Order (status +
  generic actions), Payment (split + amount held + role-gated quote/fund/release/
  refund), Dispute (persistent banner, never a toast), Files, Messages
  (double-blind, "identities hidden — role only"). "Not available" state for a
  reference the role can't see. TrustLine on every view.

## AH — Order timeline (client-safe audit window) (Slice 22, deterministic)

> `tests/db/order_timeline.test.ts`. The flagship trust surface: a narrow,
> read-only window onto the audit log, scoped exactly like order visibility, with
> every row stripped of actor identity — only `actor_role` travels.

**What it proves:**
1. The client sees the full lifecycle in chronological order, including the
   `QC_REVIEW → CLIENT_PREVIEW` entry — the independent QC milestone — with
   `actor_role = 'QC'` (reviewer shown by role only, never identity).
2. The assigned designer sees the same timeline.
3. Visibility is exactly as narrow as order visibility — not broader: a staff
   role whose queue slot has passed (e.g. QC once the order leaves QC_REVIEW) is
   rejected, same as a non-participant.
4. No row carries an `actor_id` — identity cannot leak through this surface.
5. Money-bearing entries (quote/hold) carry their amount, matching the ledger.

## AI — Timeline labeling + QC milestone (Slice 22, deterministic)

> `core/orders/timeline.test.ts`. Pure mapping from raw rows to display steps —
> framework-free, so the QC-milestone detection is unit-tested independent of UI.

**What it proves:** every whitelisted action gets a human label; the
`QC_REVIEW → CLIENT_PREVIEW` / `→ REVISION_REQUESTED` transitions are flagged as
a **distinct milestone** (`isQcMilestone` + `qcOutcome`) rather than a generic
status change; money amounts and dispute outcomes are carried through; an
unrecognised status is humanised, never thrown; row order and no-identity
(no `actorId` field) are preserved.

## AJ — Timeline UI (Slice 22, manual)

> Visual/UX review. The data + labeling are proven in AH/AI.

**Steps:** open any order detail (`/orders?focus=<id>`) — the **Timeline** panel
(now first) shows every state change, timestamped, in a vertical list. The
independent QC review renders as an elevated, tone-coloured milestone box
("Independent QC review — Passed" / "Revision requested"), captioned "Reviewed
by role: QC · identity protected" — never a name.

## AK — Staff console + QC decision reskin (Slice 23, manual)

> Visual/UX review; no new backend logic (same transition_order calls).

**What it delivers:**
- `/admin` reskinned against the design system: `StatusBadge`/`Badge`, denser
  grouped-by-status sections, mono order references, role badge in the header,
  a specific error state (message + reload) and an actionable empty state
  ("Queue clear — nothing needs a <ROLE> action right now").
- A persistent callout for QC when their queue has orders `IN QC_REVIEW`,
  naming the responsibility explicitly.
- Order detail: when the caller is QC and the order is `QC_REVIEW`, the
  pass/revision transitions are pulled out of the generic action chips into a
  dedicated **"Independent QC review"** panel with clear buttons ("Pass — send
  to client preview" / "Request revision") and the same reviewer-by-role-only
  language shown to the client.

## AL — Onboarding + legal signing reskin (Slice 24, manual)

> Visual/UX review; no new backend logic (same apply_as_designer /
> accept_designer_agreement calls).

**What it delivers:**
- New shared primitives — `components/ui/input.tsx`, `textarea.tsx`, `label.tsx`
  — consolidating three previously-duplicated ad hoc input styles into one
  consistent, focus-ringed component used across onboarding AND the orders
  list/detail (money/dispute/message/upload forms).
- `components/stepper.tsx` — a horizontal progress indicator (Apply → Sign
  agreement → Active), giving the designer onboarding flow the explicit,
  visible-state treatment the rest of the app follows.
- `app/onboarding/designer/page.tsx`: reskinned against the design system —
  card sections, `Badge` for the Active state, tabular/mono version + fingerprint
  display, the "no document published" state now uses destructive tokens instead
  of a hardcoded red, and the stepper always shows exactly where the applicant is
  (Apply / Sign / Active).

**Client onboarding** stays as-is: it's the audited, single-step `ensure_self()`
already covered by the Slice 20 dashboard reskin — there is no separate wizard
surface for it.

## AM — Loading, error, and receipt polish (Slice 25, manual)

> Visual/UX review; strictly additive — no action/mutation code touched, no new
> SQL, no existing render branch removed. Verified: full 143-test suite,
> typecheck, lint, core-boundary, secret-scan, and production build all green
> both before and after this slice, with the diff scoped to new files plus
> defensive guards (never replacing a working code path).

**What it delivers:**
- **Loading skeletons** (`loading.tsx` for `/dashboard`, `/orders`, `/admin`,
  `/onboarding/designer`) — Next.js Suspense boundaries per route, rendering
  shape-matched `Skeleton` placeholders instead of a spinner while the real page
  fetches. Purely additive: only ever shown during navigation/streaming, never
  replaces the actual page's logic.
- **Specific error states** instead of silently swallowed query failures: `/orders`
  (list + detail) and `/onboarding/designer` now check every query result for an
  `.error` and show a message + "reload to try again" instead of rendering an
  empty state that would otherwise look identical to "you have none of these."
  The order timeline's own fetch got the same treatment (a distinct "Couldn't
  load history: …" line instead of a silently-empty timeline).
- **`app/error.tsx`** (global error boundary) and **`app/not-found.tsx`** — styled
  on the design tokens, with a specific message + "Try again" / "Go to dashboard"
  next steps, replacing Next's default unstyled fallback.
- **Receipts**: rather than build a new toast/redirect confirmation mechanism
  (which would have meant touching every one of the ~13 existing server
  actions — real regression risk for a purely cosmetic gain), the order detail
  now shows **"Recorded" — the timestamp of the most recent timeline entry** —
  right next to the status badge. Every action already produces a timestamped
  audit entry (Slice 22); this surfaces that as the receipt, with zero new
  mutation-side code.

## AN — Marketing lead capture (Slice 26a, deterministic)

**Black-box test:** a marketing site visitor (unauthenticated, `anon` role) can
submit a Contact Sales lead and have it persist; nobody — not even `anon` or
`authenticated` — can read or write `marketing_leads` directly.

**Steps:** `tests/db/marketing_leads.test.ts`. As `anon`, call
`submit_marketing_lead(p_name, p_email, p_message, p_company, p_role)` — a row
persists with the given fields; `company` is optional (`NULL` if omitted);
`role` defaults to `BUSINESS`. Invalid email, empty name/message, or an invalid
role all raise and no row is written. A direct `SELECT` or `INSERT` against
`marketing_leads` as `anon` — bypassing the function — raises `permission
denied` (there is no grant at all, not even SELECT: stronger than an
RLS-empty-result). An authenticated user (arbitrary Clerk `sub`) can also
submit through the same function. Runs alongside `tests/db/hardening.test.ts`
(Test AE) to confirm the new table doesn't violate the "no public table grants
direct writes" invariant.

## AO — Marketing site: blog, contact form, content depth (Slice 26b, manual)

> Visual/UX + content review. `marketing_leads` persistence is proven in AN;
> this covers the pages and copy built on top of it.

**What it delivers:**
- **Contact Sales** (`/contact`) — a real form (Name / Company optional /
  Email / role select / Message) posting to a server action
  (`submitLeadAction`) that calls `submit_marketing_lead()` via the existing
  Supabase client (which already degrades to the `anon` role for signed-out
  visitors — no new client needed). Submitting redirects to
  `/contact?submitted=1`, which renders a "Message received" confirmation in
  place of the form.
- **Blog** (`/blog` index + `/blog/[slug]`) — three sample posts
  (`components/marketing/blog-posts.ts`, explicitly marked as starter/sample
  editorial content to be replaced with real posts) covering casting failure
  modes, the case for structural (not policy-based) anonymity, and the cost of
  skipping independent QC. Rendered via a small self-contained markdown
  renderer (`simple-markdown.tsx`, headings/lists/bold only, no
  `dangerouslySetInnerHTML`). Each post page is statically generated
  (`generateStaticParams`) with its own SEO metadata and ends with the shared
  `CtaSection`.
- **Homepage depth** — added a "From the blog" teaser (3 post cards linking
  into `/blog`) and an FAQ section (`FaqSection`, 6 questions grounded only in
  already-built functionality: anonymity, disputes, escrow, the audit trail,
  and assignment) before the closing CTA.
- **Navigation completeness** — header/footer/CTA section updated so every
  non-auth link resolves to a real page: "Contact sales" added to the header,
  footer, and the CTA section's client-side column; "Blog" added to the header
  nav and footer's Product column.
- `app/sitemap.ts` extended with `/contact`, `/blog`, and one entry per blog
  post slug.

## AP — Designer application, Stage 1 (Slice 27a, deterministic)

**Black-box test:** any visitor (unauthenticated, `anon` role) can submit the
7-field screening application and have it persist as a lead — not a
`users`/`designer_profiles` row; nobody can read or write
`designer_applications` directly; the submission is recorded in the audit log.

**Steps:** `tests/db/designer_applications.test.ts`. As `anon`, call
`submit_designer_application(p_id, p_full_name, p_email, p_phone, p_country,
p_years_experience, p_primary_software, p_categories, p_portfolio_url,
p_portfolio_file_keys)` — a row persists with `status = 'PENDING_REVIEW'`.
Exactly one portfolio path is required: a URL, or 2-3 file keys — providing
both, neither, or 1/4+ file keys all raise. Invalid email, invalid
`primary_software` (must be `RHINO`/`MATRIX`/`3DESIGN`/`OTHER`), an empty or
invalid `categories` array (must be a non-empty subset of
`RINGS`/`PENDANTS`/`EARRINGS`/`BRACELETS`/`BANGLES`), and years of experience
outside 0-60 all raise and no row is written. A direct `SELECT` or `INSERT`
against `designer_applications` as `anon` — bypassing the function — raises
`permission denied` (no grant at all, matching `marketing_leads`). An
authenticated user can also submit. Unlike `marketing_leads`, this writes an
audited `APPLICATION_SUBMITTED` entry (`actor_id`/`actor_role` both `NULL` —
the applicant isn't a platform user yet); the payload deliberately excludes
contact PII (name/email/phone stay in the table row only). `audit.verify_chain()`
stays valid. Runs alongside `tests/db/hardening.test.ts` (Test AE).

## AQ — Designer application form (Slice 27b, manual)

> Storage-dependent for the file-upload path, so full end-to-end file testing
> is manual. Persistence + validation are already proven deterministically in
> AP; the sanitization gate itself is proven in Q1.

**Setup (for the file-upload portfolio path):** create a **private** Supabase
Storage bucket named `designer-application-files` (Dashboard → Storage → New
bucket, "Public" OFF) — same setup as `order-files` (Test R). The
link-to-portfolio path needs no Storage setup at all.

**What it delivers:**
- `/apply-designer` — a single-page, 7-field form (full name; email + phone;
  country; years of CAD experience; primary software; jewelry categories,
  multi-select, min 1; portfolio as either a URL or 2-3 file uploads, the
  applicant's choice), built with `react-hook-form` + a shared Zod schema
  (`lib/validation/designerApplication.ts`) used for both instant client-side
  field errors and server-side re-validation — the first use of this pattern
  in the app; every other existing form uses plain FormData + DB-side
  validation only.
- Portfolio file uploads go through the same sanitization gate as order files
  (`core/files/sanitizationGate.ts` — magic-byte verified, renamed to an
  opaque id, original filename discarded) before being written to the new
  private bucket; the metadata row is only recorded after a successful
  upload, and any partially-uploaded files are removed if the submission
  ultimately fails.
- Submitting shows an inline error (not a crash) on validation/upload failure,
  or navigates to `/apply-designer?submitted=1`, which renders "Application
  received" — no dashboard access, no login created at this stage.
- A `Stepper` (Application → Review → Onboarding, current step 0) and explicit
  copy make clear this is a short screening step, not the real onboarding —
  the real gate (identity verification, the operating agreement, a paid test
  order) remains `apply_as_designer()` / `accept_designer_agreement()` (0009/0011),
  wired up manually per accepted candidate.
- `/for-designers` and the footer now link to `/apply-designer` instead of
  routing designer signup through `/sign-up`; `/sign-up` is unchanged for
  everyone else. `app/sitemap.ts` extended with `/apply-designer`.

**Steps:** visit `/apply-designer`. Submit with an empty field — see the
field-level error appear without a page reload. Fill all 7 fields, choose
"Link to portfolio," submit a URL — land on the confirmation screen. Repeat
choosing "Upload files," attach 2-3 PDFs/images — same confirmation. Query
`designer_applications` (e.g. via the Supabase dashboard) to confirm the row,
`status = 'PENDING_REVIEW'`, and (for the file path) that
`designer-application-files` contains only opaquely-named objects, never the
original filenames.

## AQ — Pre-deploy fix pack (Slice 28, deterministic)

> Four production blockers found by a code audit of the merged work, plus the
> first app-layer tests. Every item here has an automated guard — the point of
> the slice is that none of these could have been caught by the 163 tests that
> existed, because none of them crossed the app layer.

**AQ1 — upload limits agree across the stack** (`tests/config/upload-limits.test.ts`)

Regression guard for a **shipped bug**: `core/files` advertised a 100 MiB
ceiling while Next Server Actions silently defaulted to a **1 MB** body limit,
so every realistic CAD file or PDF failed in transport before the gate ran.
Uploads are Server Actions, so `next.config.mjs`'s `bodySizeLimit` is the real
cap. The test asserts an explicit limit is declared, that it is >=
`MAX_UPLOAD_BYTES`, and that the exported constant matches what Next receives.
Verified by reintroducing the bug: 3 of the 4 tests fail.

**AQ2 — Server Action allowed origins** (`tests/config/server-action-origins.test.ts`)

`"*.app.github.dev"` was trusted for Server Actions in **all** environments. It
is a domain anyone can obtain a subdomain on, so trusting it in production
weakens Next's origin (CSRF) check for the deployed site. It is genuinely needed
in dev (Codespaces proxies from a forwarded host), so the config is now
environment-dependent. Tests pin both directions: absent in production, present
in development, and a real deployment host can be added via
`NEXT_SERVER_ACTION_ALLOWED_ORIGINS`.

**AQ3 — shared validation schema** (`tests/validation/designerApplication.test.ts`)

`lib/validation/designerApplication.ts` is the validation source of truth for a
public form and is re-run server-side, yet had no tests. Covers coercion,
trimming, every field rule, the category allowlist, and the URL-vs-files
portfolio branch (a URL is required only on the url path).

**AQ4 — public form rate limiting** (`tests/db/rate_limits.test.ts`)

`/contact` and `/apply-designer` were unbounded. `check_rate_limit()` is a
sliding window: allows up to the limit then blocks, keeps buckets independent
(one visitor cannot block another, and one form cannot block the other), records
nothing once blocked, forgets hits that age out, rejects nonsensical arguments,
and `anon` cannot touch the table directly.

**Migration runner (manual check).** `npm run db:apply` is now safe to re-run —
applied files are recorded in `public.schema_migrations` and skipped, not
replayed. Verified end to end: apply to an empty DB, immediately re-run (a
no-op), then drop the ledger to simulate a pre-ledger database — the old failure
(`type "role" already exists`) reproduces, and `npm run db:baseline` resolves it
so subsequent applies are clean. `npm run db:status` reports applied vs pending.

## AR — Metadata stripping (Slice 29, deterministic)

> Closes the second half of file anonymity. Renaming an upload to an opaque id
> removed the FILENAME; the bytes still carried who made them. On a double-blind
> marketplace that is a direct breach — the client downloads the deliverable and
> reads the designer's studio name out of its EXIF.

**The design: two allowlists, because the two upload paths differ.**

| Path | Reader | Allowlist | Metadata stripped? |
|---|---|---|---|
| Order deliverable (designer → client) | the other party — **anonymity critical** | `DELIVERABLE_ALLOWLIST` (PNG, JPEG, STEP) | **Required.** A format we cannot clean is refused. |
| Designer application portfolio | staff, who already have the applicant's name/email/phone on the same form | `DEFAULT_ALLOWLIST` (+ PDF, ZIP) | No — there is no identity to protect. |

**Two deliberate exclusions from the delivery path:**
- **ZIP** — its central directory stores every internal filename and folder name
  verbatim, its contents are never inspected, and it therefore defeats the
  allowlist entirely (any file type can travel inside one).
- **PDF** — identity lives in the `/Info` dictionary *and* in XMP streams that
  may be compressed inside object streams. Cleaning that correctly needs a real
  PDF parser; a partial scrub that still leaks would be worse than an honest
  refusal.

Both remain accepted on the application path. Re-admitting them to delivery is a
future slice, not a config change.

**AR1 — PNG** (`core/files/metadataStripper.test.ts`). Rebuilds the chunk stream
from an allowlist of chunks that affect decoding/rendering. A fixture carrying
`tEXt`/`iTXt`/`eXIf`/`tIME` with a studio name, email and tool name comes back
with none of those strings and none of those chunk types, while `IHDR`/`IDAT`/
`IEND` and the pixel payload survive and the file shrinks.

**AR2 — JPEG.** Drops every `APPn` segment (EXIF, XMP, IPTC, ICC) and `COM`
comments, including `APP0`/JFIF. A fixture with EXIF `Artist`, XMP `dc:creator`,
IPTC credit and a comment comes back clean, while DQT/SOF0/SOS and the
entropy-coded scan data are preserved byte-for-byte.

**AR3 — STEP.** The `HEADER` section names author and organisation outright.
Rewrites it to neutral values while copying the `DATA` section (the geometry)
untouched, and **preserves `FILE_SCHEMA`** — replacing that would break
downstream CAD tools.

**AR4 — dispatch.** An unknown type returns `ok: false` rather than passing
bytes through uncleaned; `STRIPPABLE_TYPES` is asserted to match what dispatch
actually handles.

**AR5 — the gate** (`core/files/sanitizationGate.test.ts`). With
`requireMetadataStrip`, a PNG is accepted and the gate returns **cleaned** bytes
(callers store `gate.file.bytes`, never their original buffer, and `sizeBytes`
reports what is actually stored); PDF and ZIP are refused; both are still
accepted without the flag; and `DELIVERABLE_ALLOWLIST` is asserted to contain
only formats a stripper handles.

**Manual check:** upload a JPEG with EXIF (any phone photo) to an order,
download it back via the app, and inspect it (`exiftool`, or Finder/Explorer
properties). Every camera, author and GPS field should be gone. Then try
uploading a PDF to an order — it is refused with a clear reason. The same PDF
still uploads fine as an application portfolio at `/apply-designer`.

## AS — Independent QC: enforced, recorded, payable (Slice 30, deterministic)

> The product's second core promise — "reviewed by someone who did not design
> it" — had **nothing behind it in code**. Three defects, all closed here.

**What was wrong.** `orders` had `client_id` and `designer_id` but **no QC
column at all**, so no reviewer was ever recorded. QC transitions were gated
only on `actor_role = 'QC'`, and STAFF-scope moves skip the party check
entirely — the only thing preventing a designer from reviewing their own work
was the accident that `users.role` holds a single value. That is not a rule, and
it does not survive one person holding two accounts. And `release_escrow` wrote
a `RELEASE` leg to `party='QC'` with **no record of which reviewer earned it** —
an unattributable payout obligation sitting in the money ledger.

**The model: claim-on-action, not pre-assignment.** QC stays a pool — whoever is
free works the queue — but the reviewer is recorded at the moment they decide,
and independence is checked then. Attribution without an assignment bottleneck;
pre-assignment can be layered on later without reworking any of it.

**AS — the decision** (`tests/db/qc_identity.test.ts`). A QC user passing or
requesting revision is recorded in `orders.qc_reviewer_id`. **Self-review is
refused** — tested with the sharpest case, a user who holds the QC role *and*
produced the work: the call raises and the order does not move. Reviewing your
own order as the client is refused too. Only QC may decide, only on a
`QC_REVIEW` order, only with `PASS`/`REVISION`. `transition_order` can no longer
perform a QC decision at all. An order cannot be **assigned** to the designer who
already reviewed it. A reviewer keeps visibility of orders they decided, and an
unrelated QC user does not.

**AS2 — the payout.** Every `RELEASE` leg now records `payee_id`: the designer
for the designer leg, the recorded reviewer for the QC leg, `NULL` for the
platform (not a user row). Releasing a QC payout when **no reviewer was ever
recorded** is refused, nothing is written, and the order stays `CLOSED`. Money
conservation and the audit chain are re-verified after release.

**Consequence for existing flows.** `transition_order` is no longer the way to
move an order out of `QC_REVIEW`; the QC panel and two existing test
walkthroughs now call `record_qc_decision()`. Any order that reaches
`PAYOUT_RELEASED` with a non-zero `qc_payout` must have a recorded reviewer —
by construction, since the only way out of `QC_REVIEW` now records one.

## AT — Settlement ledger, ready for a processor (Slice 31, deterministic)

> The last schema blocker before payments. Deliberately **processor-agnostic** —
> nothing here names Stripe or Razorpay, so the choice can be made when the
> integration slice starts rather than baked into the ledger now.

**What the ledger could not represent, and now can:**

| Gap | Consequence | Fix |
|---|---|---|
| No processor reference | a webhook could not be matched to a ledger row | `external_ref` |
| No dedupe key | processors deliver at-least-once; a redelivered payout would double-count | UNIQUE `idempotency_key` |
| Only HOLD/RELEASE/REFUND | chargebacks, failed payouts and processor fees had nowhere to go | `PROCESSOR_FEE`, `CHARGEBACK`, `REVERSAL` kinds; `PROCESSOR` party |
| Refund was all-or-nothing | "refund half" was impossible | `refund_escrow(order, amount DEFAULT NULL)` |
| Terminal states had no exits | a chargeback after `PAYOUT_RELEASED` was unrepresentable | money events no longer require a status change |
| Conservation lived in function logic | any other write path could overdraw an order | a **trigger on the table** |

**AT1/AT2 — the sign rule** (`core/money/escrowSign.test.ts`). Both SQL and TS
inlined `kind === "HOLD" ? amount : -amount`, which is correct only while HOLD is
the sole credit. A `REVERSAL` — a payout that failed and came back — would have
been **subtracted**, understating the client's balance in the platform's favour.
Direction now lives in one place per layer (`app.escrow_sign()` /
`core/money/escrowSign.ts`) and **throws on an unknown kind** instead of
defaulting. The test asserts the old shortcut and the correct rule disagree.

**AT3 — parity.** The SQL sign map is asserted kind-by-kind, and a REVERSAL is
shown adding funds back after a release.

**AT4 — conservation as a table rule.** A direct `INSERT` that debits more than
is held is refused **even though it bypasses every escrow function**; draining an
order twice is refused; credits are never limited.

**AT5 — partial refunds.** A partial refund leaves the order `PAYMENT_HELD` and
reports `PARTIALLY_REFUNDED`; only a refund that empties escrow moves the order
to `REFUNDED`. Over-refunding, non-positive amounts and non-FINANCE callers are
all refused.

**AT6 — processor events.** A chargeback after `PAYOUT_RELEASED` is recorded and
**the order's lifecycle status is left untouched** — fulfilment history is not
rewritten to describe a money fact; `settlement_state()` reports `CHARGED_BACK`
instead. A redelivered event raises on the unique key rather than double-counting.
`record_settlement_event()` is `service_role` only: an authenticated user gets
`permission denied`.

**AT7 — derived settlement.** `settlement_state()` reports UNFUNDED / HELD /
PARTIALLY_REFUNDED / REFUNDED / SETTLED / CHARGED_BACK from the ledger, with the
audit chain re-verified.

> **Known duplication, deliberately not fixed here.** `order_status` still
> carries `PAYMENT_HELD`/`PAYOUT_RELEASED`/`REFUNDED` — money facts wearing a
> lifecycle costume. Removing them means rewriting the transition graph, every
> screen and every test: a large, risky change for no user-visible gain today.
> Settlement is DERIVED instead, and **the ledger is authoritative when the two
> disagree**.

## AU — Payment collection via Razorpay (Slice 32, deterministic + manual)

> The first slice where real money moves. India-first: Razorpay, INR, domestic
> designers. The SQL stays processor-agnostic; only the app layer names Razorpay.

**The security change this slice exists for.** `hold_escrow()` used to be a
button the CLIENT pressed — the ledger recorded a HOLD with no payment behind
it. Harmless while the money layer was a simulation; the moment a processor
exists it means **a client can fund their own order for free**. So funding moves
from *the client asserts it* to *the processor confirms it*:

- `hold_escrow` is **REVOKED from `authenticated`**
- `confirm_payment()` is `service_role` only, reachable solely through the
  webhook route, which verifies an HMAC signature before reading the payload
- `payment_intents` records what we asked to collect **before** the client
  touches Razorpay, so the confirmation is checked against **our** amount rather
  than the webhook's

**AU1 — webhook signature** (`core/payments/razorpaySignature.test.ts`).
Correctly signed bodies pass; a body tampered *after* signing (amount inflated)
fails; a signature made with the API key secret instead of the **webhook**
secret fails (the most common Razorpay integration mistake); missing/empty/
non-hex signatures fail; no configured secret fails **closed**. One test pins
that re-serialising the JSON breaks the digest — the reason the route must use
the raw body and must never be "tidied up" to parse first.

**AU2 — checkout callback signature.** Verifies `order_id|payment_id` keyed by
the API secret, and rejects swapped ids. Used only to show the user a
confirmation — never to settle money, because it arrives via the browser.

**AU3 — payload parsing.** Extracts our own order id back out of Razorpay's
`notes`; returns `null` rather than guessing for any missing field, a
non-integer/zero/negative amount, an unhandled event, or junk input.

**AU4 — nobody can self-fund** (`tests/db/payment_collection.test.ts`). The
client calling `hold_escrow` gets `permission denied` and the order stays
`QUOTED` with zero held. `confirm_payment` and `open_payment_intent` are equally
out of reach.

**AU5 — opening a collection.** The intent amount comes from the ORDER, not the
caller. Non-`QUOTED` orders and duplicate external references are refused.

**AU6 — confirming.** A matching payment funds escrow, moves the order to
`PAYMENT_HELD`, and stamps the ledger row with Razorpay's payment id. **A webhook
claiming ₹1 for a ₹45,000 order is refused** and nothing moves. Currency
mismatch, unknown reference, and a missing idempotency key are all refused. A
**redelivered webhook is a no-op** — still one ledger leg, still the same held
amount. An order that moved on can no longer be funded.

**AU7 — failures and visibility.** A failed collection marks the intent `FAILED`
and touches neither money nor the order (still payable). `payment_intents` is
unreadable by any client role. The audit chain stays valid throughout.

**AU8 — the webhook must stay reachable** (`core/auth/session.test.ts`).
`/api/webhooks/razorpay` must NOT be behind `auth.protect()`: Razorpay carries
no Clerk cookie, so protecting it would silently break every payment — checkout
succeeds, the webhook redirects to sign-in, escrow is never funded. Its security
is the HMAC, not a session.

### Manual test (needs your Razorpay keys)

1. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in
   `.env.local` (test mode keys).
2. In the Razorpay dashboard, add a webhook pointing at
   `https://<your-host>/api/webhooks/razorpay` for `payment.captured` and
   `payment.failed`, using the same webhook secret.
3. Quote an order as SALES, then as the client press **Pay** — Razorpay checkout
   opens. Complete it with a test card.
4. The page shows "Payment submitted"; within seconds the order should flip to
   **PAYMENT_HELD** with escrow funded.
5. Confirm in the DB: one `escrow_ledger` HOLD row carrying `external_ref =
   pay_…`, and the matching `payment_intents` row `CONFIRMED`.

> **Payouts are now built** (structured payout accounts with PAN/bank/IFSC, a
> `payouts` table, and Razorpay Route transfers). `release_escrow` records the
> obligation; the payout worker sends it. The one seam still unverified against
> the live API is creating a Route linked account — see `verify:payout` below.

### AU9 — Scripted end-to-end verification (`npm run verify:payment`)

The manual browser test needs a CLIENT and a SALES user, which is awkward with a
single Clerk account. `scripts/verify-payment.mjs` exercises the same path
directly — your real Razorpay test account, a real HMAC signature, your real
running webhook route, your real database — with no browser and no role juggling.

```bash
npm run dev                 # in one terminal
export DATABASE_URL="<your supabase pooler string>"
npm run verify:payment      # in another
```

It seeds a QUOTED order, creates a real Razorpay order, opens the intent, then:
rejects an unsigned webhook (401), rejects a **signed webhook for the wrong
amount** with nothing funded, accepts the real one and asserts the order reaches
`PAYMENT_HELD` with a correctly stamped ledger leg, redelivers the same webhook
and asserts no double-funding, and re-verifies the audit chain. It cleans up
after itself, pass or fail.

`--offline` skips only the live Razorpay API call (synthetic order id) and
verifies everything downstream. Use it to tell "my keys aren't active" apart
from "my webhook is broken".

The one thing it does not cover is typing a card into Razorpay's own checkout
UI — everything after "Razorpay captured a payment", which is where all of our
logic lives, is covered.

### AU10 — Scripted end-to-end verification of payouts (`npm run verify:payout`)

The money-OUT mirror of AU9. It drives a real order through the whole payout
machine against your database and asserts each step.

```bash
# Offline — needs only DATABASE_URL, no dev server, no secrets:
export DATABASE_URL="<your supabase pooler string>"
npm run verify:payout -- --offline

# Online — also exercises the real webhook route + signature check:
npm run dev                 # in one terminal
npm run verify:payout       # in another (needs RAZORPAY_WEBHOOK_SECRET)
```

It seeds a CLOSED, funded order with a payable designer and QC, then: releases
escrow and asserts the obligations land as ledger legs, opens payout
instructions (designer + QC; platform gets none), claims the batch, settles the
designer's payout the way the processor's `transfer.processed` webhook would and
asserts it reaches `PAID` with the transfer reference recorded, redelivers the
same settlement and asserts it is not paid twice, then delivers a
`transfer.reversed` and asserts the money returns to escrow. It re-verifies the
audit chain and cleans up after itself, pass or fail.

`--offline` settles straight through the DB functions (no dev server, no
secrets); online mode posts genuinely signed transfer webhooks at `APP_URL`, so
it also proves the route rejects a bad signature.

The one thing it does **not** cover is creating a real Razorpay Route transfer,
which needs a Route linked account — the single seam with no egress from CI.
Everything after "the processor moved the money" is covered.
