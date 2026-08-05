"use server";

import { revalidatePath } from "next/cache";

import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Change someone's role or status.
 *
 * Both run AS THE CALLER, so `app.require_ops()` inside the function is the
 * real check. There is deliberately no role test in this file: a guard in a
 * Server Action protects the action, a guard in the database protects the data,
 * and only one of those is still true when someone calls the RPC directly.
 */

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const userId = formData.get("user_id")?.toString() ?? "";
  const role = formData.get("role")?.toString() ?? "";

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
}

export async function setUserStatusAction(formData: FormData): Promise<void> {
  const userId = formData.get("user_id")?.toString() ?? "";
  const status = formData.get("status")?.toString() ?? "";

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("set_user_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
}
