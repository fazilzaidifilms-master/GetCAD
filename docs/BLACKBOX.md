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
4. New account with no row yet → the page shows a one-line `insert` to seed your
   `users` row in Supabase. Run it, refresh → exactly your row appears, nothing
   else.

**What it proves:** the verified Clerk session reaches Postgres, and the slice-3
RLS policies apply to a real logged-in user — the bridge, end to end.

> **Flagged / deferred:** the app performs **no writes** this slice. Account
> creation/onboarding is a state change that must go through the append-only
> **audit log** (a later slice); until then you seed the row manually. Running
> `next build`/`npm run dev` requires the keys above — CI does not (it runs only
> tsc → eslint → vitest → secret-scan).
