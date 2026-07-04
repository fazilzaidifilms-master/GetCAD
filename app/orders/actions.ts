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
