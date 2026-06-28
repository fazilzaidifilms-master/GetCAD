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
