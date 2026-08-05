// Drain the notification queue: push anything not yet delivered to a device.
//
// Unlike email, there is no inline flush after a request — a notification is
// written by a database trigger, inside someone else's transaction, and there
// is no HTTP handler standing by to send it. So this script IS the delivery
// path and wants a cron: every minute or two in production.
//
// Usage (from the repo root):
//   DATABASE_URL=... NEXT_PUBLIC_VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//     VAPID_SUBJECT=mailto:ops@thecadpillar.com npx tsx scripts/send-push.mjs
//
// Reads .env.local automatically. Without VAPID keys it reports what is queued
// and exits without sending — a safe dry run.
//
// SAFE TO OVERLAP. claim_push_notifications uses FOR UPDATE SKIP LOCKED, so two
// runs never claim the same notification.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import webpush, { WebPushError } from "web-push";

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
const LIMIT = Number(process.env.PUSH_BATCH ?? "100");

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

// The wording lives in the framework-free core, so this script and the app can
// never disagree about what a notification says.
const { pushMessageFor } = await import(
  new URL("../core/notifications/push.ts", import.meta.url).href
).catch(() => {
  throw new Error(
    "Run this with a TypeScript-aware loader (e.g. `npx tsx scripts/send-push.mjs`), " +
      "so core/notifications/push.ts can be imported.",
  );
});

const { pushConfigProblems } = await import(new URL("../config/push.ts", import.meta.url).href);

const problems = pushConfigProblems(process.env);
const canSend = problems.length === 0;
if (canSend) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

const db = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: /(?:localhost|127\.0\.0\.1|\[?::1\]?)/.test(DATABASE_URL)
    ? undefined
    : { rejectUnauthorized: false },
});

await db.connect();

try {
  if (!canSend) {
    // Dry run: say what is waiting, and exactly why nothing will be sent. Do
    // NOT claim — claiming burns an attempt on every row for a run that was
    // never going to deliver anything.
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM notifications WHERE pushed_at IS NULL",
    );
    console.log(`push is not configured; ${rows[0].n} notification(s) waiting.`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(0);
  }

  const { rows: claimed } = await db.query("SELECT * FROM public.claim_push_notifications($1)", [
    LIMIT,
  ]);

  if (claimed.length === 0) {
    console.log("nothing to push.");
    process.exit(0);
  }

  // One query for every recipient's devices, rather than one per notification —
  // a delivery fans out to the same person several times over.
  const userIds = [...new Set(claimed.map((n) => n.user_id))];
  const { rows: subs } = await db.query(
    "SELECT user_id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = ANY($1)",
    [userIds],
  );
  const byUser = new Map();
  for (const sub of subs) {
    if (!byUser.has(sub.user_id)) byUser.set(sub.user_id, []);
    byUser.get(sub.user_id).push(sub);
  }

  const done = [];
  const expired = new Set();
  let sent = 0;
  let failed = 0;
  let noDevice = 0;

  for (const notification of claimed) {
    const devices = byUser.get(notification.user_id) ?? [];
    if (devices.length === 0) {
      // Not a failure. This person has never turned notifications on, and
      // retrying twice more would only delay the queue.
      done.push(notification.id);
      noDevice += 1;
      continue;
    }

    const message = pushMessageFor(notification.kind, notification.order_id);
    if (!message) {
      // A kind with no approved wording is never sent — see the module for why
      // falling back to the summary column is refused.
      done.push(notification.id);
      continue;
    }

    // A notification is "done" if it reached at least one of this person's
    // devices. Retrying the whole row because their old tablet is offline would
    // send a duplicate to the phone that already buzzed.
    let anyDelivered = false;
    for (const device of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify(message),
          { TTL: 6 * 60 * 60, urgency: "normal" },
        );
        anyDelivered = true;
        sent += 1;
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          // The subscription is gone — site data cleared, app uninstalled, or
          // the service rotated it. Delete it, or it is retried forever.
          expired.add(device.endpoint);
        } else {
          failed += 1;
          console.error(`push failed (${notification.kind}): ${error?.message ?? error}`);
        }
      }
    }

    // A row whose only devices were all expired counts as done: there is
    // nothing left to deliver to.
    if (anyDelivered || devices.every((d) => expired.has(d.endpoint))) done.push(notification.id);
  }

  for (const endpoint of expired) {
    await db.query("SELECT public.expire_push_subscription($1)", [endpoint]);
  }
  if (done.length > 0) {
    await db.query("SELECT public.mark_push_sent($1)", [done]);
  }

  console.log(
    `claimed ${claimed.length}: ${sent} sent, ${noDevice} with no device, ` +
      `${expired.size} subscription(s) expired, ${failed} failed (will retry).`,
  );
} finally {
  await db.end();
}
