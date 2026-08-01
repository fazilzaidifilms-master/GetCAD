# Launch checklist

The ordered walkthrough from "code is ready" to "taking real customers." Do the
phases in order — several steps depend on an earlier one (the webhook URL needs
the domain; the payout test needs a linked account; signed-in reads need the
Clerk↔Supabase re-registration).

`DEPLOY.md` is the reference for the one-time infrastructure setup; this is the
sequence and the verification. Where they overlap, this links there rather than
repeating.

Legend: ☐ you do it · 🔎 how to know it worked · ⚠️ easy to get wrong.

---

## Phase 0 — Green light (local, ~15 min)

- ☐ **Be on `main` first.** Feature branches (`claude/slice-…`) are old snapshots
  and may lack the tooling below.
  ```bash
  git checkout main && git pull origin main
  ```
- ☐ Sanity-check the code. Two levels, pick what you can run:
  - **Enough on its own** (no database needed):
    ```bash
    npm run typecheck && npm run lint
    ```
  - **The full suite too** — start the throwaway database *first*, or the DB
    tests fail with `ECONNREFUSED 127.0.0.1:5433` (that error means "no test
    database running," never "the code is broken"):
    ```bash
    npm run test:db:up    # a disposable Postgres in Docker
    npm run ci            # typecheck → lint → test → secret-scan
    ```
  🔎 You do **not** strictly need to run the DB tests locally: CI already runs all
  of them green on every merge into `main`. If `test:db:up` errors because Docker
  isn't available in your environment, the two commands in the first box are a
  sufficient green light.
- ☐ Decide your production domain (e.g. `thecadpillar.com`).
- ☐ Confirm **who owns production** — the Vercel, Supabase and Razorpay accounts
  should sit under a business address, not a personal one. See
  [DEPLOY.md → "Who owns what"](./DEPLOY.md).
- ☐ Use a **dedicated Supabase project** for this app, and run the collision
  check in [DEPLOY.md → "Use a dedicated Supabase project"](./DEPLOY.md) before
  pointing migrations at any existing project.
  ⚠️ If `db:apply` later fails with "already exists", **do not** run
  `db:baseline` — see Phase 2.

## Phase 1 — Production accounts & credentials

You are collecting values you'll paste into Vercel in Phase 3. Keep them in a
password manager, never in the repo.

### 1a. Clerk production instance
- ☐ Clerk dashboard → create a **production instance** for the app.
- ☐ Add the DNS records (CNAMEs) it gives you, at your registrar.
- ☐ Note the **production** `pk_live_…`, `sk_live_…`, and Frontend API origin.
- ☐ ⚠️ **Re-register it with Supabase**: Supabase → Authentication →
  Third-Party Auth → set the Clerk domain to the **production** Frontend API.
  🔎 If you skip this, every signed-in database read returns nothing — the
  single most common launch mistake. Symptom: `/dashboard` loads but your row is
  empty.

### 1b. Razorpay
- ☐ For a real launch, switch the account to **Live** and get live
  `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. (For a soft launch with test cards,
  test-mode keys are fine — just don't advertise it as taking real payments.)
- ☐ Enable **Razorpay Route** on the account (needed to pay designers). Ask
  Razorpay support if it isn't already active — activation can take a day.
- ☐ Invent a strong `RAZORPAY_WEBHOOK_SECRET` (any long random string). ⚠️ This
  is a **different** value from the key secret. You'll paste the same value into
  Vercel and the webhook config (Phase 4).

### 1c. Email (Resend)
- ☐ Create a Resend account.
- ☐ Add your sending **domain** and add the SPF/DKIM DNS records it gives you.
  🔎 Resend shows the domain as **Verified**. DNS can take up to a few hours —
  start this early.
- ☐ Note the `RESEND_API_KEY` and choose `EMAIL_FROM`, e.g.
  `The CAD Pillar <hello@thecadpillar.com>` (the address must be on the verified
  domain).
- ☐ Optional `EMAIL_REPLY_TO` if replies should land somewhere else.
  > Email is optional to *deploy*: if you skip this, the app still runs and
  > every acknowledgement queues in the outbox until you configure it. But you
  > want it on before applicants start arriving, so they hear back.

## Phase 2 — Database

- ☐ Point `DATABASE_URL` at production (Supabase → Session pooler, IPv4 string)
  and apply migrations:
  ```bash
  export DATABASE_URL="<supabase session pooler string>"
  npm run db:status     # shows what's pending
  npm run db:apply      # applies migrations + policies, forward-only
  npm run db:status     # confirm nothing pending
  ```
  ⚠️ Migrations are **forward-only** — there are no down-migrations. They were
  each tested against a throwaway Postgres by `npm test`.
- ☐ If `db:apply` fails with **"already exists"**, work out *why* before doing
  anything else — the right fix depends entirely on the cause:

  | Cause | Fix |
  |---|---|
  | **This project already ran these migrations**, before the ledger existed (you recognise the tables as ours) | `npm run db:baseline` once, then `db:apply`. |
  | **Something else owns that name** — a different app's `users`/`orders`/`role` | ⚠️ **Do NOT baseline.** Use a different Supabase project. Baselining here marks migrations as applied *without running them*, leaving an empty schema the ledger claims is complete. |

  The collision check in [DEPLOY.md](./DEPLOY.md) tells the two apart in advance.

## Phase 3 — Deploy the app (Vercel)

- ☐ Import the **GetCAD** repo from your GitHub organisation, signed in to Vercel
  as the business account (DEPLOY.md → step 2). Framework:
  Next.js, detected build settings — **do not** set a custom build command.
- ☐ Add the environment variables for **Production**. The full table is in
  [DEPLOY.md → Environment variables](./DEPLOY.md); **plus** the email vars:

  | Variable | Value |
  |---|---|
  | `RESEND_API_KEY` | from Phase 1c |
  | `EMAIL_FROM` | e.g. `The CAD Pillar <hello@thecadpillar.com>` |
  | `EMAIL_REPLY_TO` | optional |

  ⚠️ `DATABASE_URL` is **not** a Vercel variable — the running app never uses it.
  ⚠️ Nothing secret may start with `NEXT_PUBLIC_`.
- ☐ Add your domain (Vercel → Settings → Domains) and complete the DNS.
- ☐ Deploy.
- ☐ Vercel → Settings → **Deployment Protection** → confirm **Production is not
  protected**.
  ⚠️ Protection puts a login wall in front of every request. Razorpay's webhook
  would be answered by Vercel with a `401` and never reach the app — payments
  would be taken and escrow never funded. (Leaving *preview* deployments
  protected is fine and sensible.)

## Phase 4 — Webhook

- ☐ Razorpay → Settings → Webhooks → point at production:
  - **URL:** `https://yourdomain.com/api/webhooks/razorpay`
  - **Secret:** the exact `RAZORPAY_WEBHOOK_SECRET` from Phase 1b
  - **Active events:** `payment.captured`, `payment.failed`,
    `transfer.processed`, `transfer.failed`, `transfer.reversed`
  🔎 The transfer events are what mark a designer's payout PAID/REVERSED. Without
  them, payouts send but never confirm.

## Phase 5 — Verify the live deployment

- ☐ Config check:
  ```bash
  curl https://yourdomain.com/api/health
  ```
  🔎 `{"status":"ok","configured":{...}}` with `auth`, `database`, `storage`,
  `payments` **all true**. `email` and `seo` true too if you set them. A `503`
  names exactly which group is missing (values are never revealed).
- ☐ By hand: `/` loads · `/sign-in` works on the real domain · after signing in,
  `/dashboard` shows **your** row (proves the Clerk↔Supabase bridge — empty means
  Phase 1a's re-registration was missed).
- ☐ `/apply-designer` → submit a test application. 🔎 You receive the
  "we've received your application" email (proves email end-to-end), and it
  appears in `/admin/applications` when you view as an OPS/SALES role.
- ☐ Payment path, end to end:
  ```bash
  export DATABASE_URL="<supabase pooler string>"
  APP_URL="https://yourdomain.com" npm run verify:payment
  ```
  🔎 All checks pass, starting with `0. Reaching the app`. It cleans up after
  itself.
  ⚠️ `APP_URL` must be your **production** URL — the one *without* a deployment
  hash (`myapp-a1b2c3d4-team.vercel.app` is a preview, `myapp.vercel.app` or
  your own domain is production). Include the `https://`. A preview URL sits
  behind Deployment Protection; step 0 stops the run there rather than let the
  signature checks pass against a login wall.
- ☐ Payout path — this is the one seam CI can't cover:
  1. Create **one** real Route linked account for a test designer in the
     Razorpay dashboard, then record it:
     ```bash
     npm run payouts:link -- --list                       # who needs linking
     npm run payouts:link -- --user <users.id> --account-ref acc_xxx
     ```
  2. Prove the rest of the chain against production:
     ```bash
     APP_URL="https://yourdomain.com" npm run verify:payout
     ```
     🔎 All checks pass: release → open → claim → paid → reversed. (Use
     `--offline` to exercise the DB path without the webhook round-trip.)

## Phase 6 — Before the first real customer

- ☐ **Terms of Service, reviewed by counsel.** The privacy page is an accurate
  plain-language description and says outright it hasn't been lawyer-reviewed;
  Terms governing real money between strangers is not something to ship on a
  stub. This is the one launch blocker that isn't code.
- ☐ Clean test data if you reused the Supabase project:
  ```sql
  SELECT id, status, created_at FROM orders WHERE id LIKE 'verify_%';   -- inspect
  ```
  Then remove the `verify_` rows (they exist across `orders`, `users`,
  `escrow_ledger`, `payouts`, profiles). The verify scripts clean up after
  themselves, so this only matters if a run was interrupted.
- ☐ Set a real `RATE_LIMIT_SALT` in Vercel (any long random string) so hashed
  client addresses aren't guessable.

## Phase 7 — Go live, then watch

- ☐ Announce / open the doors.
- ☐ First-week cadence:
  - Watch `/admin/applications` and `/admin/leads` — real people are arriving.
  - After the first order pays, confirm `PAYMENT_HELD` and the escrow balance.
  - `curl /api/health` occasionally; it should stay `ok`.
  - If the app's inline email flush ever misses one, drain the queue:
    `DATABASE_URL=… RESEND_API_KEY=… EMAIL_FROM=… npm run send-emails`. It's safe
    to run on a cron (uses `SKIP LOCKED`, never double-sends).
  - If a payout ever sticks in flight, `reconcilePayouts` (via the finance
    order screen's "Check stuck payouts") asks the processor what happened.

## If something breaks

- **Rollback** is instant: Vercel → Deployments → last good one → Promote to
  Production. No rebuild.
- **Signed-in reads empty** → Phase 1a Supabase re-registration.
- **Webhook rejected (401)** → the secret in Vercel and in the Razorpay webhook
  config don't match — *unless* the body says "Protected deployment", in which
  case it is Vercel's login wall, not the app. Turn off Deployment Protection
  for Production.
- **`verify:*` says "Failed to parse URL"** → `APP_URL` is missing `https://`.
- **`/api/health` 503** → it names the missing group; set that variable.
- **Sitemap points at localhost** → `NEXT_PUBLIC_SITE_URL` is unset.
