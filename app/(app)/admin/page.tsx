import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { availableTransitions, isStaffRole, type TransitionRow } from "@/core";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  product_type: string;
  status: string;
  client_id: string;
  designer_id: string | null;
}

// Human label for what a status is waiting on (staff-facing; carries no identity).
const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Awaiting quote",
  QUOTED: "Awaiting client payment",
  PAYMENT_HELD: "Ready to assign",
  DESIGNER_SUBMITTED: "Awaiting QC intake",
  QC_REVIEW: "In QC review",
  CLIENT_PREVIEW: "With client for preview",
  APPROVED: "Ready to deliver",
  CLOSED: "Ready for payout",
  DISPUTED: "Dispute — needs resolution",
};

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const { data: meData } = await supabase.from("users").select("role").maybeSingle();
  const role: string = meData?.role ?? "CLIENT";

  if (!isStaffRole(role)) {
    return (
      <main className="container max-w-2xl py-12">
        <h1 className="text-[length:var(--fs-6)] leading-[var(--lh-6)] tracking-[var(--ls-6)] font-semibold">Staff console</h1>
        <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)] text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
          This area is for staff roles (SALES, OPS, QC, FINANCE). Your role is{" "}
          <Badge variant="muted">{role}</Badge>.
        </div>
      </main>
    );
  }

  // Staff RLS returns exactly the orders this role can currently act on.
  const [ordersRes, transitionsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, product_type, status, client_id, designer_id")
      .order("created_at", { ascending: false }),
    supabase.from("order_transitions").select("from_status, to_status, actor_role, actor_scope"),
  ]);

  if (ordersRes.error || transitionsRes.error) {
    return (
      <main className="container max-w-2xl py-12">
        <h1 className="text-[length:var(--fs-6)] leading-[var(--lh-6)] tracking-[var(--ls-6)] font-semibold">Staff console</h1>
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-destructive">
          <p className="font-medium">Couldn&apos;t load your queue</p>
          <p className="mt-1 text-destructive/90">
            {(ordersRes.error ?? transitionsRes.error)?.message} — reload the page to try again.
          </p>
        </div>
      </main>
    );
  }

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const transitions = (transitionsRes.data ?? []) as TransitionRow[];

  const byStatus = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const list = byStatus.get(o.status) ?? [];
    list.push(o);
    byStatus.set(o.status, list);
  }
  const statuses = [...byStatus.keys()].sort();
  const inQcReview = role === "QC" && (byStatus.get("QC_REVIEW")?.length ?? 0) > 0;

  return (
    <main className="container max-w-5xl py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-[length:var(--fs-6)] leading-[var(--lh-6)] tracking-[var(--ls-6)] font-semibold">Staff console</h1>
          <p className="mt-1 flex items-center gap-2 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
            <Badge variant="muted">{role}</Badge>
            <span className="tabular">
              {orders.length} order{orders.length === 1 ? "" : "s"} awaiting your action
            </span>
          </p>
        </div>
        <Link href="/orders" className="text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground hover:text-foreground">
          All orders →
        </Link>
      </div>

      {/* Recruiting/sales inboxes — OPS and SALES only, matching the DB gate on
          list_designer_applications / list_marketing_leads. */}
      {(role === "OPS" || role === "SALES") && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/applications"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] hover:bg-accent"
          >
            Designer applications →
          </Link>
          <Link
            href="/admin/leads"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] hover:bg-accent"
          >
            Contact leads →
          </Link>
        </div>
      )}

      {/* Access is OPS only, matching app.require_ops() on the functions behind
          it. SALES, QC and FINANCE are roles you can be GIVEN, and a role that
          can grant itself a promotion is not a boundary. */}
      {role === "OPS" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href="/admin/users"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] hover:bg-accent"
          >
            Access — roles and accounts →
          </Link>
        </div>
      )}

      {inQcReview && (
        <div className="mt-4 rounded-md border border-border bg-subtle px-4 py-3 text-[length:var(--fs-3)] leading-[var(--lh-3)]">
          <p className="font-medium">Independent QC review</p>
          <p className="mt-0.5 text-muted-foreground">
            Your decision here is the client&apos;s visible quality gate — recorded as
            &quot;Independent QC review: passed&quot; or &quot;revision requested&quot; on their timeline, by
            role only.
          </p>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-10)] text-center">
          <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium">Queue clear</p>
          <p className="mt-1 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
            Nothing needs a {role} action right now. New orders will appear here the moment they
            reach a state your role can act on.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {statuses.map((status) => {
            const group = byStatus.get(status) ?? [];
            return (
              <section key={status} className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]">
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span className="text-[length:var(--fs-3)] leading-[var(--lh-3)] text-muted-foreground">
                      {STATUS_LABEL[status] ?? "Awaiting action"}
                    </span>
                  </div>
                  <span className="tabular text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">{group.length}</span>
                </header>
                <ul className="divide-y divide-border">
                  {group.map((o) => {
                    const actions = availableTransitions(o.status, transitions, {
                      role,
                      isOrderClient: false,
                      isOrderDesigner: false,
                    });
                    return (
                      <li key={o.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium">{o.product_type}</p>
                          <p className="tabular truncate font-mono text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">
                            {o.id}
                          </p>
                        </div>
                        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                          {actions.map((to) => (
                            <StatusBadge key={to} status={to} className="opacity-70" />
                          ))}
                        </div>
                        <Link
                          href={`/orders/${o.id}`}
                          className="shrink-0 text-[length:var(--fs-3)] leading-[var(--lh-3)] font-medium text-primary hover:underline"
                        >
                          Act →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
