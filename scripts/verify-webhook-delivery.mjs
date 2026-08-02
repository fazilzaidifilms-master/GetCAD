// Did Razorpay's webhooks actually reach us?
//
// THE GAP THIS FILLS. `verify:payment` signs its own webhooks and posts them
// itself, so it proves the route, the signature check and the ledger — but it
// never involves Razorpay's delivery. Three things can be true at once:
//
//   - every check in `verify:payment` passes,
//   - Razorpay captures real payments,
//   - and not one of them ever funds escrow.
//
// That happens whenever the secret in the Razorpay webhook config disagrees
// with RAZORPAY_WEBHOOK_SECRET on the server (every delivery is refused 401),
// or the webhook URL points somewhere else, or no secret is set at all so the
// deliveries arrive unsigned. The failure is silent by construction: the money
// is collected, the client sees a successful payment, and the order sits at
// QUOTED forever.
//
// So this asks the only question that settles it, from the outside:
//
//   Razorpay says these payments were captured. Did we fund escrow for each?
//
// It reads Razorpay's own record over the API and reconciles it against ours.
// A payment Razorpay captured that our ledger never recorded is a delivery
// failure, whatever the dashboard says.
//
// Worth keeping after launch, not just for setup — it is the same check you
// want on a schedule, since a webhook config can be broken long after it was
// last known good.
//
// Usage (from the repo root):
//   DATABASE_URL=... node scripts/verify-webhook-delivery.mjs
//   node scripts/verify-webhook-delivery.mjs --days 7    # default 1
//
// Keys are read from .env.local automatically. Read-only: it writes nothing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg === -1 ? 1 : Math.max(1, Number(process.argv[daysArg + 1]) || 1);

const missing = Object.entries({ DATABASE_URL, RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  console.error("Set them in .env.local (or export them) and try again.");
  process.exit(1);
}

/* ---------------------------------------------------------------- output -- */

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const inr = (paise) => `₹${(paise / 100).toFixed(2)}`;

/* ------------------------------------------------------------------ main -- */

const db = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: /(?:localhost|127\.0\.0\.1|\[?::1\]?)/.test(DATABASE_URL)
    ? undefined
    : { rejectUnauthorized: false },
});
await db.connect();

let undelivered = 0;

try {
  const from = Math.floor(Date.now() / 1000) - DAYS * 86400;
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payments?count=100&from=${from}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    console.error(`Razorpay rejected the request (${res.status}): ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const payments = (await res.json()).items ?? [];
  const captured = payments.filter((p) => p.status === "captured");

  console.log(
    `\n\x1b[1mRazorpay payments in the last ${DAYS} day(s): ` +
      `${payments.length} total, ${captured.length} captured\x1b[0m\n`,
  );

  if (captured.length === 0) {
    warn("No captured payments to reconcile.");
    console.log(
      "\n  This check needs at least one REAL payment through Razorpay checkout —\n" +
        "  that is the whole point, since it is the delivery path no script can fake.\n" +
        "  Pay a test order, then run this again.\n",
    );
    process.exit(0);
  }

  for (const p of captured) {
    // Our own order id round-trips through Razorpay's `notes`, set both by the
    // app (lib/razorpay/client.ts) and by verify-payment. Fall back to matching
    // the intent on Razorpay's order id for anything created another way.
    let orderId = typeof p.notes?.order_id === "string" ? p.notes.order_id : null;
    if (!orderId && p.order_id) {
      const intent = await db.query(
        "SELECT order_id FROM payment_intents WHERE external_ref = $1",
        [p.order_id],
      );
      orderId = intent.rows[0]?.order_id ?? null;
    }

    if (!orderId) {
      warn(`${p.id} ${inr(p.amount)} — captured, but not traceable to any order of ours`);
      continue;
    }

    // The HOLD leg is stamped with Razorpay's payment id, so this is an exact
    // match rather than an inference from the balance.
    const leg = await db.query(
      "SELECT kind, amount FROM escrow_ledger WHERE order_id = $1 AND external_ref = $2",
      [orderId, p.id],
    );
    const order = await db.query("SELECT status FROM orders WHERE id = $1", [orderId]);
    const status = order.rows[0]?.status;

    if (leg.rows.length > 0) {
      pass(`${p.id} ${inr(p.amount)} → ${orderId} (${status}) — escrow funded`);
    } else if (!order.rows.length) {
      warn(`${p.id} ${inr(p.amount)} → ${orderId} — order no longer exists (cleaned-up test run?)`);
    } else {
      undelivered += 1;
      bad(`${p.id} ${inr(p.amount)} → ${orderId} (${status}) — CAPTURED BUT NEVER FUNDED`);
    }
  }
} finally {
  await db.end();
}

if (undelivered === 0) {
  console.log("\n\x1b[32mEvery captured payment reached us — webhook delivery works.\x1b[0m\n");
  process.exit(0);
}

console.log(
  `\n\x1b[31m${undelivered} captured payment(s) never funded escrow.\x1b[0m\n` +
    `\nRazorpay took the money and we never heard about it. In order of likelihood:\n` +
    `  1. The Secret on the Razorpay webhook does not match RAZORPAY_WEBHOOK_SECRET\n` +
    `     on the server — every delivery is refused 401. (If the dashboard shows\n` +
    `     "Secret: Not provided", deliveries arrive unsigned and are refused too.)\n` +
    `  2. The webhook URL points at a different deployment, or one that is\n` +
    `     protected, or a hostname that no longer resolves.\n` +
    `  3. payment.captured is not in the webhook's active events.\n` +
    `\nRazorpay → Settings → Webhooks shows the delivery attempts and their\n` +
    `response codes; a 401 there confirms cause 1.\n`,
);
process.exit(1);
