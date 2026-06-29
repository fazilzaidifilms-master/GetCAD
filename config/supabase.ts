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
