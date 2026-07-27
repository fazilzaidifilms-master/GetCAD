import "server-only";

import { readRazorpayConfig } from "@/config/payments";

/**
 * Minimal Razorpay REST client — just the calls collection needs.
 *
 * Deliberately hand-rolled rather than pulling the SDK: we use one endpoint,
 * and a thin wrapper keeps the request shape visible at the call site (which
 * matters a lot when debugging a payment that did not settle).
 */
const API_BASE = "https://api.razorpay.com/v1";

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Create a Razorpay order — the object the browser's checkout attaches to.
 *
 * `amountMinor` is in the smallest unit (paise for INR), the same unit the
 * ledger uses, so no conversion happens anywhere in this path.
 *
 * Our own order id travels in `notes` and comes back on the webhook, which is
 * how a confirmation finds its way home. `receipt` carries it too, for the
 * Razorpay dashboard's benefit during support.
 */
export async function createRazorpayOrder(params: {
  amountMinor: number;
  currency: string;
  orderId: string;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = readRazorpayConfig();

  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: {
      Authorization: authHeader(keyId, keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amountMinor,
      currency: params.currency.toUpperCase(),
      receipt: params.orderId,
      notes: { order_id: params.orderId },
    }),
  });

  if (!res.ok) {
    // Surface Razorpay's own description — "amount must be at least 100" is a
    // far more useful failure than a bare 400.
    const detail = await res.text().catch(() => "");
    throw new Error(`Razorpay order creation failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await res.json()) as RazorpayOrder;
  if (!body?.id) throw new Error("Razorpay returned no order id");
  return body;
}
