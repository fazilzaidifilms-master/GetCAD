import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { type TransitionRow } from "@/core";
import { StatusBadge } from "@/components/status-badge";
import { TrustLine } from "@/components/trust-line";
import { Button } from "@/components/ui/button";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";

import { createOrderAction } from "./actions";
import { OrderDetail } from "./OrderDetail";
import type { DisputeRow, LedgerRow, MessageRow, OrderRow, VersionRow } from "./types";

export const dynamic = "force-dynamic";

const inputCls =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const focus = (await searchParams).focus;

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const [meRes, ordersRes, transitionsRes, versionsRes, ledgerRes, messagesRes, disputesRes] =
    await Promise.all([
      supabase.from("users").select("role").maybeSingle(),
      supabase
        .from("orders")
        .select(
          "id, product_type, status, client_id, designer_id, currency, price_total, designer_payout, qc_payout, platform_commission",
        )
        .order("created_at", { ascending: false }),
      supabase.from("order_transitions").select("from_status, to_status, actor_role, actor_scope"),
      supabase
        .from("file_versions")
        .select("id, order_id, version_no, content_type, size_bytes")
        .order("version_no", { ascending: false }),
      supabase.from("escrow_ledger").select("order_id, kind, amount"),
      supabase
        .from("messages")
        .select("id, order_id, sender_id, sender_party, body, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("disputes")
        .select("id, order_id, reason, status, resolution, resolution_notes")
        .order("created_at", { ascending: false }),
    ]);

  const role: string = meRes.data?.role ?? "CLIENT";
  const allOrders = (ordersRes.data ?? []) as OrderRow[];
  const transitions = (transitionsRes.data ?? []) as TransitionRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const ledger = (ledgerRes.data ?? []) as LedgerRow[];
  const messages = (messagesRes.data ?? []) as MessageRow[];
  const disputes = (disputesRes.data ?? []) as DisputeRow[];

  const heldFor = (orderId: string): number =>
    ledger
      .filter((l) => l.order_id === orderId)
      .reduce((net, l) => net + (l.kind === "HOLD" ? l.amount : -l.amount), 0);

  // --- Detail view ---------------------------------------------------------
  if (focus) {
    const order = allOrders.find((o) => o.id === focus);
    return (
      <main className="container max-w-3xl py-8">
        <Link
          href="/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← All orders
        </Link>
        {!order ? (
          <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm font-medium">Order not available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This order isn&apos;t visible to your role, or the reference is wrong.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-4">
              <h1 className="text-lg font-semibold tracking-tight">{order.product_type}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="tabular mt-0.5 font-mono text-xs text-muted-foreground">{order.id}</p>

            <div className="mt-6">
              <OrderDetail
                order={order}
                role={role}
                userId={userId}
                transitions={transitions}
                versions={versions.filter((v) => v.order_id === order.id)}
                messages={messages.filter((m) => m.order_id === order.id)}
                openDispute={disputes.find((d) => d.order_id === order.id && d.status === "OPEN")}
                held={heldFor(order.id)}
              />
            </div>

            <TrustLine className="mt-6" />
          </>
        )}
      </main>
    );
  }

  // --- List view -----------------------------------------------------------
  return (
    <main className="container max-w-4xl py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
        <span className="tabular text-sm text-muted-foreground">
          {allOrders.length} order{allOrders.length === 1 ? "" : "s"}
        </span>
      </div>

      <form action={createOrderAction} className="mt-4 flex gap-2">
        <input
          name="product_type"
          defaultValue="CAD_MODEL"
          aria-label="Product type"
          className={`${inputCls} flex-1`}
        />
        <Button type="submit">New order</Button>
      </form>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
        {allOrders.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium">No orders yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create your first order above.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {allOrders.map((o) => {
              const held = heldFor(o.id);
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders?focus=${o.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <StatusBadge status={o.status} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{o.product_type}</p>
                      <p className="tabular truncate font-mono text-xs text-muted-foreground">
                        {o.id}
                      </p>
                    </div>
                    <div className="tabular shrink-0 text-right font-mono text-sm">
                      {o.price_total > 0 ? (
                        <>
                          <p>{formatMoney(o.price_total, o.currency)}</p>
                          {held > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {formatMoney(held, o.currency)} held
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    <span className="shrink-0 text-muted-foreground" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TrustLine className="mt-6" />
    </main>
  );
}
