import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { createUserSupabaseClient } from "@/lib/supabase/server";

// Authenticated, per-request data — never cache it.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Query Supabase AS THIS USER. The slice-3 RLS policies decide what comes
  // back — this is the Clerk -> Supabase bridge working end to end.
  const supabase = await createUserSupabaseClient();
  const { data: me, error: meError } = await supabase
    .from("users")
    .select("id, role, status")
    .maybeSingle();
  const { count: myOrders } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true });

  return (
    <main className="container max-w-2xl py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>

      <section className="mt-6 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Verified Clerk identity</p>
        <p className="font-mono text-sm">{userId}</p>
      </section>

      <section className="mt-4 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Your row in the database (via RLS)</p>
        {meError ? (
          // Surface real errors instead of silently looking like "no row".
          <p className="mt-1 text-sm text-red-600">Query error: {meError.message}</p>
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
          <div className="mt-1 text-sm">
            <p>
              No account row yet. Onboarding (which creates this row, audited) is a
              later slice. To see the bridge return data now, seed your own row in
              the Supabase SQL editor:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs">
              {`insert into users (id, role, status)\nvalues ('${userId}', 'CLIENT', 'ACTIVE');`}
            </pre>
            <p className="mt-2 text-muted-foreground">
              Then refresh — RLS will return exactly this row and nothing else.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
