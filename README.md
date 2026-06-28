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
```

## Running the database tests locally

The schema/RLS tests (B, C, D) need a Postgres. Point `DATABASE_URL` at any
Postgres 16 and run `npm run test`. CI spins up a throwaway `postgres:16`
service automatically.

## Black-box tests (A–E)

See [`docs/BLACKBOX.md`](docs/BLACKBOX.md) for the exact commands to run each of
the five acceptance tests yourself.
