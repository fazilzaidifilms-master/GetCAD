"use server";

import { revalidatePath } from "next/cache";

import { createUserSupabaseClient } from "@/lib/supabase/server";

export type LeadResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a contact lead handled or reopen it. Authorization (OPS/SALES) is
 * enforced by the DB function, reached through the user-scoped client so the
 * caller's verified role is what's checked.
 */
export async function setLeadStatusAction(formData: FormData): Promise<LeadResult> {
  const id = formData.get("id")?.toString() ?? "";
  const status = formData.get("status")?.toString() ?? "";
  if (!id || !status) return { ok: false, error: "Missing lead or status." };

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("set_lead_status", { p_id: id, p_status: status });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/leads");
  return { ok: true };
}
