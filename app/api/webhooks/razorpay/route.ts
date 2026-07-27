import { NextResponse, type NextRequest } from "next/server";

// Imported directly, not via the @/core barrel: this module uses node:crypto,
// which the Edge-runtime middleware bundle cannot contain.
import { parseCapturedPayment, verifyWebhookSignature } from "@/core/payments/razorpaySignature";
import { readRazorpayConfig } from "@/config/payments";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Razorpay webhook receiver — the ONLY thing that may move money into escrow.
 *
 * Order of operations matters and is deliberate:
 *
 *   1. Read the RAW body. Razorpay signs the exact bytes it sent, so parsing
 *      to JSON and re-serialising would change the digest and fail every
 *      legitimate webhook.
 *   2. Verify the HMAC BEFORE looking at the contents. Until the signature
 *      checks out the payload is attacker-controlled text.
 *   3. Only then parse, and hand the amount to confirm_payment(), which
 *      re-checks it against the intent WE recorded — the webhook's own numbers
 *      are never trusted on their own.
 *
 * Always answers 200 to a signed event we understand, including one we have
 * already applied. Razorpay retries non-2xx responses, so returning an error
 * for a duplicate would guarantee an infinite retry loop.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "unreadable body" }, { status: 400 });
  }

  let webhookSecret: string;
  try {
    ({ webhookSecret } = readRazorpayConfig());
  } catch {
    // Misconfiguration is ours, not Razorpay's — 500 so it retries once we fix it.
    return NextResponse.json({ error: "payments not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    // No detail in the response: an attacker probing signatures learns nothing.
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = (body as { event?: string } | null)?.event;
  const admin = createAdminSupabaseClient();

  if (event === "payment.captured") {
    const payment = parseCapturedPayment(body);
    if (!payment) {
      // Signed, but not a shape we can act on. 200 so Razorpay stops retrying
      // something we will never be able to process.
      return NextResponse.json({ ok: true, ignored: "unparseable payment.captured" });
    }

    const { error, data } = await admin.rpc("confirm_payment", {
      p_external_ref: payment.razorpayOrderId,
      p_amount: payment.amount,
      p_currency: payment.currency,
      // One payment id = one confirmation, forever.
      p_idempotency_key: `razorpay:payment.captured:${payment.paymentId}`,
      p_payment_ref: payment.paymentId,
    });

    if (error) {
      // A genuine mismatch (wrong amount, unknown intent) must be visible and
      // must NOT be retried into existence — but a transient DB error should
      // be retried. We cannot reliably tell them apart from here, so we return
      // 500 and rely on the idempotency key to make retries safe.
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ...(data as object) });
  }

  if (event === "payment.failed") {
    const entity = (
      (body as { payload?: { payment?: { entity?: { order_id?: string } } } }).payload?.payment
        ?.entity ?? {}
    ) as { order_id?: string };
    if (entity.order_id) {
      await admin.rpc("fail_payment_intent", { p_external_ref: entity.order_id });
    }
    return NextResponse.json({ ok: true });
  }

  // Signed but not an event we handle. Acknowledge so Razorpay stops retrying.
  return NextResponse.json({ ok: true, ignored: event ?? "unknown" });
}
