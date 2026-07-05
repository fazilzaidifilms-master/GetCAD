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
