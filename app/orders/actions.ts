"use server";

import { revalidatePath } from "next/cache";

import { generateId } from "@/core";
import { createUserSupabaseClient } from "@/lib/supabase/server";

// Create a DRAFT order for the current user. The DB function is the source of
// truth (audited); this action just calls it as the logged-in user.
export async function createOrderAction(formData: FormData): Promise<void> {
  const productType = formData.get("product_type")?.toString().trim() || "CAD_MODEL";
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("create_order", {
    p_id: generateId(),
    p_product_type: productType,
    p_currency: "USD",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

// Move an order to a new status. The DB rejects anything illegal / out-of-role.
export async function transitionAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const toStatus = formData.get("to_status")?.toString() ?? "";
  // ASSIGNED needs the designer's OPAQUE id (no identity is read here).
  const designerId = formData.get("designer_id")?.toString().trim();
  const payload = designerId ? { designer_id: designerId } : {};

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_new_status: toStatus,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

// --- Money layer (escrow). Each just calls the DB function AS THE USER; the DB
// enforces role, state, and money conservation. ---

function intField(formData: FormData, name: string): number {
  const raw = formData.get(name)?.toString().trim() ?? "";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative whole number`);
  return n;
}

// SALES sets the quote. The UI collects total + designer + qc; platform is the
// remainder, so the split always sums to the total (the DB re-checks).
export async function quoteAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const total = intField(formData, "price_total");
  const designer = intField(formData, "designer_payout");
  const qc = intField(formData, "qc_payout");
  const platform = total - designer - qc;
  if (platform < 0) throw new Error("designer + qc payouts exceed the total");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("quote_order", {
    p_order_id: orderId,
    p_price_total: total,
    p_designer_payout: designer,
    p_qc_payout: qc,
    p_platform_commission: platform,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

async function escrowRpc(fn: "hold_escrow" | "release_escrow" | "refund_escrow", orderId: string) {
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc(fn, { p_order_id: orderId });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

export async function holdEscrowAction(formData: FormData): Promise<void> {
  await escrowRpc("hold_escrow", formData.get("order_id")?.toString() ?? "");
}
export async function releaseEscrowAction(formData: FormData): Promise<void> {
  await escrowRpc("release_escrow", formData.get("order_id")?.toString() ?? "");
}
export async function refundEscrowAction(formData: FormData): Promise<void> {
  await escrowRpc("refund_escrow", formData.get("order_id")?.toString() ?? "");
}

// Post a message to an order's double-blind thread. The DB derives the party
// label and checks the caller is the client / assigned designer.
export async function postMessageAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const body = formData.get("body")?.toString() ?? "";
  if (body.trim().length === 0) throw new Error("message is empty");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("post_message", { p_order_id: orderId, p_body: body });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

// --- Disputes. The DB enforces role/state and records the reason/outcome. ---

export async function raiseDisputeAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const reason = formData.get("reason")?.toString() ?? "";
  if (reason.trim().length === 0) throw new Error("a dispute reason is required");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("raise_dispute", { p_order_id: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

export async function resolveDisputeAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const resolution = formData.get("resolution")?.toString() ?? "";
  const notes = formData.get("notes")?.toString() || null;

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("resolve_dispute", {
    p_order_id: orderId,
    p_resolution: resolution,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}
