# Deploying The CAD Pillar

Everything here is a one-time setup. After it, deploys are `git push`.

## Decisions worth making first

**Reuse your existing Supabase project, or create a fresh one for production?**

Reusing is what I'd suggest for now: you have zero real users, the Clerk↔Supabase
bridge is already configured, and the schema is current. The cost is that test
rows (prefixed `verify_`, plus any orders from role-flipping) live alongside real
ones. Clean them up before your first real customer:

```sql
-- inspect first
SELECT id, status, created_at FROM orders WHERE id LIKE 'verify_%';
```

Creating a fresh production project is cleaner but means redoing migrations,
Storage buckets, and the Clerk Third-Party Auth registration. Worth doing when
you have real data to protect, not before.

---

## 1. Clerk — production instance

A Clerk **development** instance uses `*.accounts.dev` and is not meant for a
real domain. In the Clerk dashboard, create a **production instance** for your
app. It will ask you to add DNS records (CNAMEs) at your domain registrar.

Afterwards you will have a new publishable key (`pk_live_…`) and secret key
(`sk_live_…`), and a new Frontend API origin.

**Then re-register it with Supabase**: Supabase Dashboard → Authentication →
Third-Party Auth → update the Clerk domain to the production Frontend API. If
you skip this, every signed-in database read returns nothing, because
`app.current_clerk_id()` will not resolve.

## 2. Vercel

1. vercel.com → **Add New → Project** → import `fazilzaidifilms-master/GetCAD`.
2. Framework preset: **Next.js**. Build command and output directory: leave as
   detected. Do NOT set a custom build command.
3. Add the environment variables below (Settings → Environment Variables), for
   the **Production** environment.
4. Deploy.

### Environment variables

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk production publishable key |
| `CLERK_SECRET_KEY` | Clerk production secret key |
| `CLERK_JWT_ISSUER` | Clerk production Frontend API origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `RAZORPAY_KEY_ID` | Razorpay key id |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you set on the Razorpay webhook — a DIFFERENT value from the key secret |
| `NEXT_PUBLIC_SITE_URL` | `https://yourdomain.com` (no trailing slash) |
| `RATE_LIMIT_SALT` | Any long random string |

`NEXT_PUBLIC_SITE_URL` is not cosmetic: it builds canonical URLs, Open Graph
tags and `sitemap.xml`. Leaving it unset silently publishes a sitemap pointing
at `localhost`.

`DATABASE_URL` is **not** needed by the app — it is only used by
`npm run db:apply` and the tests. Do not add it to Vercel.

## 3. Domain

Vercel → Settings → Domains → add your domain and follow the DNS instructions.
Do this before step 4, since the webhook URL depends on it.

## 4. Razorpay webhook

Razorpay Dashboard → Settings → Webhooks. Either edit the existing webhook or
add one for production:

- **URL:** `https://yourdomain.com/api/webhooks/razorpay`
- **Secret:** the same value you put in `RAZORPAY_WEBHOOK_SECRET`
- **Active events:** `payment.captured`, `payment.failed`, `transfer.processed`,
  `transfer.failed`, `transfer.reversed`

The `payment.*` events fund escrow; the `transfer.*` events confirm designer
payouts (PAID / REVERSED). This is the point of deploying: the URL stops
changing every time a Codespace restarts.

## 5. Verify the deployment

```bash
curl https://yourdomain.com/api/health
```

Expect `{"status":"ok","configured":{...all true...}}`. A `503` names exactly
which configuration group is missing. It reports only whether values are set,
never the values themselves.

Then check by hand:

- `/` — the marketing site loads
- `/apply-designer` — the form renders and accepts a submission
- `/sign-in` — Clerk works on the real domain
- `/dashboard` — after signing in, your row loads (this is the Clerk↔Supabase
  bridge; if it is empty, step 1's Supabase re-registration was missed)

And end to end:

```bash
export DATABASE_URL="<supabase pooler string>"
APP_URL="https://yourdomain.com" npm run verify:payment
```

## Rollback

Vercel keeps every deployment. Deployments → pick the last good one →
**Promote to Production**. Instant, no rebuild.

Database migrations do **not** roll back — there are no down-migrations. Treat
schema changes as forward-only and test them against a throwaway Postgres
(`npm test` does exactly that) before applying to production.

For the full go-live sequence (accounts, email, payouts, verification, first-week
cadence), follow [LAUNCH.md](./LAUNCH.md).

## What is still missing at launch

- **Counsel-reviewed Terms.** The privacy page is an accurate plain-language
  description and says so; Terms governing real money between strangers is not
  written. This is the one launch blocker that isn't code.
- **One live-verified payout.** Designer payouts are built and tested, but
  creating a real Razorpay Route linked account is the single seam with no
  automated coverage — do the `payouts:link` + `verify:payout` step in LAUNCH.md
  Phase 5 before onboarding a designer who expects to be paid.

> Payouts and transactional email, previously listed here as missing, now exist
> (migrations 0023–0027).
