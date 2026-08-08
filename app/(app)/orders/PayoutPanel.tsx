"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

import { reconcilePayoutsAction, sendPayoutsAction } from "./payoutActions";

export interface PayoutStateSummary {
  owed: number;
  paid: number;
  in_flight: number;
  failed: number;
  reversed: number;
}

/**
 * FINANCE's view of an order's payouts.
 *
 * Deliberately shows OWED against SENT rather than a single "paid" flag. Those
 * two disagreeing is the condition that matters — it means a designer is owed
 * money that has not reached them — and a boolean would hide exactly that.
 */
export function PayoutPanel({
  orderId,
  currency,
  state,
}: {
  orderId: string;
  currency: string;
  state: PayoutStateSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const outstanding = state.owed - state.paid;

  function run(fn: () => Promise<{ ok: boolean; summary?: string; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage({ ok: result.ok, text: result.ok ? (result.summary ?? "Done.") : (result.error ?? "Failed.") });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-[length:var(--fs-3)] leading-[var(--lh-3)] sm:grid-cols-4">
        <div>
          <dt className="text-[length:var(--fs-2)] leading-[var(--lh-2)] uppercase tracking-wide text-muted-foreground">Owed</dt>
          <dd className="tabular mt-0.5 font-mono">{formatMoney(state.owed, currency)}</dd>
        </div>
        <div>
          <dt className="text-[length:var(--fs-2)] leading-[var(--lh-2)] uppercase tracking-wide text-muted-foreground">Paid</dt>
          <dd className="tabular mt-0.5 font-mono">{formatMoney(state.paid, currency)}</dd>
        </div>
        <div>
          <dt className="text-[length:var(--fs-2)] leading-[var(--lh-2)] uppercase tracking-wide text-muted-foreground">In flight</dt>
          <dd className="tabular mt-0.5 font-mono">{formatMoney(state.in_flight, currency)}</dd>
        </div>
        <div>
          <dt className="text-[length:var(--fs-2)] leading-[var(--lh-2)] uppercase tracking-wide text-muted-foreground">Failed</dt>
          <dd className="tabular mt-0.5 font-mono">{formatMoney(state.failed, currency)}</dd>
        </div>
      </dl>

      {state.reversed > 0 && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-destructive">
          {formatMoney(state.reversed, currency)} came back from the processor and is in escrow
          again. It can be released or refunded.
        </p>
      )}

      {outstanding > 0 && state.in_flight === 0 && (
        <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
          {formatMoney(outstanding, currency)} is owed and has not been sent.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || outstanding <= 0}
          onClick={() => {
            const fd = new FormData();
            fd.set("order_id", orderId);
            run(() => sendPayoutsAction(fd));
          }}
        >
          {pending ? "Working…" : "Send payouts"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => reconcilePayoutsAction())}
        >
          Check stuck payouts
        </Button>
      </div>

      {message && (
        <p
          className={
            message.ok
              ? "text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground"
              : "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-destructive"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
