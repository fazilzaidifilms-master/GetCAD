import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { flushEmailsBestEffort } from "@/lib/email/dispatch";
import { listTransfers, sendTransfer } from "@/lib/razorpay/transfers";

/**
 * The payout executor: turn claimed instructions into real transfers.
 *
 * The shape is deliberately boring — claim a batch, send each one, record what
 * happened — because the interesting decisions all live elsewhere and are
 * enforced where they cannot be bypassed:
 *
 *   * "pay each obligation once" is a UNIQUE constraint (0024), not a check here;
 *   * "two workers never take the same row" is SKIP LOCKED (0024);
 *   * "a lost response doesn't double-pay" is reconcile-before-create
 *     (lib/razorpay/transfers.ts).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: mark a payout PAID because the API call
 * returned 200. Razorpay accepts a transfer and settles it asynchronously, so a
 * `created`/`pending` transfer is left in PROCESSING for the webhook to
 * resolve. Recording success on acceptance would tell a designer they had been
 * paid while the money was still queued — and would leave nothing to reconcile
 * if it later failed.
 */
export interface ClaimedPayout {
  id: string;
  order_id: string;
  party: string;
  amount: number;
  currency: string;
  idempotency_key: string;
  source_payment_ref: string | null;
  processor_account_ref: string | null;
  attempts: number;
}

export interface ExecutionOutcome {
  payoutKey: string;
  result: "paid" | "in_flight" | "failed" | "skipped";
  detail: string;
}

/** Reasons an instruction cannot be attempted at all, checked before any call. */
function unsendable(p: ClaimedPayout): string | null {
  if (!p.source_payment_ref) {
    return "no source payment on the order — the transfer has nothing to draw from";
  }
  if (!p.processor_account_ref) {
    return "the payee has no linked account at the processor yet";
  }
  return null;
}

export async function executePayouts(limit = 10): Promise<ExecutionOutcome[]> {
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin.rpc("claim_payouts", { p_limit: limit });
  if (error) throw new Error(`could not claim payouts: ${error.message}`);

  const claimed = (data ?? []) as ClaimedPayout[];
  const outcomes: ExecutionOutcome[] = [];

  for (const payout of claimed) {
    const blocked = unsendable(payout);
    if (blocked) {
      // Recorded as FAILED rather than left PROCESSING: FAILED is retryable and
      // visible, PROCESSING looks like work in flight that will never land.
      await admin.rpc("record_payout_result", {
        p_idempotency_key: payout.idempotency_key,
        p_status: "FAILED",
        p_failure_reason: blocked,
      });
      outcomes.push({ payoutKey: payout.idempotency_key, result: "skipped", detail: blocked });
      continue;
    }

    try {
      const sent = await sendTransfer({
        paymentId: payout.source_payment_ref!,
        accountRef: payout.processor_account_ref!,
        amountMinor: payout.amount,
        currency: payout.currency,
        payoutKey: payout.idempotency_key,
      });

      if (sent.status === "PAID") {
        await admin.rpc("record_payout_result", {
          p_idempotency_key: payout.idempotency_key,
          p_status: "PAID",
          p_transfer_ref: sent.transferId,
        });
        outcomes.push({
          payoutKey: payout.idempotency_key,
          result: "paid",
          detail: sent.alreadyExisted
            ? `adopted transfer ${sent.transferId} from an earlier attempt`
            : `transfer ${sent.transferId}`,
        });
        continue;
      }

      if (sent.status === "FAILED") {
        await admin.rpc("record_payout_result", {
          p_idempotency_key: payout.idempotency_key,
          p_status: "FAILED",
          p_failure_reason: sent.failureReason ?? "the processor rejected the transfer",
        });
        outcomes.push({
          payoutKey: payout.idempotency_key,
          result: "failed",
          detail: sent.failureReason ?? "rejected by processor",
        });
        continue;
      }

      // Accepted and queued. Stays PROCESSING; the webhook resolves it.
      outcomes.push({
        payoutKey: payout.idempotency_key,
        result: "in_flight",
        detail: `transfer ${sent.transferId} accepted, awaiting settlement`,
      });
    } catch (e) {
      // A thrown error means we do NOT know whether the transfer was created.
      // Leaving the row in PROCESSING is the safe state: it will not be
      // re-claimed automatically. Marking it FAILED here would make it
      // retryable, which is exactly wrong when a transfer may be in flight.
      // reconcilePayouts() below is what eventually resolves it, by asking the
      // processor rather than guessing.
      const detail = e instanceof Error ? e.message : "unknown error";
      outcomes.push({ payoutKey: payout.idempotency_key, result: "in_flight", detail });
    }
  }

  // A PAID result enqueues a "your payout is on its way" email transactionally;
  // send anything queued now, best-effort. Never affects the payout run.
  await flushEmailsBestEffort();
  return outcomes;
}

/**
 * Resolve payouts stuck in PROCESSING by asking the processor what happened.
 *
 * This is the other half of the crash-safety story. `executePayouts` refuses to
 * guess when a response is lost; this decides, using the only authority that
 * can actually answer — the list of transfers attached to the payment, matched
 * on our own payout key.
 *
 * The two conclusions are asymmetric on purpose:
 *
 *   FOUND     — adopt whatever state the processor reports. The transfer exists,
 *               so this payout is settled or settling, never retryable.
 *   NOT FOUND — the transfer was never created, which is the ONE case where
 *               retrying is provably safe. Marked FAILED so the queue picks it
 *               up again.
 *
 * `olderThanMinutes` keeps this from racing a payout run that is still working.
 */
export async function reconcilePayouts(olderThanMinutes = 15): Promise<ExecutionOutcome[]> {
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin.rpc("stale_payouts", { p_minutes: olderThanMinutes });
  if (error) throw new Error(`could not list stale payouts: ${error.message}`);

  const stale = (data ?? []) as ClaimedPayout[];
  const outcomes: ExecutionOutcome[] = [];

  for (const payout of stale) {
    if (!payout.source_payment_ref) {
      await admin.rpc("record_payout_result", {
        p_idempotency_key: payout.idempotency_key,
        p_status: "FAILED",
        p_failure_reason: "no source payment to reconcile against",
      });
      outcomes.push({
        payoutKey: payout.idempotency_key,
        result: "failed",
        detail: "no source payment",
      });
      continue;
    }

    try {
      const match = (await listTransfers(payout.source_payment_ref)).find(
        (t) => t.notes?.payout_key === payout.idempotency_key,
      );

      if (!match) {
        // Provably never created — safe to retry.
        await admin.rpc("record_payout_result", {
          p_idempotency_key: payout.idempotency_key,
          p_status: "FAILED",
          p_failure_reason: "no transfer found at the processor; safe to retry",
        });
        outcomes.push({
          payoutKey: payout.idempotency_key,
          result: "failed",
          detail: "not found at processor, requeued",
        });
        continue;
      }

      if (match.status === "processed") {
        await admin.rpc("record_payout_result", {
          p_idempotency_key: payout.idempotency_key,
          p_status: "PAID",
          p_transfer_ref: match.id,
        });
        outcomes.push({
          payoutKey: payout.idempotency_key,
          result: "paid",
          detail: `reconciled to transfer ${match.id}`,
        });
        continue;
      }

      if (match.status === "failed" || match.status === "reversed") {
        await admin.rpc("record_payout_result", {
          p_idempotency_key: payout.idempotency_key,
          p_status: "FAILED",
          p_failure_reason: match.error?.description ?? `transfer ${match.status} at the processor`,
        });
        outcomes.push({
          payoutKey: payout.idempotency_key,
          result: "failed",
          detail: match.error?.description ?? `transfer ${match.status}`,
        });
        continue;
      }

      // Genuinely still settling. Leave it alone.
      outcomes.push({
        payoutKey: payout.idempotency_key,
        result: "in_flight",
        detail: `transfer ${match.id} still ${match.status ?? "pending"}`,
      });
    } catch (e) {
      outcomes.push({
        payoutKey: payout.idempotency_key,
        result: "in_flight",
        detail: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  // Reconciling a payout to PAID also enqueues its email; drain best-effort.
  await flushEmailsBestEffort();
  return outcomes;
}
