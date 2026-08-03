import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { escrowSign } from "@/core";
import { Money, StatusBadge } from "@/components/domain";
import { ErrorPanel } from "@/components/error-panel";
import { TrustLine } from "@/components/trust-line";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { createOrderAction } from "./actions";
import type { LedgerRow, OrderRow } from "./types";

/**
 * The list of orders.
 *
 * Detail now lives at `/orders/[id]`. `?focus=<id>` is still honoured — as a
 * redirect, not a second rendering path. Links outlive the code that made them:
 * they sit in browser histories, in emails already sent, and eventually in push
 * notification payloads. Silently 404ing them is a bug that only ever shows up
 * for someone else.
 */
export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const focus = (await searchParams).focus;
  if (focus) redirect(`/orders/${encodeURIComponent(focus)}`);

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const [ordersRes, ledgerRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, product_type, status, currency, price_total")
      .order("created_at", { ascending: false }),
    supabase.from("escrow_ledger").select("order_id, kind, amount"),
  ]);

  const queryError = ordersRes.error ?? ledgerRes.error;
  if (queryError) {
    return (
      <main className="container max-w-4xl py-8">
        <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
          Orders
        </h1>
        <ErrorPanel
          title="Couldn't load your orders"
          message={`${queryError.message} — reload the page to try again.`}
          className="mt-4"
        />
      </main>
    );
  }

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const ledger = (ledgerRes.data ?? []) as LedgerRow[];

  const heldFor = (orderId: string): number =>
    ledger
      .filter((l) => l.order_id === orderId)
      .reduce((net, l) => net + escrowSign(l.kind) * l.amount, 0);

  return (
    <main className="container max-w-4xl py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[length:var(--fs-6)] font-semibold leading-[var(--lh-6)] tracking-[var(--ls-6)]">
          Orders
        </h1>
        <span className="tabular text-sm text-muted-foreground">
          {orders.length} order{orders.length === 1 ? "" : "s"}
        </span>
      </div>

      <form action={createOrderAction} className="mt-4 flex gap-2">
        <Input
          name="product_type"
          defaultValue="CAD_MODEL"
          aria-label="Product type"
          className="min-h-[var(--ctl)] flex-1"
        />
        <Button type="submit" className="min-h-[var(--ctl)]">
          New order
        </Button>
      </form>

      <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-border bg-card">
        {orders.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium">No orders yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create your first order above.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((o) => {
              const held = heldFor(o.id);
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="flex min-h-[var(--ctl)] items-center gap-4 px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:bg-accent"
                  >
                    <StatusBadge status={o.status} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[length:var(--fs-l)] font-medium leading-[var(--lh-l)]">
                        {o.product_type}
                      </p>
                      <p className="tabular truncate font-mono text-[length:var(--fs-2)] text-muted-foreground">
                        {o.id}
                      </p>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[length:var(--fs-3)]">
                      {o.price_total > 0 ? (
                        <>
                          <Money minor={o.price_total} currency={o.currency} className="block" />
                          {held > 0 && (
                            <span className="block text-[length:var(--fs-2)] text-muted-foreground">
                              <Money minor={held} currency={o.currency} /> held
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[length:var(--fs-2)] text-muted-foreground">—</span>
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
