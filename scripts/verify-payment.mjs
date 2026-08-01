// End-to-end verification of the payment collection path.
//
// Exercises the REAL integration — your real Razorpay test account, a real
// HMAC signature, your real running webhook route, and your real database —
// without needing a browser or juggling Clerk roles across accounts.
//
// The only thing it does not do is type a card number into Razorpay's own
// checkout UI. Everything downstream of "Razorpay captured a payment" is
// covered, which is where all of our logic lives.
//
// Usage (from the repo root, with `npm run dev` already running):
//   DATABASE_URL=... APP_URL=http://localhost:3000 node scripts/verify-payment.mjs
//
// Keys are read from .env.local automatically.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { assertAppReachable, assertNotAuthWall, normalizeAppUrl } from "./lib/app-url.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ env -- */

function loadEnvLocal() {
  try {
    const text = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    // No .env.local — fall back to whatever is already exported.
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = normalizeAppUrl(process.env.APP_URL);
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
// --offline skips the live Razorpay API call (useful when your keys are not yet
// active, or egress is blocked) and verifies everything downstream of it.
const OFFLINE = process.argv.includes("--offline");
// --keep leaves this run's rows in place instead of deleting them. Useful if
// you want to inspect the result, or would rather never disable the ledger's
// append-only trigger (see cleanup()).
const KEEP = process.argv.includes("--keep");

const required = OFFLINE
  ? { DATABASE_URL, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET }
  : {
      DATABASE_URL,
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  console.error("Set them in .env.local (or export them) and try again.");
  process.exit(1);
}

/* ---------------------------------------------------------------- output -- */

let failures = 0;
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (detail) console.log(`      ${detail}`);
};
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/* ------------------------------------------------------------------ main -- */

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const suffix = Date.now().toString(36);
const clientId = `verify_client_${suffix}`;
const orderId = `verify_order_${suffix}`;
const PRICE = 50000; // ₹500.00 in paise

/**
 * Remove this run's rows.
 *
 * escrow_ledger is APPEND-ONLY — a trigger rejects DELETE outright, which is
 * the guarantee working as designed and applies to this script too. Cleaning up
 * therefore means briefly disabling that one trigger, which is safe here only
 * because:
 *   - the DELETE is narrowly scoped to THIS run's order id, and
 *   - the trigger is re-enabled in a finally, even if the delete fails.
 *
 * The same pattern is used in tests/db/audit.test.ts to prove tampering is
 * detectable. If you would rather never disable it, pass --keep to leave the
 * rows behind; they are all prefixed `verify_` and easy to find.
 */
async function cleanup() {
  if (KEEP) return;
  await db.query("ALTER TABLE public.escrow_ledger DISABLE TRIGGER escrow_ledger_no_delete");
  try {
    await db.query("DELETE FROM escrow_ledger WHERE order_id = $1", [orderId]);
  } finally {
    await db.query("ALTER TABLE public.escrow_ledger ENABLE TRIGGER escrow_ledger_no_delete");
  }
  await db.query("DELETE FROM payment_intents WHERE order_id = $1", [orderId]);
  await db.query("DELETE FROM orders WHERE id = $1", [orderId]);
  await db.query("DELETE FROM client_profiles WHERE user_id = $1", [clientId]);
  await db.query("DELETE FROM users WHERE id = $1", [clientId]);
}

try {
  // Before anything is seeded: prove APP_URL reaches THIS app. Checks 4 and 5
  // below assert a rejection, so a login wall in front of the deployment would
  // satisfy them without the app being asked — see scripts/lib/app-url.mjs.
  step("0. Reaching the app");
  {
    const health = await assertAppReachable(APP_URL);
    pass(`${APP_URL} answers /api/health — status ${health.status}`);
    if (health.unset.length) {
      console.log(`     note: not configured there: ${health.unset.join(", ")}`);
    }
  }

  step("1. Seeding a QUOTED order");
  await cleanup();
  await db.query("INSERT INTO users (id, role, status) VALUES ($1,'CLIENT','ACTIVE')", [clientId]);
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Verify Co','verify@example.com')",
    [`verify_profile_${suffix}`, clientId],
  );
  await db.query(
    `INSERT INTO orders (id, client_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,'CAD_MODEL','QUOTED','INR',$3,$4,$5,$6)`,
    [orderId, clientId, PRICE, 30000, 10000, 10000],
  );
  pass(`order ${orderId} — QUOTED, ₹${(PRICE / 100).toFixed(2)}`);

  let rpOrder;
  if (OFFLINE) {
    step("2. SKIPPED — offline mode, using a synthetic Razorpay order id");
    rpOrder = { id: `order_offline_${suffix}` };
    console.log("     (this does NOT verify your API keys; everything after it is still real)");
  } else {
    step("2. Creating a real Razorpay order (live API call, test mode)");
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: PRICE,
        currency: "INR",
        receipt: orderId,
        notes: { order_id: orderId },
      }),
    });
    if (!rpRes.ok) {
      fail(`Razorpay rejected the order (${rpRes.status})`, (await rpRes.text()).slice(0, 300));
      console.log("     Re-run with --offline to test the rest of the path without the API.");
      throw new Error("cannot continue without a Razorpay order");
    }
    rpOrder = await rpRes.json();
    pass(`Razorpay order ${rpOrder.id} — your API keys work`);
  }

  step("3. Opening the payment intent");
  await db.query("SELECT public.open_payment_intent($1,$2)", [orderId, rpOrder.id]);
  const intent = await db.query(
    "SELECT amount, currency, status FROM payment_intents WHERE external_ref=$1",
    [rpOrder.id],
  );
  if (intent.rows[0]?.amount === PRICE && intent.rows[0]?.status === "PENDING") {
    pass(`intent PENDING for ₹${(PRICE / 100).toFixed(2)} — amount came from the order`);
  } else {
    fail("intent not recorded correctly", JSON.stringify(intent.rows[0]));
  }

  /** Build and sign a webhook exactly as Razorpay would. */
  function signedWebhook(overrides = {}) {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_verify_${suffix}`,
            order_id: rpOrder.id,
            amount: PRICE,
            currency: "INR",
            notes: { order_id: orderId },
            ...overrides,
          },
        },
      },
    });
    return { body, signature: createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex") };
  }

  /** POST to the webhook route, returning the status and body together. */
  async function post(body, signature) {
    let res;
    try {
      res = await fetch(`${APP_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-razorpay-signature": signature },
        body,
      });
    } catch (e) {
      // Almost always "the dev server is not running", which is worth saying
      // plainly rather than surfacing a bare `fetch failed`.
      throw new Error(
        `Could not reach ${APP_URL}/api/webhooks/razorpay — is \`npm run dev\` running? ` +
          `(${e instanceof Error ? e.message : String(e)})`,
      );
    }
    const text = await res.text();
    // A 401 from a login wall must never be read as the route refusing us.
    assertNotAuthWall(APP_URL, res, text);
    return { ok: res.ok, status: res.status, text };
  }

  step("4. Rejecting an UNSIGNED webhook (anyone could POST this)");
  {
    const { body } = signedWebhook();
    const res = await post(body, "deadbeef");
    // The body matters as much as the status: it proves the refusal came from
    // our signature check and not from something in front of the app.
    if (res.status === 401 && res.text.includes("invalid signature")) {
      pass("401 invalid signature — refused by the route itself");
    } else {
      fail(`expected a 401 from the route, got ${res.status}`, res.text.slice(0, 200));
    }
  }

  step("5. Rejecting a TAMPERED amount (signed, but for ₹1)");
  {
    // Sign a genuine ₹1 payment: signature is valid, but it does not match the
    // ₹500 intent we recorded. This is the attack the intent exists to stop.
    const { body, signature } = signedWebhook({ amount: 100 });
    const res = await post(body, signature);
    const held = await db.query("SELECT app.escrow_held($1) AS h", [orderId]);
    if (res.status >= 400 && held.rows[0].h === 0) {
      pass("refused, and nothing was funded");
    } else {
      fail(`expected refusal + 0 held; got status ${res.status}, held ${held.rows[0].h}`);
    }
  }

  step("6. Accepting the REAL signed webhook");
  {
    const { body, signature } = signedWebhook();
    const res = await post(body, signature);
    const text = res.text;
    if (!res.ok) {
      fail(`webhook rejected (${res.status})`, text.slice(0, 300));
    } else {
      const order = await db.query("SELECT status FROM orders WHERE id=$1", [orderId]);
      const held = await db.query("SELECT app.escrow_held($1) AS h", [orderId]);
      const leg = await db.query(
        "SELECT kind, amount, external_ref FROM escrow_ledger WHERE order_id=$1",
        [orderId],
      );
      if (order.rows[0].status === "PAYMENT_HELD") pass("order -> PAYMENT_HELD");
      else fail(`order is ${order.rows[0].status}, expected PAYMENT_HELD`);

      if (held.rows[0].h === PRICE) pass(`escrow holds ₹${(PRICE / 100).toFixed(2)}`);
      else fail(`escrow holds ${held.rows[0].h}, expected ${PRICE}`);

      if (leg.rows.length === 1 && leg.rows[0].external_ref === `pay_verify_${suffix}`) {
        pass("one HOLD leg, stamped with Razorpay's payment id");
      } else {
        fail("ledger leg wrong", JSON.stringify(leg.rows));
      }
    }
  }

  step("7. Redelivering the SAME webhook (Razorpay retries)");
  {
    const { body, signature } = signedWebhook();
    const res = await post(body, signature);
    const held = await db.query("SELECT app.escrow_held($1) AS h", [orderId]);
    const legs = await db.query(
      "SELECT count(*)::int AS n FROM escrow_ledger WHERE order_id=$1",
      [orderId],
    );
    if (res.ok && held.rows[0].h === PRICE && legs.rows[0].n === 1) {
      pass("no double-funding — still one leg, same balance");
    } else {
      fail(`status ${res.status}, held ${held.rows[0].h}, legs ${legs.rows[0].n}`);
    }
  }

  step("8. Audit chain still intact");
  {
    const chain = await db.query("SELECT audit.verify_chain() AS r");
    if (chain.rows[0].r.valid) pass(`valid across ${chain.rows[0].r.entries} entries`);
    else fail("audit chain broken", JSON.stringify(chain.rows[0].r));
  }
} catch (e) {
  fail("verification aborted", e instanceof Error ? e.message : String(e));
} finally {
  try {
    await cleanup();
  } catch (e) {
    console.log(
      `\n  note: could not remove this run's rows (${e instanceof Error ? e.message : e}).` +
        `\n  They are prefixed \`verify_\` — safe to leave, or delete by hand.`,
    );
  }
  await db.end();
}

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed — payment collection works end to end.\x1b[0m\n"
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
