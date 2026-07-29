/**
 * Razorpay signature verification — the security boundary of the money flow.
 *
 * Everything a browser tells us about a payment is untrusted. A client could
 * POST "payment succeeded" straight at our callback and, if we believed it,
 * fund their own order for free. Razorpay's answer is an HMAC-SHA256 signature
 * that only someone holding our secret could produce.
 *
 * Two DIFFERENT signatures exist and they are not interchangeable:
 *
 *   1. WEBHOOK  — HMAC over the RAW request body, keyed by the WEBHOOK SECRET,
 *      sent as `x-razorpay-signature`. This is the authoritative, server-to-
 *      server confirmation and the only thing we let move money.
 *
 *   2. CHECKOUT CALLBACK — HMAC over `order_id|payment_id`, keyed by the API
 *      KEY SECRET, handed to the browser when checkout completes. Useful for
 *      showing the user a confirmation immediately, but it arrives via the
 *      client, so we never settle money on it alone.
 *
 * Pure and framework-free: bytes and strings in, boolean out. No network, no
 * environment reads — the secret is injected so this is fully testable.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time compare of two hex digests. Never use === on a MAC. */
function hexEqual(a: string, b: string): boolean {
  // Reject early on length mismatch: Buffer.compare would throw, and the length
  // of a digest is not a secret.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false; // non-hex input
  }
}

/**
 * Verify a Razorpay WEBHOOK.
 *
 * `rawBody` must be the EXACT bytes Razorpay sent. Parsing to JSON and
 * re-serialising changes key order and whitespace, which changes the digest and
 * makes every legitimate webhook fail — a classic and very confusing bug.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return hexEqual(expected, signature);
}

/**
 * Verify the signature handed back to the browser when checkout completes.
 *
 * Confirms the browser is reporting a real payment, but NOT that funds settled —
 * only the webhook does that. Use this to show a confirmation, never to release
 * or hold money.
 */
export function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string | null | undefined,
  keySecret: string,
): boolean {
  if (!signature || !keySecret || !razorpayOrderId || !razorpayPaymentId) return false;
  const expected = createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return hexEqual(expected, signature);
}

/* ------------------------------------------------------------- payloads -- */

export interface CapturedPayment {
  /** Razorpay's payment id — stored as external_ref for reconciliation. */
  paymentId: string;
  /** Razorpay's order id, which carries our own order id in its notes. */
  razorpayOrderId: string;
  /** OUR order id, round-tripped through Razorpay's notes. */
  orderId: string;
  /** Minor units (paise for INR) — the same unit the ledger uses. */
  amount: number;
  currency: string;
}

/**
 * Pull the fields we care about out of a `payment.captured` webhook.
 *
 * Returns null for any event we do not act on, or a payload missing what we
 * need — a malformed webhook must be ignored, never guessed at.
 */
export function parseCapturedPayment(body: unknown): CapturedPayment | null {
  if (typeof body !== "object" || body === null) return null;
  const evt = body as Record<string, unknown>;
  if (evt.event !== "payment.captured") return null;

  const payment = (evt.payload as Record<string, unknown> | undefined)?.payment as
    | Record<string, unknown>
    | undefined;
  const entity = payment?.entity as Record<string, unknown> | undefined;
  if (!entity) return null;

  const paymentId = typeof entity.id === "string" ? entity.id : null;
  const razorpayOrderId = typeof entity.order_id === "string" ? entity.order_id : null;
  const amount = typeof entity.amount === "number" ? entity.amount : null;
  const currency = typeof entity.currency === "string" ? entity.currency : null;
  const notes = entity.notes as Record<string, unknown> | undefined;
  const orderId = typeof notes?.order_id === "string" ? notes.order_id : null;

  if (!paymentId || !razorpayOrderId || !orderId || amount === null || !currency) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return { paymentId, razorpayOrderId, orderId, amount, currency };
}

/* ----------------------------------------------------------- transfers -- */

export interface TransferEvent {
  /** Razorpay's transfer id (`trf_…`) — recorded as processor_transfer_ref. */
  transferId: string;
  /**
   * OUR payout idempotency key, round-tripped through the transfer's notes.
   *
   * This is what makes the webhook path safe. Matching on the transfer id alone
   * would mean trusting Razorpay to tell us which of OUR obligations it settled;
   * matching on our own key means a webhook can only ever resolve a payout we
   * deliberately created.
   */
  payoutKey: string;
  /** What we asked the processor to do with it. */
  outcome: "PAID" | "FAILED" | "REVERSED";
  amount: number;
  currency: string;
  /** Razorpay's own description of a failure, when it gives one. */
  failureReason: string | null;
}

/** Razorpay transfer events we act on, mapped to our payout outcomes. */
const TRANSFER_EVENTS: Record<string, TransferEvent["outcome"]> = {
  "transfer.processed": "PAID",
  "transfer.failed": "FAILED",
  // A settled transfer that came back. Money-bearing in the opposite direction.
  "transfer.reversed": "REVERSED",
};

/**
 * Pull the fields we care about out of a transfer webhook.
 *
 * Returns null for anything we do not act on or cannot act on safely. In
 * particular a transfer with no `notes.payout_key` is IGNORED rather than
 * guessed at: a transfer we cannot tie to one of our own payout rows is not
 * something to resolve by matching on amount.
 */
export function parseTransferEvent(body: unknown): TransferEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const evt = body as Record<string, unknown>;
  const event = typeof evt.event === "string" ? evt.event : null;
  if (!event) return null;

  const outcome = TRANSFER_EVENTS[event];
  if (!outcome) return null;

  const transfer = (evt.payload as Record<string, unknown> | undefined)?.transfer as
    | Record<string, unknown>
    | undefined;
  const entity = transfer?.entity as Record<string, unknown> | undefined;
  if (!entity) return null;

  const transferId = typeof entity.id === "string" ? entity.id : null;
  const amount = typeof entity.amount === "number" ? entity.amount : null;
  const currency = typeof entity.currency === "string" ? entity.currency : null;
  const notes = entity.notes as Record<string, unknown> | undefined;
  const payoutKey = typeof notes?.payout_key === "string" ? notes.payout_key : null;

  const error = entity.error as Record<string, unknown> | undefined;
  const failureReason =
    typeof error?.description === "string"
      ? error.description
      : typeof entity.failure_reason === "string"
        ? entity.failure_reason
        : null;

  if (!transferId || !payoutKey || amount === null || !currency) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return { transferId, payoutKey, outcome, amount, currency, failureReason };
}
