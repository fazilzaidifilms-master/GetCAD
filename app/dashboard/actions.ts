"use server";

import { revalidatePath } from "next/cache";

import { createUserSupabaseClient } from "@/lib/supabase/server";

// Mark the caller's notifications read (all unread). The DB scopes to the caller.
export async function markNotificationsReadAction(): Promise<void> {
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_id: null });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}
