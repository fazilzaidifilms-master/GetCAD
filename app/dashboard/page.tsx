import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { markNotificationsReadAction } from "./actions";

// Authenticated, per-request data — never cache it.
export const dynamic = "force-dynamic";

interface NotificationRow {
  id: string;
  kind: string;
  summary: string;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

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
  const { data: notifData } = await supabase
    .from("notifications")
    .select("id, kind, summary, order_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const notifications = (notifData ?? []) as NotificationRow[];
  const unread = notifications.filter((n) => !n.read_at).length;

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

      <section className="mt-4 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Notifications{" "}
            {unread > 0 && (
              <span className="ml-1 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                {unread}
              </span>
            )}
          </p>
          {unread > 0 && (
            <form action={markNotificationsReadAction}>
              <Button type="submit" variant="outline" size="sm">
                Mark all read
              </Button>
            </form>
          )}
        </div>
        <ul className="mt-2 space-y-1">
          {notifications.length === 0 && (
            <li className="text-sm text-muted-foreground">Nothing yet.</li>
          )}
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                n.read_at ? "text-muted-foreground" : "bg-muted font-medium"
              }`}
            >
              <span>{n.summary}</span>
              {n.order_id && (
                <span className="ml-2 truncate font-mono text-xs text-muted-foreground">
                  {n.order_id}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
