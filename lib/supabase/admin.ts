import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readSupabaseAdminConfig } from "@/config/supabase";

/**
 * SERVER-ONLY service-role Supabase client. It bypasses RLS, so it is used only
 * for trusted operations AFTER our own authorization has been checked:
 *   - writing sanitized file bytes to the private Storage bucket (post-gate),
 *   - minting short-TTL signed download URLs once the caller's read access has
 *     been verified via the user-scoped client (which is subject to RLS).
 *
 * The `server-only` import makes the build fail if this is ever pulled into a
 * client component.
 */
export function createAdminSupabaseClient(): SupabaseClient {
  const { url, serviceRoleKey } = readSupabaseAdminConfig();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
