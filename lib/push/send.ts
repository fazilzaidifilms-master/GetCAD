import webpush, { WebPushError } from "web-push";

import { readPushConfig } from "@/config/push";
import { pushMessageFor } from "@/core";

/**
 * Sending, and knowing when a device is gone.
 *
 * The encryption is not ours to write. `web-push` implements RFC 8291 (payload
 * encryption) and RFC 8292 (VAPID) — an AES128GCM scheme with an ECDH key
 * agreement per message. Hand-rolling that is how you end up shipping
 * ciphertext a push service silently refuses, or worse, that it accepts and
 * relays wrong.
 *
 * WHAT THIS ADDS ON TOP. Two things the library does not decide:
 *
 *   1. A 404 or 410 means the subscription is dead — the user cleared site
 *      data, uninstalled the app, or the push service rotated it. That is not
 *      an error to retry, it is a row to delete. Left in place it is retried on
 *      every run forever, and the queue slowly fills with corpses.
 *   2. Every other failure is transient by assumption, so the caller can retry.
 *      Distinguishing them is the whole reason this returns a verdict rather
 *      than throwing.
 */

export type DeliveryOutcome =
  /** Accepted by the push service. */
  | { status: "SENT" }
  /** The subscription is gone. Delete it. */
  | { status: "EXPIRED" }
  /** Something transient. Leave the row for the next run. */
  | { status: "FAILED"; reason: string };

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;

/** Returns false when push is not configured, so callers can skip quietly. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const config = readPushConfig();
  if (!config) return false;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  configured = true;
  return true;
}

export function pushIsAvailable(): boolean {
  return ensureConfigured();
}

/**
 * Deliver one notification to one device.
 *
 * The payload is built by `pushMessageFor`, which takes a kind and an order id
 * and refuses everything else — see core/notifications/push for why the
 * database's summary text is deliberately not an input here.
 */
export async function sendPush(
  subscription: DeviceSubscription,
  kind: string,
  orderId: string | null,
): Promise<DeliveryOutcome> {
  if (!ensureConfigured()) return { status: "FAILED", reason: "push is not configured" };

  const message = pushMessageFor(kind, orderId);
  // An unrecognised kind has no approved wording. Treat it as delivered so the
  // queue does not retry it three times before giving up on something that was
  // never going to be sent.
  if (!message) return { status: "SENT" };

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(message),
      {
        // Push services drop anything they could not deliver within the TTL.
        // Six hours: long enough to survive a phone being off overnight in a
        // different timezone, short enough that nothing arrives so late it is
        // confusing. Stale rows are dropped at the queue too (see 0031).
        TTL: 6 * 60 * 60,
        urgency: "normal",
      },
    );
    return { status: "SENT" };
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      return { status: "EXPIRED" };
    }
    const reason = error instanceof Error ? error.message : "unknown push failure";
    // Truncated because it is stored and logged, and some services return an
    // entire HTML error page as the body.
    return { status: "FAILED", reason: reason.slice(0, 300) };
  }
}
