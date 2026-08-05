import { NextResponse, type NextRequest } from "next/server";

import { cronRequestIsAuthorised } from "@/config/cron";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { pushIsAvailable, sendPush } from "@/lib/push/send";

/**
 * Drain the notification queue.
 *
 * WHY THIS IS A ROUTE AND NOT JUST THE SCRIPT. Notifications are written by a
 * database trigger, inside whatever transaction caused the event. There is no
 * HTTP handler standing by afterwards to send them — unlike email, which the
 * app flushes best-effort at the end of the request that queued it. So delivery
 * needs something on a timer, and on Vercel the thing on a timer is a URL.
 *
 * `scripts/send-push.mjs` does the same work from a shell and stays the tool
 * for a local run or a one-off catch-up. The logic is deliberately duplicated
 * rather than shared through a helper the route would have to import: the
 * script must run without Next's module resolution, and the shape here is
 * twenty lines. What is NOT duplicated is the part that matters — the wording
 * comes from core/notifications/push in both.
 *
 * SAFE TO OVERLAP AND SAFE TO MISS. `claim_push_notifications` uses SKIP
 * LOCKED, so two invocations never claim the same row, and rows older than the
 * cutoff are retired rather than delivered late. A run that never happens costs
 * a notification's timeliness, never its correctness — it is still in the app.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bounded so one invocation cannot run past the platform's timeout. */
const BATCH = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!cronRequestIsAuthorised(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    // 404, not 401. A 401 confirms the endpoint exists and that a secret is
    // what stands between the caller and it.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!pushIsAvailable()) {
    // Not an error: push is optional, and a deployment without VAPID keys
    // should say so plainly rather than fail a scheduled job every minute.
    return NextResponse.json({ status: "push is not configured", sent: 0 });
  }

  const supabase = createAdminSupabaseClient();

  const { data: claimed, error: claimError } = await supabase.rpc("claim_push_notifications", {
    p_limit: BATCH,
  });
  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  const notifications = (claimed ?? []) as {
    id: string;
    user_id: string;
    kind: string;
    order_id: string | null;
  }[];
  if (notifications.length === 0) {
    return NextResponse.json({ status: "ok", claimed: 0, sent: 0 });
  }

  // One query for every recipient's devices rather than one per notification —
  // a delivery fans out to the same person several times over.
  const userIds = [...new Set(notifications.map((n) => n.user_id))];
  const { data: subscriptions, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const byUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  for (const sub of subscriptions ?? []) {
    const list = byUser.get(sub.user_id as string) ?? [];
    list.push({ endpoint: sub.endpoint as string, p256dh: sub.p256dh as string, auth: sub.auth as string });
    byUser.set(sub.user_id as string, list);
  }

  const done: string[] = [];
  const expired = new Set<string>();
  let sent = 0;
  let failed = 0;

  for (const notification of notifications) {
    const devices = byUser.get(notification.user_id) ?? [];
    if (devices.length === 0) {
      // Done, not failed. This person has never turned notifications on;
      // retrying twice more only holds up the queue.
      done.push(notification.id);
      continue;
    }

    let anyDelivered = false;
    for (const device of devices) {
      const outcome = await sendPush(device, notification.kind, notification.order_id);
      if (outcome.status === "SENT") {
        anyDelivered = true;
        sent += 1;
      } else if (outcome.status === "EXPIRED") {
        expired.add(device.endpoint);
      } else {
        failed += 1;
      }
    }

    // Reaching one of someone's devices is delivery. Retrying the row because
    // their old tablet is offline would send a duplicate to the phone that
    // already buzzed. A row whose every device is dead is also done — there is
    // nothing left to deliver to.
    if (anyDelivered || devices.every((d) => expired.has(d.endpoint))) done.push(notification.id);
  }

  for (const endpoint of expired) {
    await supabase.rpc("expire_push_subscription", { p_endpoint: endpoint });
  }
  if (done.length > 0) {
    await supabase.rpc("mark_push_sent", { p_ids: done });
  }

  return NextResponse.json({
    status: "ok",
    claimed: notifications.length,
    sent,
    expired: expired.size,
    failed,
  });
}
