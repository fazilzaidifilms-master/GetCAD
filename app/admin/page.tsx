import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { availableTransitions, isStaffRole, type TransitionRow } from "@/core";
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
        <h1 className="text-2xl font-semibold tracking-tight">Staff console</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          This area is for staff roles (SALES, OPS, QC, FINANCE). Your role is{" "}
          <span className="font-mono">{role}</span>.
        </p>
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

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const transitions = (transitionsRes.data ?? []) as TransitionRow[];

  // Group by status.
  const byStatus = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const list = byStatus.get(o.status) ?? [];
    list.push(o);
    byStatus.set(o.status, list);
  }
  const statuses = [...byStatus.keys()].sort();

  return (
    <main className="container max-w-2xl py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Staff console</h1>
        <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
          Orders →
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Role <span className="font-mono">{role}</span> · {orders.length} order
        {orders.length === 1 ? "" : "s"} awaiting your action
      </p>

      {orders.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Your queue is clear — nothing needs your action right now.
        </p>
      )}

      <div className="mt-6 space-y-5">
        {statuses.map((status) => {
          const group = byStatus.get(status) ?? [];
          return (
            <section key={status}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">
                  {STATUS_LABEL[status] ?? status}{" "}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {status}
                  </span>
                </h2>
                <span className="text-xs text-muted-foreground">{group.length}</span>
              </div>
              <ul className="mt-2 space-y-2">
                {group.map((o) => {
                  const actions = availableTransitions(o.status, transitions, {
                    role,
                    isOrderClient: false,
                    isOrderDesigner: false,
                  });
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-muted-foreground">{o.id}</p>
                        <p className="text-sm">{o.product_type}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {actions.map((to) => (
                          <span
                            key={to}
                            className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {to}
                          </span>
                        ))}
                        <Link
                          href="/orders"
                          className="text-xs font-medium underline hover:text-foreground"
                        >
                          Act →
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
