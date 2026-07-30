import "server-only";

import { readRazorpayConfig } from "@/config/payments";

/**
 * Razorpay Route transfers — the call that actually moves money to a designer.
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE. Razorpay's transfer API has no
 * idempotency header. If we POST a transfer and the response is lost — a
 * timeout, a container restart, a deploy mid-request — we cannot tell "it never
 * happened" apart from "it happened and we didn't hear". Retrying blind pays
 * the designer twice out of platform funds; not retrying leaves them unpaid.
 *
 * So every send is RECONCILE-BEFORE-CREATE: we list the transfers already
 * attached to the payment and look for one carrying our own payout key in its
 * notes. If it is there, the earlier attempt succeeded and we simply adopt it.
 * Only if it is absent do we create one. Our key is written into `notes` on the
 * way out precisely so it can be found on the way back in.
 *
 * This does not make double payment impossible — two executors racing inside
 * the same millisecond could both see an empty list — but `claim_payouts`
 * (0024) already serialises that with SKIP LOCKED. The reconcile step covers
 * the case the database cannot see: a crash after the HTTP call left our
 * process.
 */
const API_BASE = "https://api.razorpay.com/v1";

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export interface RazorpayTransfer {
  id: string;
  amount: number;
  currency: string;
  /** Razorpay's own status: created | pending | processed | failed | reversed. */
  status?: string;
  recipient?: string;
  notes?: Record<string, string>;
  error?: { description?: string } | null;
}

export interface TransferRequest {
  /** The captured payment the money is transferred OUT OF. */
  paymentId: string;
  /** The payee's Route linked account (`acc_…`). */
  accountRef: string;
  amountMinor: number;
  currency: string;
  /** OUR payout idempotency key — written to notes, matched on the way back. */
  payoutKey: string;
}

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  const { keyId, keySecret } = readRazorpayConfig();

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: authHeader(keyId, keySecret),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Surface Razorpay's own description: "The account is not activated" is a
    // far more actionable failure than a bare 400.
    throw new Error(`Razorpay ${init.method} ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Transfers already attached to a payment. Used to recognise our own retries. */
export async function listTransfers(paymentId: string): Promise<RazorpayTransfer[]> {
  const body = (await call(`/payments/${encodeURIComponent(paymentId)}/transfers`, {
    method: "GET",
  })) as { items?: RazorpayTransfer[] } | null;
  return Array.isArray(body?.items) ? body.items : [];
}

/**
 * The outcome of a send, in OUR vocabulary rather than Razorpay's.
 *
 * `alreadyExisted` distinguishes "we just created this" from "a previous
 * attempt had already created it", which is exactly the distinction an
 * operator needs when a payout run is re-executed after a crash.
 */
export interface SendResult {
  transferId: string;
  status: "PAID" | "PENDING" | "FAILED";
  alreadyExisted: boolean;
  failureReason: string | null;
}

/**
 * Razorpay's transfer statuses, mapped to what we record.
 *
 * `created`/`pending` are NOT successes — the transfer is queued and the
 * webhook will tell us how it ended. Treating them as PAID would mark a
 * designer paid before the money moved.
 */
function mapStatus(status: string | undefined): SendResult["status"] {
  switch (status) {
    case "processed":
      return "PAID";
    case "failed":
    case "reversed":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export async function sendTransfer(req: TransferRequest): Promise<SendResult> {
  // 1. Has a previous attempt of OURS already created this transfer?
  const existing = (await listTransfers(req.paymentId)).find(
    (t) => t.notes?.payout_key === req.payoutKey,
  );
  if (existing) {
    return {
      transferId: existing.id,
      status: mapStatus(existing.status),
      alreadyExisted: true,
      failureReason: existing.error?.description ?? null,
    };
  }

  // 2. No prior attempt — create it, carrying our key so step 1 can find it.
  const created = (await call(`/payments/${encodeURIComponent(req.paymentId)}/transfers`, {
    method: "POST",
    body: {
      account: req.accountRef,
      amount: req.amountMinor,
      currency: req.currency.toUpperCase(),
      notes: { payout_key: req.payoutKey },
    },
  })) as RazorpayTransfer;

  if (!created?.id) throw new Error("Razorpay returned no transfer id");

  return {
    transferId: created.id,
    status: mapStatus(created.status),
    alreadyExisted: false,
    failureReason: created.error?.description ?? null,
  };
}
