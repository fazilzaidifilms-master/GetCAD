// Register a payee's bank details with the payment processor, so their
// payouts have somewhere to go.
//
// Until a payee has a `processor_account_ref`, `open_payouts_for_order` will
// create instructions the executor cannot send. This is the step that fills it
// in, and it has two modes on purpose:
//
//   --account-ref acc_xxx   Record a linked account you created BY HAND in the
//                           Razorpay dashboard. Slower per designer, but it
//                           works today and every step is visible to you.
//
//   --create                Run the three-call v2 Accounts flow automatically.
//                           ⚠️ This path has never been executed against the
//                           live API from this repo (no egress in CI), so the
//                           first real run is the verification. Use it with a
//                           test-mode key and read the output carefully.
//
// Usage (from the repo root):
//   DATABASE_URL=... node scripts/link-payout-account.mjs --user <users.id> --account-ref acc_xxx
//   DATABASE_URL=... node scripts/link-payout-account.mjs --user <users.id> --create
//   DATABASE_URL=... node scripts/link-payout-account.mjs --list
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const DATABASE_URL = process.env.DATABASE_URL;
const LIST = process.argv.includes("--list");
const CREATE = process.argv.includes("--create");
const USER_ID = flag("--user");
const ACCOUNT_REF = flag("--account-ref");

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const db = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

/** Digits only; Razorpay rejects formatted numbers. */
function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function listPending() {
  // Deliberately selects the DISPLAY fragments, not the secrets: listing who
  // needs linking should not print anyone's bank account to a terminal.
  const { rows } = await db.query(
    `SELECT pa.user_id, u.role, pa.status, pa.account_last4, pa.processor_account_ref
     FROM payout_accounts pa
     JOIN users u ON u.id = pa.user_id
     ORDER BY pa.updated_at DESC`,
  );
  if (rows.length === 0) {
    console.log("No payout accounts on file.");
    return;
  }
  console.log("user_id                     role      status                 acct   linked");
  for (const r of rows) {
    console.log(
      `${r.user_id.padEnd(26)}  ${String(r.role).padEnd(8)}  ${r.status.padEnd(20)}  ` +
        `••${r.account_last4}  ${r.processor_account_ref ?? "—"}`,
    );
  }
}

async function link() {
  if (!USER_ID) {
    console.error("--user <users.id> is required. Run with --list to see who needs linking.");
    process.exit(1);
  }
  if (!CREATE && !ACCOUNT_REF) {
    console.error("Pass either --account-ref acc_xxx (recommended) or --create.");
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT pa.*, dp.legal_name, dp.email
     FROM payout_accounts pa
     LEFT JOIN designer_profiles dp ON dp.user_id = pa.user_id
     WHERE pa.user_id = $1`,
    [USER_ID],
  );
  if (rows.length === 0) {
    console.error(`No payout account for user ${USER_ID}. They must submit their details first.`);
    process.exit(1);
  }
  const account = rows[0];

  let accountRef = ACCOUNT_REF;

  if (CREATE) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      console.error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required for --create.");
      process.exit(1);
    }
    if (!account.email) {
      console.error(
        "This payee has no email on their designer profile, which Razorpay requires. " +
          "Use --account-ref after creating the account by hand.",
      );
      process.exit(1);
    }

    const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
    const post = async (path, body, method = "POST") => {
      const res = await fetch(`https://api.razorpay.com/v2${path}`, {
        method,
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
      return JSON.parse(text);
    };

    console.log("Creating linked account…");
    const created = await post("/accounts", {
      email: account.email,
      phone: normalizePhone(account.phone ?? "9999999999"),
      type: "route",
      reference_id: USER_ID,
      legal_business_name: account.legal_name ?? account.beneficiary_name,
      business_type: "individual",
      contact_name: account.legal_name ?? account.beneficiary_name,
      profile: { category: "services", subcategory: "web_designing" },
      legal_info: { pan: account.pan },
    });
    accountRef = created.id;
    console.log(`  account: ${accountRef}`);

    console.log("Adding stakeholder…");
    await post(`/accounts/${accountRef}/stakeholders`, {
      name: account.legal_name ?? account.beneficiary_name,
      email: account.email,
      kyc: { pan: account.pan },
    });

    console.log("Configuring Route settlements…");
    const product = await post(`/accounts/${accountRef}/products`, {
      product_name: "route",
      tnc_accepted: true,
    });
    const configured = await post(
      `/accounts/${accountRef}/products/${product.id}`,
      {
        settlements: {
          account_number: account.account_number,
          ifsc_code: account.ifsc,
          beneficiary_name: account.beneficiary_name,
        },
        tnc_accepted: true,
      },
      "PATCH",
    );
    console.log(`  activation: ${configured.activation_status ?? "unknown"}`);
  }

  // set_payout_account_status is the sanctioned write path — it audits the
  // change and keeps the status machine honest.
  await db.query("SELECT public.set_payout_account_status($1,'VERIFIED',NULL,$2)", [
    USER_ID,
    accountRef,
  ]);
  console.log(`\n✓ ${USER_ID} is now VERIFIED and linked to ${accountRef}.`);
  console.log("  Payouts for this payee can now be opened and executed.");
}

try {
  await db.connect();
  if (LIST) await listPending();
  else await link();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
