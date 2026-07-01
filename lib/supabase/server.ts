import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readSupabaseConfig } from "@/config/supabase";

/**
 * The Clerk -> Supabase bridge, in action.
 *
 * Returns a Supabase client bound to the CURRENT user's verified Clerk session
 * token. Supabase validates that token against Clerk's JWKS and exposes its
 * `sub` to RLS, so every query runs as that user and the slice-3 policies apply.
 * No service-role key here — this client has exactly the caller's rights.
 *
 * We attach the token via an explicit Authorization header (fetched eagerly),
 * the most reliable way to bind a Clerk session to Supabase from a Server
 * Component across supabase-js versions.
 */
export async function createUserSupabaseClient(): Promise<SupabaseClient> {
  const { url, anonKey } = readSupabaseConfig();
  const { getToken } = await auth();
  const token = await getToken();

  return createClient(url, anonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
