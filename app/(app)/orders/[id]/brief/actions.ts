"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { generateId } from "@/core";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Start a new order and go straight to its brief.
 *
 * The order row has to exist before the spec can reference it, so "New order"
 * creates a DRAFT immediately rather than holding a half-filled brief in
 * browser memory until the end. That is also what makes the wizard resumable:
 * a real order id means a real URL, so closing the tab on step 4 of a long form
 * loses nothing.
 */
export async function startBriefAction(): Promise<void> {
  const supabase = await createUserSupabaseClient();

  // orders.client_id has a foreign key to users.id, and a person who signed up
  // and pressed "New order" before visiting any screen that calls this has no
  // row yet. The failure is a raw foreign-key violation on their very first
  // action in the product. Every other authenticated screen already does this;
  // this path was the one that did not.
  const ensured = await supabase.rpc("ensure_self");
  if (ensured.error) throw new Error(ensured.error.message);

  const id = generateId();
  const { error } = await supabase.rpc("create_order", {
    p_id: id,
    p_product_type: "CAD_MODEL",
    p_currency: "INR",
  });
  if (error) throw new Error(error.message);
  redirect(`/orders/${id}/brief`);
}

/** Numeric form fields arrive as strings or empty; empty means "not answered". */
function num(form: FormData, key: string): number | null {
  const raw = form.get(key)?.toString().trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function str(form: FormData, key: string): string | null {
  return form.get(key)?.toString().trim() || null;
}

/**
 * Save the brief.
 *
 * Everything meaningful is checked in the database — ownership, the quote
 * freeze, and whether the answers contradict each other. This does no
 * validation of its own beyond turning form strings into the right types,
 * deliberately: a second set of rules here is a second set to keep in step.
 */
export async function saveBriefAction(formData: FormData): Promise<void> {
  const orderId = formData.get("order_id")?.toString() ?? "";
  const hasCentre = formData.get("has_centre_stone") === "on";

  const supabase = await createUserSupabaseClient();

  const { error } = await supabase.rpc("upsert_order_spec", {
    p_order_id: orderId,
    p_reference_name: str(formData, "reference_name") ?? "",
    p_product: str(formData, "product") ?? "RING",
    p_metal: str(formData, "metal") ?? "YELLOW",
    p_karatage: str(formData, "karatage") ?? "",
    p_purpose: str(formData, "purpose") ?? "CASTING",
    p_format: str(formData, "format") ?? "BOTH",
    p_finish: str(formData, "finish") ?? "HIGH_POLISH",
    p_has_centre_stone: hasCentre,
    // Cleared wholesale when there is no centre stone. Sending stale
    // dimensions would be refused by order_specs_centre_coherent anyway, but
    // the point is not to rely on being caught.
    p_centre_shape: hasCentre ? str(formData, "centre_shape") : null,
    p_centre_length_um: hasCentre ? num(formData, "centre_length_um") : null,
    p_centre_width_um: hasCentre ? num(formData, "centre_width_um") : null,
    p_centre_depth_um: hasCentre ? num(formData, "centre_depth_um") : null,
    p_centre_carat_mct: hasCentre ? num(formData, "centre_carat_mct") : null,
    p_centre_certified: hasCentre && formData.get("centre_certified") === "on",
    p_centre_quantity: hasCentre ? (num(formData, "centre_quantity") ?? 1) : 0,
    p_centre_setting: hasCentre ? str(formData, "centre_setting") : null,
    p_stones_supplied_by: str(formData, "stones_supplied_by") ?? "NONE",
    p_component_count: num(formData, "component_count") ?? 1,
    p_render_views: num(formData, "render_views") ?? 0,
    p_priority: str(formData, "priority") ?? "STANDARD",
    p_based_on_order_id: str(formData, "based_on_order_id"),
    p_change_summary: str(formData, "change_summary"),
    p_notes: str(formData, "notes"),
  });
  if (error) throw new Error(error.message);

  // Accent rows travel as four parallel arrays, which the database refuses if
  // they disagree in length.
  const shapes = formData.getAll("accent_shape").map(String).filter(Boolean);
  if (shapes.length > 0) {
    const widths = formData.getAll("accent_width_um").map((v) => Math.round(Number(v) || 0));
    const quantities = formData.getAll("accent_quantity").map((v) => Math.round(Number(v) || 0));
    const settings = formData.getAll("accent_setting").map(String);
    const { error: accentError } = await supabase.rpc("set_order_accents", {
      p_order_id: orderId,
      p_shapes: shapes,
      p_widths_um: widths,
      p_quantities: quantities,
      p_settings: settings,
    });
    if (accentError) throw new Error(accentError.message);
  } else {
    const { error: clearError } = await supabase.rpc("set_order_accents", {
      p_order_id: orderId,
      p_shapes: [],
      p_widths_um: [],
      p_quantities: [],
      p_settings: [],
    });
    if (clearError) throw new Error(clearError.message);
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/brief`);
}
