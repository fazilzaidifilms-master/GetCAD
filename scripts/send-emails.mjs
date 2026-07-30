// Drain the email outbox: send anything PENDING or FAILED.
//
// The app already flushes the outbox best-effort right after a form submission,
// so in normal operation there is little for this to do. It exists for the
// cases inline sending cannot cover: an email enqueued while the provider was
// down, a run where email was not yet configured, or a scheduled sweep. Safe to
// run on a cron — claim_emails uses SKIP LOCKED, so overlapping runs never send
// the same message twice.
//
// Usage (from the repo root):
//   DATABASE_URL=... RESEND_API_KEY=... EMAIL_FROM="The CAD Pillar <hello@…>" \
//     node scripts/send-emails.mjs
//
// Reads .env.local automatically. Without RESEND_API_KEY/EMAIL_FROM it reports
// what is queued and exits without sending — a safe dry run.
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
    // No .env.local — use whatever is already exported.
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM;
const REPLY_TO = process.env.EMAIL_REPLY_TO || null;
const LIMIT = Number(process.env.EMAIL_BATCH ?? "50");

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const db = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

// The renderer lives in the framework-free core, so this operational script
// builds identical bodies to the app without importing any Next/React code.
const { renderEmail, isEmailTemplate } = await import(
  new URL("../core/email/templates.ts", import.meta.url).href
).catch(async () => {
  // .ts is not directly importable under plain node; fall back to a tiny shim.
  // In practice this script runs via the same toolchain as the app (tsx/next),
  // where the .ts import resolves. Kept explicit so the failure is legible.
  throw new Error(
    "Run this with a TypeScript-aware loader (e.g. `npx tsx scripts/send-emails.mjs`), " +
      "so core/email/templates.ts can be imported.",
  );
});

async function sendViaProvider(msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (!body?.id) throw new Error("provider returned no message id");
  return body.id;
}

async function main() {
  await db.connect();

  if (!API_KEY || !FROM) {
    const { rows } = await db.query(
      "SELECT status, count(*)::int AS n FROM email_outbox GROUP BY status ORDER BY status",
    );
    console.log("Email is not configured (RESEND_API_KEY / EMAIL_FROM unset). Nothing sent.");
    console.log("Currently queued:");
    for (const r of rows) console.log(`  ${r.status.padEnd(10)} ${r.n}`);
    return;
  }

  const { rows: claimed } = await db.query("SELECT * FROM public.claim_emails($1)", [
    Math.min(Math.max(LIMIT, 1), 100),
  ]);
  if (claimed.length === 0) {
    console.log("Nothing to send.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      if (!isEmailTemplate(row.template)) throw new Error(`unknown template: ${row.template}`);
      const rendered = renderEmail(row.template, row.payload ?? {});
      const id = await sendViaProvider({
        to: row.recipient_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await db.query("SELECT public.record_email_result($1,'SENT',$2)", [row.idempotency_key, id]);
      sent += 1;
    } catch (e) {
      await db.query("SELECT public.record_email_result($1,'FAILED',NULL,$2)", [
        row.idempotency_key,
        String(e.message ?? e).slice(0, 500),
      ]);
      failed += 1;
    }
  }
  console.log(`Done: ${sent} sent, ${failed} failed (failed rows stay queued for retry).`);
}

try {
  await main();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
