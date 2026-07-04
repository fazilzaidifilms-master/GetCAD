// Public Supabase client config, read where needed.
//
// The project URL and the ANON (publishable) key are PUBLIC by design — they
// ship to the browser, and data is protected by RLS, not by hiding them. The
// service-role key is a SECRET and lives only in server-side code paths; it is
// never read here and must never be NEXT_PUBLIC_*.

export interface SupabaseClientConfig {
  url: string;
  anonKey: string;
}

export function readSupabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClientConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.");
  return { url, anonKey };
}

/** The private bucket order files live in. Never public. */
export const ORDER_FILES_BUCKET = "order-files";

/** Signed download URLs are short-lived. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface SupabaseAdminConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * SERVER-ONLY. The service-role key bypasses RLS, so this must only ever be
 * imported from server code (server actions / route handlers) and never behind
 * a NEXT_PUBLIC_* variable.
 */
export function readSupabaseAdminConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseAdminConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only secret).");
  return { url, serviceRoleKey };
}
