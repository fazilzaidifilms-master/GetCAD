import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { TrustLine } from "@/components/trust-line";
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

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();

  // Audited self-onboarding: creates this user's row (and a USER_CREATED audit
  // entry) on first visit; idempotent thereafter. Identity comes from the
  // verified token inside the function — nothing is trusted from the client.
  const { error: onboardError } = await supabase.rpc("ensure_self");

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

  // Payout readiness, for the roles that actually get paid. Returns display
  // fragments only — the raw table is unreadable by anyone (policies/0019).
  const payable = me?.role === "DESIGNER" || me?.role === "QC";
  const { data: payoutData } = payable
    ? await supabase.rpc("my_payout_account")
    : { data: null };
  const payoutStatus = (payoutData as { status?: string } | null)?.status ?? null;

  const notifications = (notifData ?? []) as NotificationRow[];
  const unread = notifications.filter((n) => !n.read_at).length;
  const error = onboardError ?? meError;

  return (
    <main className="container max-w-3xl py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        {me && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="muted">{me.role}</Badge>
            <Badge variant="outline">{me.status}</Badge>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your account: {error.message}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verified identity
          </p>
          <p className="tabular mt-1 truncate font-mono text-sm" title={userId}>
            {userId}
          </p>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Orders visible to you
          </p>
          <p className="tabular mt-1 font-mono text-2xl">{myOrders ?? 0}</p>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Notifications</p>
            {unread > 0 && (
              <span className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                {unread}
              </span>
            )}
          </div>
          {unread > 0 && (
            <form action={markNotificationsReadAction}>
              <Button type="submit" variant="outline" size="sm">
                Mark all read
              </Button>
            </form>
          )}
        </div>
        <ul className="divide-y divide-border">
          {notifications.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No notifications yet. You&apos;ll be told when an order changes state or a message
              arrives.
            </li>
          )}
          {notifications.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {!n.read_at && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              )}
              <span className={n.read_at ? "text-muted-foreground" : "font-medium"}>
                {n.summary}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-3">
                {n.order_id && (
                  <span className="tabular hidden font-mono text-xs text-muted-foreground sm:inline">
                    {n.order_id.slice(0, 10)}…
                  </span>
                )}
                <span className="tabular text-xs text-muted-foreground">
                  {timeAgo(n.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Only the roles that receive escrow releases. A payout account is now a
          hard precondition for release_escrow (0023), so an unbanked designer
          would otherwise discover the problem only when their money didn't
          arrive. */}
      {payable && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Payout account</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {payoutStatus === "VERIFIED"
                  ? "Verified. Your earnings will be sent here."
                  : payoutStatus === "PENDING_VERIFICATION"
                    ? "Submitted — we're confirming it with our payment processor."
                    : payoutStatus === "REJECTED"
                      ? "We couldn't verify these details. Please update them."
                      : "Add your bank details so we can pay you when an order closes."}
              </p>
            </div>
            <Link
              href="/settings/payouts"
              className={buttonVariants({
                variant: payoutStatus === "VERIFIED" ? "outline" : "default",
                size: "sm",
              })}
            >
              {payoutStatus ? "Manage" : "Add payout account"}
            </Link>
          </div>
        </section>
      )}

      <TrustLine className="mt-6" />
    </main>
  );
}
