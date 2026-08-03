# GetCAD

Foundation for a double-blind, anonymity-critical CAD marketplace.
Sprint 0 — Slices 1+2: repo scaffold, base schema, default-deny RLS.

This slice has **no features**. It exists to prove the frame is sound:
hexagonal layout, an enforced boundary around `core/`, native enums, opaque
IDs, integer-only money, and a database that is locked shut by default.

## Layout (hexagonal)

| Dir           | Purpose                                                        |
| ------------- | ------------------------------------------------------------- |
| `app/`        | Thin Next.js routing/UI. No business logic.                   |
| `core/`       | Framework-agnostic logic. May NOT import next/* or react.     |
| `db/`         | Versioned SQL: `migrations/` and RLS `policies/`.             |
| `components/` | UI components (shadcn/ui).                                     |
| `lib/`        | Small UI/utility helpers.                                     |
| `config/`     | Typed configuration; server-only secrets.                     |
| `tests/`      | Boundary test + schema/RLS tests.                             |
| `scripts/`    | Migration applier, secret scanner.                            |

## Prerequisites

```bash
npm install
```

## Commands

```bash
npm run dev          # run the throwaway app
npm run typecheck    # tsc --strict
npm run lint         # eslint, including the core/ boundary rule
npm run test         # vitest: boundary + schema/RLS tests
npm run secret-scan  # scan tracked files for committed secrets
npm run ci           # typecheck -> lint -> test -> secret-scan (what CI runs)
npm run db:apply     # apply db/migrations + db/policies to $DATABASE_URL
npm run send-emails  # drain the email outbox (retries; also runs inline)
npm run verify:delivery # reconcile Razorpay's captured payments against our escrow
```

## Running the database tests locally

The schema/RLS/money tests need a Postgres on `127.0.0.1:5433`. A disposable one
is committed as `docker-compose.yml`, so the whole thing is one command:

```bash
npm run test:local     # starts the throwaway Postgres, then runs every test
```

Or drive it in two steps:

```bash
npm run test:db:up     # start the throwaway postgres:16 (port 5433)
npm run test           # run the suite
npm run test:db:down   # stop it when you're done
```

Each run drops and rebuilds the schema, so the container holds nothing worth
keeping. CI uses the same `postgres:16` image, so local and CI agree.

> **Never** set `DATABASE_URL` to a real database to run the tests — the harness
> does `DROP SCHEMA public CASCADE` on whatever it connects to. It is only ever
> meant to hit the disposable local Postgres above. (`npm run db:apply` is the
> opposite and is safe: it only *adds* migrations to `$DATABASE_URL`.)
>
> Since this warning was not enough on its own, the harness now **refuses** to
> run against any host that is not local, and says so with the fix. The trap it
> closes: `export DATABASE_URL=…` for a migration run, then `npm run ci` in the
> same terminal an hour later. Nothing about that sequence looks dangerous while
> you are typing it.
>
> Prefer an inline prefix over `export`, so the variable never outlives the
> command that needed it:
>
> ```bash
> DATABASE_URL="…" npm run db:apply
> ```

## Black-box tests (A–E)

See [`docs/BLACKBOX.md`](docs/BLACKBOX.md) for the exact commands to run each of
the five acceptance tests yourself.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/SYSTEM.md`](docs/SYSTEM.md) | How the platform works: the order lifecycle, money custody, the anonymity model, and the guarantees enforced in the database. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Running the business: every role and the actions it can take, team setup, the runbook for when things go wrong, known limits. |
| [`docs/LAUNCH.md`](docs/LAUNCH.md) | The ordered go-live checklist, from green light to first customer. |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | One-time infrastructure setup reference (Clerk, Vercel, domain, webhook). |
| [`docs/BLACKBOX.md`](docs/BLACKBOX.md) | Acceptance tests you can run by hand. |
| [`db/README.md`](db/README.md) | Every migration and RLS policy, and why it exists. |
