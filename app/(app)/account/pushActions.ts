"use server";

import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * Register or remove this device's push subscription.
 *
 * Both run AS THE USER, not with the admin client, so the database's ownership
 * rules apply: `save_push_subscription` binds the endpoint to whoever is signed
 * in right now, and `delete_push_subscription` will only remove a row that
 * belongs to the caller. Doing this with the service role would mean the app
 * layer deciding who owns a device, which is exactly the decision that has to
 * survive a shared laptop.
 */

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function savePushSubscriptionAction(input: PushSubscriptionInput): Promise<void> {
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
  });
  if (error) throw new Error(error.message);
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<void> {
  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  if (error) throw new Error(error.message);
}
