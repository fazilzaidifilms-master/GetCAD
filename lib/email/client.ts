import "server-only";

import { readEmailConfig } from "@/config/email";

/**
 * The provider adapter — the ONE file that knows we use Resend.
 *
 * Hand-rolled over a single HTTP endpoint, matching lib/razorpay/client.ts:
 * one call, request shape visible at the site, no SDK to pin. Swapping
 * providers is a rewrite of this file alone.
 */
const API_BASE = "https://api.resend.com";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send one email. Returns the provider's message id, which the outbox stores as
 * proof of delivery-to-provider (not delivery-to-inbox — no provider promises
 * that synchronously). Throws on any non-2xx so the dispatcher records FAILED
 * and the row stays retryable.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ id: string }> {
  const { apiKey, from, replyTo } = readEmailConfig();

  const res = await fetch(`${API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Surface the provider's own message: "domain is not verified" is far more
    // actionable than a bare 403.
    throw new Error(`email send failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) throw new Error("email provider returned no message id");
  return { id: body.id };
}
