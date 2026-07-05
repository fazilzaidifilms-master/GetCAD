import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { availableTransitions, type TransitionRow } from "@/core";
import { Button } from "@/components/ui/button";
import { createUserSupabaseClient } from "@/lib/supabase/server";

import {
  createOrderAction,
  transitionAction,
  quoteAction,
  holdEscrowAction,
  releaseEscrowAction,
  refundEscrowAction,
  postMessageAction,
  raiseDisputeAction,
  resolveDisputeAction,
} from "./actions";
import { uploadFileAction } from "./fileActions";

export const dynamic = "force-dynamic";

// Money-bearing + dispute statuses are driven by dedicated functions, not the
// generic transition buttons — transition_order refuses them.
const HIDDEN_TARGETS = new Set([
  "QUOTED",
  "PAYMENT_HELD",
  "PAYOUT_RELEASED",
  "REFUNDED",
  "DISPUTED",
]);

interface OrderRow {
  id: string;
  product_type: string;
  status: string;
  client_id: string;
  designer_id: string | null;
  currency: string;
  price_total: number;
  designer_payout: number;
  qc_payout: number;
  platform_commission: number;
}

interface VersionRow {
  id: string;
  order_id: string;
  version_no: number;
  content_type: string;
  size_bytes: number;
}

interface LedgerRow {
  order_id: string;
  kind: "HOLD" | "RELEASE" | "REFUND";
  amount: number;
}

interface MessageRow {
  id: string;
  order_id: string;
  sender_id: string; // opaque; only used to detect "You" — never displayed
  sender_party: "CLIENT" | "DESIGNER";
  body: string;
  created_at: string;
}

interface DisputeRow {
  id: string;
  order_id: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolution: "REWORK" | "REFUND" | null;
  resolution_notes: string | null;
}

function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = await createUserSupabaseClient();
  await supabase.rpc("ensure_self"); // ensure the caller has a users row

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
  const orders = (ordersRes.data ?? []) as OrderRow[];
  const transitions = (transitionsRes.data ?? []) as TransitionRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const ledger = (ledgerRes.data ?? []) as LedgerRow[];
  const messages = (messagesRes.data ?? []) as MessageRow[];
  const disputes = (disputesRes.data ?? []) as DisputeRow[];

  const heldFor = (orderId: string): number =>
    ledger
      .filter((l) => l.order_id === orderId)
      .reduce((net, l) => net + (l.kind === "HOLD" ? l.amount : -l.amount), 0);

  return (
    <main className="container max-w-2xl py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
      </div>

      <form action={createOrderAction} className="mt-6 flex gap-2">
        <input
          name="product_type"
          defaultValue="CAD_MODEL"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          aria-label="Product type"
        />
        <Button type="submit">New order</Button>
      </form>

      <ul className="mt-6 space-y-3">
        {orders.length === 0 && (
          <li className="text-sm text-muted-foreground">No orders yet — create one above.</li>
        )}
        {orders.map((o) => {
          const actions = availableTransitions(o.status, transitions, {
            role,
            isOrderClient: o.client_id === userId,
            isOrderDesigner: o.designer_id === userId,
          }).filter((to) => !HIDDEN_TARGETS.has(to));
          const isParticipant = o.client_id === userId || o.designer_id === userId;
          const isOrderClient = o.client_id === userId;
          const orderVersions = versions.filter((v) => v.order_id === o.id);
          const orderMessages = messages.filter((m) => m.order_id === o.id);
          const openDispute = disputes.find((d) => d.order_id === o.id && d.status === "OPEN");
          const canRaiseDispute =
            isOrderClient && (o.status === "IN_PROGRESS" || o.status === "CLIENT_PREVIEW");
          const held = heldFor(o.id);
          return (
            <li key={o.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground">{o.id}</p>
                  <p className="text-sm">
                    {o.product_type} · <span className="font-medium">{o.status}</span>
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {actions.length === 0 && (
                    <span className="text-xs text-muted-foreground">no actions</span>
                  )}
                  {actions.map((to) => (
                    <form key={to} action={transitionAction} className="flex items-center gap-1">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="to_status" value={to} />
                      {to === "ASSIGNED" && (
                        <input
                          name="designer_id"
                          placeholder="designer id"
                          className="w-28 rounded-md border px-2 py-1 text-xs"
                          aria-label="Designer id to assign"
                        />
                      )}
                      <Button type="submit" variant="outline" size="sm">
                        {to}
                      </Button>
                    </form>
                  ))}
                </div>
              </div>

              {(() => {
                const canQuote = role === "SALES" && o.status === "SUBMITTED";
                const canFund = isOrderClient && o.status === "QUOTED";
                const canRelease = role === "FINANCE" && o.status === "CLOSED";
                const canRefund =
                  role === "FINANCE" && (o.status === "PAYMENT_HELD" || o.status === "DISPUTED");
                const show =
                  o.price_total > 0 || canQuote || canFund || canRelease || canRefund;
                if (!show) return null;
                return (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs text-muted-foreground">Money</p>

                    {o.price_total > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        <li>
                          Price: <span className="font-medium text-foreground">{formatMoney(o.price_total, o.currency)}</span>{" "}
                          (designer {formatMoney(o.designer_payout, o.currency)} · qc{" "}
                          {formatMoney(o.qc_payout, o.currency)} · platform{" "}
                          {formatMoney(o.platform_commission, o.currency)})
                        </li>
                        {held > 0 && (
                          <li>
                            Held in escrow:{" "}
                            <span className="font-medium text-foreground">{formatMoney(held, o.currency)}</span>
                          </li>
                        )}
                        {o.status === "PAYOUT_RELEASED" && <li>✅ Funds released to payout legs.</li>}
                        {o.status === "REFUNDED" && <li>↩️ Funds refunded to the client.</li>}
                      </ul>
                    )}

                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {canQuote && (
                        <form action={quoteAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="order_id" value={o.id} />
                          <label className="text-xs">
                            Total
                            <input name="price_total" type="number" min="1" required
                              className="mt-0.5 block w-24 rounded-md border px-2 py-1 text-xs" />
                          </label>
                          <label className="text-xs">
                            Designer
                            <input name="designer_payout" type="number" min="0" defaultValue="0" required
                              className="mt-0.5 block w-24 rounded-md border px-2 py-1 text-xs" />
                          </label>
                          <label className="text-xs">
                            QC
                            <input name="qc_payout" type="number" min="0" defaultValue="0" required
                              className="mt-0.5 block w-20 rounded-md border px-2 py-1 text-xs" />
                          </label>
                          <Button type="submit" variant="outline" size="sm">
                            Quote (minor units)
                          </Button>
                        </form>
                      )}
                      {canFund && (
                        <form action={holdEscrowAction}>
                          <input type="hidden" name="order_id" value={o.id} />
                          <Button type="submit" size="sm">
                            Fund escrow — pay {formatMoney(o.price_total, o.currency)}
                          </Button>
                        </form>
                      )}
                      {canRelease && (
                        <form action={releaseEscrowAction}>
                          <input type="hidden" name="order_id" value={o.id} />
                          <Button type="submit" size="sm">
                            Release payout
                          </Button>
                        </form>
                      )}
                      {canRefund && (
                        <form action={refundEscrowAction}>
                          <input type="hidden" name="order_id" value={o.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Refund client
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })()}

              {(openDispute || canRaiseDispute) && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">Dispute</p>

                  {openDispute ? (
                    <div className="mt-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                      <p className="text-sm font-medium">⚠️ Dispute open</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {openDispute.reason}
                      </p>
                      {(role === "OPS" || role === "FINANCE") && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {role === "OPS" && (
                            <form action={resolveDisputeAction}>
                              <input type="hidden" name="order_id" value={o.id} />
                              <input type="hidden" name="resolution" value="REWORK" />
                              <Button type="submit" variant="outline" size="sm">
                                Resolve: send back for rework
                              </Button>
                            </form>
                          )}
                          {role === "FINANCE" && (
                            <form action={resolveDisputeAction}>
                              <input type="hidden" name="order_id" value={o.id} />
                              <input type="hidden" name="resolution" value="REFUND" />
                              <Button type="submit" variant="outline" size="sm">
                                Resolve: refund the client
                              </Button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <form action={raiseDisputeAction} className="mt-1 space-y-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <textarea
                        name="reason"
                        required
                        rows={2}
                        maxLength={5000}
                        placeholder="Describe the problem…"
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        aria-label="Dispute reason"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Raise a dispute
                      </Button>
                    </form>
                  )}
                </div>
              )}

              {(orderVersions.length > 0 || isParticipant) && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">Files</p>
                  <ul className="mt-1 space-y-1">
                    {orderVersions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between text-sm">
                        <span>
                          v{v.version_no} · <span className="text-muted-foreground">{v.content_type}</span>
                        </span>
                        <a
                          href={`/api/files/${v.id}`}
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                        >
                          Download
                        </a>
                      </li>
                    ))}
                    {orderVersions.length === 0 && (
                      <li className="text-xs text-muted-foreground">No files yet.</li>
                    )}
                  </ul>
                  {isParticipant && (
                    <form action={uploadFileAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input
                        type="file"
                        name="file"
                        required
                        className="text-xs"
                        aria-label="Upload a file"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Upload
                      </Button>
                    </form>
                  )}
                </div>
              )}

              {(orderMessages.length > 0 || isParticipant) && (
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    Messages{" "}
                    <span className="text-muted-foreground/70">
                      (identities are never shown — only your counterparty&apos;s role)
                    </span>
                  </p>
                  <ul className="mt-2 space-y-2">
                    {orderMessages.length === 0 && (
                      <li className="text-xs text-muted-foreground">No messages yet.</li>
                    )}
                    {orderMessages.map((m) => {
                      const mine = m.sender_id === userId;
                      const who = mine ? "You" : m.sender_party === "CLIENT" ? "Client" : "Designer";
                      return (
                        <li key={m.id} className={mine ? "text-right" : "text-left"}>
                          <div
                            className={`inline-block max-w-[85%] rounded-lg border px-3 py-2 text-left text-sm ${
                              mine ? "bg-muted" : ""
                            }`}
                          >
                            <p className="text-xs font-medium text-muted-foreground">{who}</p>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {isParticipant && (
                    <form action={postMessageAction} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="order_id" value={o.id} />
                      <textarea
                        name="body"
                        required
                        rows={2}
                        maxLength={5000}
                        placeholder="Write a message…"
                        className="flex-1 rounded-md border px-3 py-2 text-sm"
                        aria-label="Message body"
                      />
                      <Button type="submit" size="sm">
                        Send
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
