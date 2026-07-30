"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { executePayouts, reconcilePayouts } from "@/lib/payouts/execute";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type PayoutActionResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

/**
 * Authorization for every action in this file.
 *
 * Sending money is FINANCE's job and nobody else's — the same role
 * release_escrow requires. Checked through the USER-scoped client, because the
 * work itself runs as service_role, which bypasses RLS entirely. Getting this
 * order wrong is how a designer ends up able to trigger their own payout.
 */
async function requireFinance(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in." };

  const supabase = await createUserSupabaseClient();
  const { data: me } = await supabase.from("users").select("role, status").maybeSingle();

  if (me?.role !== "FINANCE") return { ok: false, error: "Only finance can send payouts." };
  if (me.status !== "ACTIVE") return { ok: false, error: "Your account is not active." };
  return { ok: true };
}

/**
 * Turn an order's released obligations into transfers, and send them.
 *
 * Two steps, deliberately in one action: opening instructions without sending
 * them leaves money sitting in a queue nobody is watching, and both steps are
 * individually idempotent, so re-running after a partial failure is safe.
 */
export async function sendPayoutsAction(formData: FormData): Promise<PayoutActionResult> {
  const gate = await requireFinance();
  if (!gate.ok) return gate;

  const orderId = formData.get("order_id")?.toString() ?? "";
  if (!orderId) return { ok: false, error: "Missing order." };

  const admin = createAdminSupabaseClient();
  const { data: opened, error } = await admin.rpc("open_payouts_for_order", {
    p_order_id: orderId,
  });
  if (error) return { ok: false, error: error.message };

  const created = (opened as { created?: number } | null)?.created ?? 0;

  try {
    const outcomes = await executePayouts(20);
    const mine = outcomes.length;
    const paid = outcomes.filter((o) => o.result === "paid").length;
    const inFlight = outcomes.filter((o) => o.result === "in_flight").length;
    const failed = outcomes.filter((o) => o.result === "failed" || o.result === "skipped").length;

    revalidatePath(`/orders/${orderId}`);
    return {
      ok: true,
      summary:
        mine === 0
          ? created === 0
            ? "Nothing to send — these payouts were already handled."
            : `${created} payout(s) opened; none were ready to send.`
          : `${paid} paid, ${inFlight} awaiting settlement, ${failed} failed.`,
    };
  } catch (e) {
    // The instructions exist even if sending them fell over, so they are not
    // lost — the queue will pick them up on the next run.
    revalidatePath(`/orders/${orderId}`);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not send payouts.",
    };
  }
}

/**
 * Resolve payouts stuck in flight by asking the processor what happened.
 *
 * Global rather than order-scoped on purpose: a stuck payout is an operational
 * condition, and the useful question is "is anything stranded anywhere?", not
 * "is anything stranded on this one order I happen to be looking at".
 */
export async function reconcilePayoutsAction(): Promise<PayoutActionResult> {
  const gate = await requireFinance();
  if (!gate.ok) return gate;

  try {
    const outcomes = await reconcilePayouts(15);
    if (outcomes.length === 0) {
      return { ok: true, summary: "Nothing is stuck — no payouts have been in flight long enough." };
    }
    const paid = outcomes.filter((o) => o.result === "paid").length;
    const requeued = outcomes.filter((o) => o.result === "failed").length;
    const stillMoving = outcomes.filter((o) => o.result === "in_flight").length;

    revalidatePath("/orders");
    return {
      ok: true,
      summary: `${outcomes.length} checked — ${paid} confirmed paid, ${requeued} requeued, ${stillMoving} still settling.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reconcile payouts." };
  }
}
