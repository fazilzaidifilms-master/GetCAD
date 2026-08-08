import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
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
        <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
          Dashboard
        </h1>
        {me && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="muted">{me.role}</Badge>
            <Badge variant="outline">{me.status}</Badge>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--r-md)] border border-destructive/30 bg-destructive/5 px-[var(--s-4)] py-[var(--s-3)] text-[length:var(--fs-3)] text-destructive">
          Couldn&apos;t load your account: {error.message}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-[length:var(--fs-1)] font-medium uppercase tracking-[var(--ls-1)] text-muted-foreground">
              Verified identity
            </p>
            <p
              className="tabular mt-1 truncate font-mono text-[length:var(--fs-2)]"
              title={userId}
            >
              {userId}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[length:var(--fs-1)] font-medium uppercase tracking-[var(--ls-1)] text-muted-foreground">
              Orders visible to you
            </p>
            <p className="tabular mt-1 font-mono text-[length:var(--fs-6)] leading-[var(--lh-6)]">
              {myOrders ?? 0}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Notifications</CardTitle>
            {unread > 0 && (
              <span className="tabular inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--r-full)] bg-primary px-2 text-[length:var(--fs-1)] font-semibold text-primary-foreground">
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
        </CardHeader>
        <ul className="divide-y divide-border">
          {notifications.length === 0 && (
            <li className="px-[var(--s-5)] py-[var(--s-8)] text-center text-[length:var(--fs-3)] text-muted-foreground">
              No notifications yet. You&apos;ll be told when an order changes state or a message
              arrives.
            </li>
          )}
          {notifications.map((n) => (
            <li
              key={n.id}
              className="flex min-h-[var(--ctl)] items-center gap-3 px-[var(--s-5)] py-[var(--s-3)] text-[length:var(--fs-l)] leading-[var(--lh-l)]"
            >
              {!n.read_at && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              )}
              <span className={n.read_at ? "text-muted-foreground" : "font-medium"}>
                {n.summary}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-3">
                {n.order_id && (
                  <span className="tabular hidden font-mono text-[length:var(--fs-2)] text-muted-foreground sm:inline">
                    {n.order_id.slice(0, 10)}…
                  </span>
                )}
                <span className="tabular text-[length:var(--fs-2)] text-muted-foreground">
                  {timeAgo(n.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Only the roles that receive escrow releases. A payout account is now a
          hard precondition for release_escrow (0023), so an unbanked designer
          would otherwise discover the problem only when their money didn't
          arrive. */}
      {payable && (
        <Card className="mt-4">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[length:var(--fs-4)] font-semibold">Payout account</p>
              <p className="mt-1 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
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
          </CardBody>
        </Card>
      )}

      <TrustLine className="mt-6" />
    </main>
  );
}
