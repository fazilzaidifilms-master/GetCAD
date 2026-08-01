// End-to-end verification of the payout (money-OUT) path.
//
// The mirror of verify-payment.mjs. It drives a real order all the way through
// the payout machine against your real database: release escrow, turn the
// released obligations into payout instructions, claim them, then settle them
// the way the processor's webhook would — and prove a reversal returns the
// money to escrow.
//
// WHAT IT DOES NOT DO, and why. It never creates a real Razorpay transfer,
// because that needs a Route linked account this environment cannot make (no
// egress, and account creation can't be faked). That is the ONE seam left
// untested — exactly as flagged in the payout PR. Everything downstream of
// "the processor moved the money" is real: in online mode this posts genuinely
// signed transfer webhooks at your running app, exercising the real webhook
// route (parseTransferEvent -> record_payout_result).
//
// Two modes:
//   --offline  (default-friendly) drives the settlement straight through the DB
//              functions. Needs only DATABASE_URL — no dev server, no secrets.
//   (online)   posts signed transfer webhooks to APP_URL. Needs the dev server
//              running and RAZORPAY_WEBHOOK_SECRET, so it also verifies the
//              route rejects a bad signature.
//
// Usage (from the repo root):
//   DATABASE_URL=... node scripts/verify-payout.mjs --offline
//   DATABASE_URL=... APP_URL=http://localhost:3000 node scripts/verify-payout.mjs   # online
//
// Keys are read from .env.local automatically. --keep leaves this run's rows.
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
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const OFFLINE = process.argv.includes("--offline");
const KEEP = process.argv.includes("--keep");

if (!DATABASE_URL) {
  console.error("Missing: DATABASE_URL");
  console.error("Set it in .env.local (or export it) and try again.");
  process.exit(1);
}
if (!OFFLINE && !WEBHOOK_SECRET) {
  console.error("Online mode needs RAZORPAY_WEBHOOK_SECRET (to sign the transfer webhooks).");
  console.error("Either set it, or run with --offline to drive settlement through the DB.");
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
const inr = (paise) => `₹${(paise / 100).toFixed(2)}`;

/* ------------------------------------------------------------------ main -- */

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const suffix = Date.now().toString(36);
const clientId = `verify_client_${suffix}`;
const designerId = `verify_designer_${suffix}`;
const qcId = `verify_qc_${suffix}`;
const financeId = `verify_finance_${suffix}`;
const orderId = `verify_order_${suffix}`;
const paymentRef = `pay_verify_${suffix}`;

const PRICE = 50000; // ₹500.00 in paise
const DESIGNER_PAYOUT = 30000;
const QC_PAYOUT = 10000;
const PLATFORM = 10000;

/** Run a block as an authenticated FINANCE user (release_escrow is FINANCE-only,
 *  and reads identity from request.jwt.claims exactly like a real request). */
async function asFinance(fn) {
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: financeId, role: "authenticated" }),
  ]);
  await db.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await db.query("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  }
}

const held = async () =>
  (await db.query("SELECT app.escrow_held($1) AS h", [orderId])).rows[0].h;
const payoutState = async () =>
  (await db.query("SELECT public.payout_state($1) AS s", [orderId])).rows[0].s;

/**
 * Settle a payout the way the processor would. Online: post a genuinely signed
 * transfer webhook at the running app. Offline: call record_payout_result
 * directly. Same effect; online also proves the route and its signature check.
 */
async function deliverTransfer(payoutKey, event, transferId, amount) {
  if (OFFLINE) {
    const status = event === "transfer.processed" ? "PAID" : "REVERSED";
    await db.query(
      "SELECT public.record_payout_result($1,$2, p_transfer_ref => $3, p_failure_reason => $4)",
      [payoutKey, status, transferId, status === "REVERSED" ? "reversed by processor" : null],
    );
    return { ok: true, status: 200 };
  }
  const body = JSON.stringify({
    event,
    payload: {
      transfer: {
        entity: {
          id: transferId,
          amount,
          currency: "INR",
          status: event === "transfer.processed" ? "processed" : "reversed",
          notes: { payout_key: payoutKey },
        },
      },
    },
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  return await postWebhook(body, signature);
}

/** POST to the webhook route, returning the status and body together. */
async function postWebhook(body, signature) {
  let res;
  try {
    res = await fetch(`${APP_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-razorpay-signature": signature },
      body,
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${APP_URL}/api/webhooks/razorpay — is \`npm run dev\` running? ` +
        `(${e instanceof Error ? e.message : String(e)}). Or run with --offline.`,
    );
  }
  const text = await res.text();
  // A 401 from a login wall must never be read as the route refusing us.
  assertNotAuthWall(APP_URL, res, text);
  return { ok: res.ok, status: res.status, text };
}

async function cleanup() {
  if (KEEP) return;
  // Money events fan out to notifications (0015), which FK to both the order and
  // the payees — clear those first or the order/user deletes below are refused.
  await db.query(
    "DELETE FROM notifications WHERE order_id = $1 OR user_id = ANY($2)",
    [orderId, [clientId, designerId, qcId, financeId]],
  );
  await db.query("DELETE FROM payouts WHERE order_id = $1", [orderId]);
  // escrow_ledger is append-only by trigger — the guarantee applies to this
  // script too, so disable it narrowly, scoped to this run, re-enabled always.
  await db.query("ALTER TABLE public.escrow_ledger DISABLE TRIGGER escrow_ledger_no_delete");
  try {
    await db.query("DELETE FROM escrow_ledger WHERE order_id = $1", [orderId]);
  } finally {
    await db.query("ALTER TABLE public.escrow_ledger ENABLE TRIGGER escrow_ledger_no_delete");
  }
  await db.query("DELETE FROM orders WHERE id = $1", [orderId]);
  await db.query("DELETE FROM payout_accounts WHERE user_id = ANY($1)", [[designerId, qcId]]);
  await db.query("DELETE FROM designer_profiles WHERE user_id = $1", [designerId]);
  await db.query("DELETE FROM client_profiles WHERE user_id = $1", [clientId]);
  await db.query("DELETE FROM users WHERE id = ANY($1)", [[clientId, designerId, qcId, financeId]]);
}

try {
  if (!OFFLINE) {
    // Before anything is seeded: prove APP_URL reaches THIS app. Check 5 below
    // asserts a rejection, so a login wall in front of the deployment would
    // satisfy it without the app being asked — see scripts/lib/app-url.mjs.
    step("0. Reaching the app");
    const health = await assertAppReachable(APP_URL);
    pass(`${APP_URL} answers /api/health — status ${health.status}`);
    if (health.unset.length) {
      console.log(`     note: not configured there: ${health.unset.join(", ")}`);
    }
  }

  step("1. Seeding a CLOSED, funded order with payable designer + QC");
  await cleanup();
  await db.query(
    `INSERT INTO users (id, role, status) VALUES
       ($1,'CLIENT','ACTIVE'),($2,'DESIGNER','ACTIVE'),($3,'QC','ACTIVE'),($4,'FINANCE','ACTIVE')`,
    [clientId, designerId, qcId, financeId],
  );
  await db.query(
    "INSERT INTO client_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Verify Co','verify@example.com')",
    [`verify_cp_${suffix}`, clientId],
  );
  await db.query(
    "INSERT INTO designer_profiles (id, user_id, legal_name, email) VALUES ($1,$2,'Verify Designer','vd@example.com')",
    [`verify_dp_${suffix}`, designerId],
  );
  // Both payees need a VERIFIED payout account, or release_escrow (0023) refuses.
  for (const uid of [designerId, qcId]) {
    await db.query(
      `INSERT INTO payout_accounts
         (user_id, beneficiary_name, pan, account_number, ifsc, account_type, status, processor_account_ref)
       VALUES ($1,'Verify Payee','ABCDE1234F','123456789012','HDFC0001234','SAVINGS','VERIFIED',$2)`,
      [uid, `acc_verify_${uid}`],
    );
  }
  await db.query(
    `INSERT INTO orders (id, client_id, designer_id, qc_reviewer_id, product_type, status, currency,
       price_total, designer_payout, qc_payout, platform_commission)
     VALUES ($1,$2,$3,$4,'CAD_MODEL','CLOSED','INR',$5,$6,$7,$8)`,
    [orderId, clientId, designerId, qcId, PRICE, DESIGNER_PAYOUT, QC_PAYOUT, PLATFORM],
  );
  // The captured payment that funds escrow — its ref becomes the source the
  // transfers draw from.
  await db.query(
    `INSERT INTO escrow_ledger (order_id, kind, party, amount, currency, created_by, payee_id, external_ref)
     VALUES ($1,'HOLD','CLIENT',$2,'INR',$3,$3,$4)`,
    [orderId, PRICE, clientId, paymentRef],
  );
  pass(`order ${orderId} — CLOSED, ${inr(PRICE)} held`);

  step("2. Releasing escrow (FINANCE) — obligations written to the ledger");
  await asFinance(() => db.query("SELECT public.release_escrow($1)", [orderId]));
  {
    const h = await held();
    const legs = await db.query(
      "SELECT party, amount FROM escrow_ledger WHERE order_id=$1 AND kind='RELEASE' ORDER BY party",
      [orderId],
    );
    if (h === 0) pass("escrow drained to 0 — everything released");
    else fail(`escrow still holds ${h}, expected 0`);
    const got = Object.fromEntries(legs.rows.map((r) => [r.party, r.amount]));
    if (got.DESIGNER === DESIGNER_PAYOUT && got.QC === QC_PAYOUT && got.PLATFORM === PLATFORM) {
      pass(`release legs: designer ${inr(DESIGNER_PAYOUT)}, QC ${inr(QC_PAYOUT)}, platform ${inr(PLATFORM)}`);
    } else {
      fail("release legs wrong", JSON.stringify(got));
    }
  }

  step("3. Opening payout instructions from the obligations");
  const opened = await db.query("SELECT public.open_payouts_for_order($1) AS r", [orderId]);
  if (opened.rows[0].r.created === 2) pass("2 payouts opened (designer + QC); platform gets none");
  else fail(`created ${opened.rows[0].r.created}, expected 2`, JSON.stringify(opened.rows[0].r));

  const payouts = await db.query(
    "SELECT idempotency_key, party, amount, status, source_payment_ref, processor_account_ref FROM payouts WHERE order_id=$1 ORDER BY party",
    [orderId],
  );
  const designerPayout = payouts.rows.find((p) => p.party === "DESIGNER");
  if (designerPayout?.source_payment_ref === paymentRef) {
    pass("each instruction carries the source payment + destination account");
  } else {
    fail("payout not wired to its source", JSON.stringify(payouts.rows));
  }

  step("4. Claiming the batch (the executor takes the work)");
  {
    const claimed = await db.query("SELECT * FROM public.claim_payouts(50)");
    const mine = claimed.rows.filter((r) => r.order_id === orderId);
    if (mine.length === 2 && mine.every((r) => r.status === "PROCESSING" && r.attempts === 1)) {
      pass("both PROCESSING, attempt counted in the same statement");
    } else {
      fail("claim did not take both rows", JSON.stringify(mine.map((r) => [r.party, r.status])));
    }
  }

  if (!OFFLINE) {
    step("5. Rejecting an UNSIGNED transfer webhook");
    const body = JSON.stringify({ event: "transfer.processed", payload: { transfer: { entity: {} } } });
    const res = await postWebhook(body, "deadbeef");
    // The body matters as much as the status: it proves the refusal came from
    // our signature check and not from something in front of the app.
    if (res.status === 401 && res.text.includes("invalid signature")) {
      pass("401 invalid signature — refused by the route itself");
    } else {
      fail(`expected a 401 from the route, got ${res.status}`, res.text.slice(0, 200));
    }
  } else {
    step("5. SKIPPED — offline mode settles through the DB, no webhook to sign");
  }

  step("6. Settling the designer payout (transfer.processed)");
  {
    const r = await deliverTransfer(designerPayout.idempotency_key, "transfer.processed", `trf_${suffix}_d`, DESIGNER_PAYOUT);
    if (!r.ok) fail(`settlement rejected (${r.status})`, (r.text ?? "").slice(0, 200));
    const row = await db.query("SELECT status, processor_transfer_ref, paid_at FROM payouts WHERE idempotency_key=$1", [
      designerPayout.idempotency_key,
    ]);
    if (row.rows[0].status === "PAID" && row.rows[0].processor_transfer_ref && row.rows[0].paid_at) {
      pass("payout -> PAID, with the transfer reference recorded");
    } else {
      fail("payout not marked paid", JSON.stringify(row.rows[0]));
    }
  }

  step("7. Redelivering the SAME settlement (webhooks arrive twice)");
  {
    await deliverTransfer(designerPayout.idempotency_key, "transfer.processed", `trf_${suffix}_d`, DESIGNER_PAYOUT);
    const n = await db.query(
      "SELECT count(*)::int AS n FROM audit.audit_log WHERE action='PAYOUT_PAID' AND entity_id=(SELECT id FROM payouts WHERE idempotency_key=$1)",
      [designerPayout.idempotency_key],
    );
    if (n.rows[0].n <= 1) pass("idempotent — not paid twice");
    else fail(`recorded ${n.rows[0].n} PAID events`);
  }

  step("8. A reversal returns the money to escrow");
  {
    const before = await held();
    const r = await deliverTransfer(designerPayout.idempotency_key, "transfer.reversed", `trf_${suffix}_d`, DESIGNER_PAYOUT);
    if (!r.ok) fail(`reversal rejected (${r.status})`, (r.text ?? "").slice(0, 200));
    const row = await db.query("SELECT status FROM payouts WHERE idempotency_key=$1", [designerPayout.idempotency_key]);
    const after = await held();
    if (row.rows[0].status === "REVERSED" && after === before + DESIGNER_PAYOUT) {
      pass(`payout -> REVERSED, ${inr(DESIGNER_PAYOUT)} back in escrow (held ${inr(after)})`);
    } else {
      fail(`reversal wrong: status ${row.rows[0].status}, held ${before} -> ${after}`);
    }
  }

  step("9. Reconciliation view + audit chain");
  {
    const s = await payoutState();
    console.log(`     owed ${inr(s.owed)} · paid ${inr(s.paid)} · reversed ${inr(s.reversed)}`);
    const chain = await db.query("SELECT audit.verify_chain() AS r");
    if (chain.rows[0].r.valid) pass(`audit chain valid across ${chain.rows[0].r.entries} entries`);
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
    ? "\n\x1b[32mAll checks passed — the payout path works end to end (bar the live Route transfer).\x1b[0m\n"
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
