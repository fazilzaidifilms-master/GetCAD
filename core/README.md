# core/

Framework-agnostic business logic. The hexagonal "inside".

## Hard rule (enforced by lint, fails CI)

Nothing in `core/` may import `next`, `next/*`, `react`, or `react-dom`. The
boundary is enforced by `no-restricted-imports` in `.eslintrc.cjs` as an
**error**, so `npm run lint` — and therefore CI — fails on any violation.

Why: keeping core pure means the rules of the marketplace (IDs, money, state
transitions, auth decisions) can be tested in milliseconds, reused outside the
web app, and never accidentally leak a request object or a React hook into a
domain decision.

If you need a framework here, you are in the wrong layer — put it in `app/` or
`components/`.
