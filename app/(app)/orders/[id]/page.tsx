import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { escrowSign, type TransitionRow } from "@/core";
import { ErrorPanel } from "@/components/error-panel";
import { StatusBadge } from "@/components/status-badge";
import { TrustLine } from "@/components/trust-line";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import { OrderDetail } from "../OrderDetail";
import type { PayoutStateSummary } from "../PayoutPanel";
import type { DisputeRow, LedgerRow, MessageRow, OrderRow, VersionRow } from "../types";

/**
 * One order, on its own route.
 *
 * This used to be the same page as the list, switched by `?focus=<id>`. That
 * worked on a desktop and fails at everything a phone app has to do:
 *
 *   - the back button returned to the list only by accident of history,
 *   - a link from a notification or an email could not deep-link to an order,
 *   - and there was nowhere for a push notification to eventually point.
 *
 * A real route fixes all three at once, which is why it comes before any of the
 * screens that depend on it.
 *
 * The queries here are scoped to THIS order rather than fetching everything and
 * filtering in memory, which is what the combined page had to do. On a phone,
 * over a slow connection, that difference is the whole experience.
 */
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self");

  const [meRes, orderRes, transitionsRes, versionsRes, ledgerRes, messagesRes, disputesRes] =
    await Promise.all([
      supabase.from("users").select("role").maybeSingle(),
      // RLS decides whether this row is visible at all. A `null` here is the
      // same answer as "no such order" on purpose — the existence of an order
      // is itself something a stranger should not be able to probe for.
      supabase
        .from("orders")
        .select(
          "id, product_type, status, client_id, designer_id, currency, price_total, designer_payout, qc_payout, platform_commission",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("order_transitions").select("from_status, to_status, actor_role, actor_scope"),
      supabase
        .from("file_versions")
        .select("id, order_id, version_no, content_type, size_bytes, kind, uploaded_by")
        .eq("order_id", id)
        .order("version_no", { ascending: false }),
      supabase.from("escrow_ledger").select("order_id, kind, amount").eq("order_id", id),
      supabase
        .from("messages")
        .select("id, order_id, sender_id, sender_party, body, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("disputes")
        .select("id, order_id, reason, status, resolution, resolution_notes")
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const queryError =
    meRes.error ??
    orderRes.error ??
    transitionsRes.error ??
    versionsRes.error ??
    ledgerRes.error ??
    messagesRes.error ??
    disputesRes.error;

  if (queryError) {
    return (
      <main className="container max-w-3xl py-8">
        <BackLink />
        <ErrorPanel
          title="Couldn't load this order"
          message={`${queryError.message} — reload the page to try again.`}
          className="mt-4"
        />
      </main>
    );
  }

  const role: string = meRes.data?.role ?? "CLIENT";
  const order = (orderRes.data ?? null) as OrderRow | null;

  if (!order) {
    return (
      <main className="container max-w-3xl py-8">
        <BackLink />
        <div className="mt-6 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-10)] text-center">
          <p className="text-sm font-medium">Order not available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This order isn&apos;t visible to your role, or the reference is wrong.
          </p>
        </div>
      </main>
    );
  }

  const transitions = (transitionsRes.data ?? []) as TransitionRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const ledger = (ledgerRes.data ?? []) as LedgerRow[];
  const messages = (messagesRes.data ?? []) as MessageRow[];
  const disputes = (disputesRes.data ?? []) as DisputeRow[];

  const held = ledger.reduce((net, l) => net + escrowSign(l.kind) * l.amount, 0);

  const timelineRes = await supabase.rpc("order_timeline", { p_order_id: order.id });

  // Payout execution state is service-role only (0024): the rows carry
  // processor references no browser session may read. FINANCE is the only role
  // that acts on them, so it is the only role we fetch them for.
  let payoutState: PayoutStateSummary | null = null;
  if (role === "FINANCE") {
    const { data } = await createAdminSupabaseClient().rpc("payout_state", {
      p_order_id: order.id,
    });
    payoutState = (data as PayoutStateSummary | null) ?? null;
  }

  return (
    <main className="container max-w-3xl py-8">
      <BackLink />

      <div className="mt-4 flex items-center justify-between gap-4">
        <h1 className="text-[length:var(--fs-5)] font-semibold leading-[var(--lh-5)] tracking-[var(--ls-5)]">
          {order.product_type}
        </h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="tabular mt-0.5 font-mono text-xs text-muted-foreground">{order.id}</p>

      {/* The brief is a route, not a panel: it is long, and it must be
          resumable and linkable. */}
      <Link
        href={`/orders/${order.id}/brief`}
        className="mt-4 flex min-h-[var(--ctl)] items-center justify-between rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] px-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent"
      >
        <span className="text-[length:var(--fs-4)] font-medium">The brief</span>
        <span className="text-muted-foreground" aria-hidden>
          →
        </span>
      </Link>

      <div className="mt-6">
        <OrderDetail
          order={order}
          role={role}
          userId={userId}
          transitions={transitions}
          versions={versions}
          messages={messages}
          openDispute={disputes.find((d) => d.status === "OPEN")}
          held={held}
          payoutState={payoutState}
          timelineRows={timelineRes.data ?? []}
          timelineError={timelineRes.error?.message ?? null}
        />
      </div>

      <TrustLine className="mt-6" />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/orders"
      className="inline-flex min-h-[var(--ctl)] items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      ← All orders
    </Link>
  );
}
