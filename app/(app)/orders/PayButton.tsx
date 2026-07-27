"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

import { startPaymentAction } from "./paymentActions";

/**
 * Opens Razorpay Checkout for a QUOTED order.
 *
 * The browser's job ends at "checkout closed". It never tells the server a
 * payment succeeded — the signed webhook does that, so a client cannot fund
 * their own order by tampering with this component. On close we simply refresh
 * and let the order's real status speak.
 */
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("checkout failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("checkout failed to load"));
    document.body.appendChild(script);
  });
}

export function PayButton({
  orderId,
  amount,
  currency,
}: {
  orderId: string;
  amount: number;
  currency: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("order_id", orderId);
      const result = await startPaymentAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      await loadCheckout();
      if (!window.Razorpay) {
        setError("Checkout could not be loaded. Please try again.");
        return;
      }

      const checkout = new window.Razorpay({
        key: result.keyId,
        order_id: result.razorpayOrderId,
        amount: result.amount,
        currency: result.currency,
        name: "The CAD Pillar",
        description: `Order ${orderId}`,
        // Payment confirmation arrives by webhook, so all we do here is stop
        // showing the button and tell the user what to expect.
        handler: () => setAwaitingConfirmation(true),
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.");
    } finally {
      setBusy(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="rounded-md border border-border bg-subtle px-3 py-2 text-sm">
        <p className="font-medium">Payment submitted</p>
        <p className="mt-1 text-muted-foreground">
          We&apos;re confirming it with the payment provider. This page will show{" "}
          <span className="font-medium">Payment held</span> once escrow is funded — usually within
          a few seconds. Refresh if it hasn&apos;t updated.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Button onClick={pay} disabled={busy}>
        {busy ? "Opening checkout…" : `Pay ${formatMoney(amount, currency)}`}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
