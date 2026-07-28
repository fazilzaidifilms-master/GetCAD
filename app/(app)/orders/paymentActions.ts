"use server";

import { auth } from "@clerk/nextjs/server";

import { readRazorpayPublicKeyId } from "@/config/payments";
import { createRazorpayOrder } from "@/lib/razorpay/client";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type StartPaymentResult =
  | { ok: true; keyId: string; razorpayOrderId: string; amount: number; currency: string }
  | { ok: false; error: string };

/**
 * Begin collecting payment for a QUOTED order.
 *
 * This only OPENS a collection — it moves no money and does not touch escrow.
 * Funding happens when Razorpay's signed webhook reaches
 * /api/webhooks/razorpay, which is the only path to confirm_payment().
 *
 * Authorization deliberately happens through the USER-scoped client first: RLS
 * returns the order only if the caller may read it, so a client cannot open a
 * collection against somebody else's order. Only after that check do we use the
 * service role, which bypasses RLS.
 */
export async function startPaymentAction(formData: FormData): Promise<StartPaymentResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in." };

  const orderId = formData.get("order_id")?.toString() ?? "";
  if (!orderId) return { ok: false, error: "Missing order." };

  const supabase = await createUserSupabaseClient();
  const [{ data: order, error }, { data: me }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, client_id, status, price_total, currency")
      .eq("id", orderId)
      .maybeSingle(),
    supabase.from("users").select("role").maybeSingle(),
  ]);

  if (error || !order) return { ok: false, error: "Order not found." };

  // ROLE **and** PARTY, matching the contract the removed hold_escrow enforced
  // and that every other party-scoped action uses (raise_dispute, and the
  // CLIENT_PARTY/DESIGNER_PARTY scopes in transition_order). Owning the order
  // is not enough — you must be acting as a CLIENT.
  if (me?.role !== "CLIENT") {
    return { ok: false, error: "Only a client can pay for an order." };
  }
  if (order.client_id !== userId) {
    return { ok: false, error: "Only the client of this order can pay for it." };
  }
  if (order.status !== "QUOTED") {
    return { ok: false, error: `This order is not awaiting payment (it is ${order.status}).` };
  }
  if (!order.price_total || order.price_total <= 0) {
    return { ok: false, error: "This order has no amount to pay." };
  }

  try {
    // The amount comes from the ORDER, never from the browser.
    const rp = await createRazorpayOrder({
      amountMinor: order.price_total,
      currency: order.currency,
      orderId: order.id,
    });

    const admin = createAdminSupabaseClient();
    const { error: intentError } = await admin.rpc("open_payment_intent", {
      p_order_id: order.id,
      p_external_ref: rp.id,
    });
    if (intentError) return { ok: false, error: intentError.message };

    return {
      ok: true,
      keyId: readRazorpayPublicKeyId(),
      razorpayOrderId: rp.id,
      amount: order.price_total,
      currency: order.currency,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start payment." };
  }
}
