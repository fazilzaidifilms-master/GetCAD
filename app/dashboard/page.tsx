import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { createUserSupabaseClient } from "@/lib/supabase/server";

// Authenticated, per-request data — never cache it.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();

  // Audited self-onboarding: creates this user's row (and a USER_CREATED audit
  // entry) on first visit; idempotent thereafter. Identity comes from the
  // verified token inside the function — nothing is trusted from the client.
  const { error: onboardError } = await supabase.rpc("ensure_self");

  // Then read AS THIS USER — RLS returns only their own row.
  const { data: me, error: meError } = await supabase
    .from("users")
    .select("id, role, status")
    .maybeSingle();
  const { count: myOrders } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true });

  const error = onboardError ?? meError;

  return (
    <main className="container max-w-2xl py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>

      <section className="mt-6 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Verified Clerk identity</p>
        <p className="font-mono text-sm">{userId}</p>
      </section>

      <section className="mt-4 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Your row in the database (via RLS)</p>
        {error ? (
          <p className="mt-1 text-sm text-red-600">Query error: {error.message}</p>
        ) : me ? (
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              role: <span className="font-mono">{me.role}</span>
            </li>
            <li>
              status: <span className="font-mono">{me.status}</span>
            </li>
            <li>
              orders you can see: <span className="font-mono">{myOrders ?? 0}</span>
            </li>
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Setting up your account…</p>
        )}
      </section>
    </main>
  );
}
