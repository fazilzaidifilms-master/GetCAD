import {
  availableTransitions,
  fileGrantFor,
  grantExplanation,
  type FileKind,
  type TimelineRawRow,
  type TransitionRow,
} from "@/core";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { TONE_TEXT } from "@/lib/tone";

import {
  transitionAction,
  quoteAction,
  releaseEscrowAction,
  refundEscrowAction,
  postMessageAction,
  raiseDisputeAction,
  resolveDisputeAction,
  qcDecisionAction,
} from "./actions";
import { uploadFileAction } from "./fileActions";
import { PayButton } from "./PayButton";
import { OrderTimeline } from "./OrderTimeline";
import { PayoutPanel, type PayoutStateSummary } from "./PayoutPanel";
import type { DisputeRow, MessageRow, OrderRow, VersionRow } from "./types";

const HIDDEN_TARGETS = new Set(["QUOTED", "PAYMENT_HELD", "PAYOUT_RELEASED", "REFUNDED", "DISPUTED"]);

/**
 * How each kind is named to a human.
 *
 * The list used to show content types — "model/stl", "image/png" — which told
 * the reader what a file was made of and nothing about what it was for. On a
 * delivery of six or more artefacts that is unreadable.
 */
const FILE_KIND_LABELS: Record<string, string> = {
  CLIENT_REFERENCE: "Your reference material",
  RENDER: "Render",
  WEIGHT_CHART: "Gold weight chart",
  DIAMOND_DETAILS: "Diamond details",
  STL: "STL",
  RHINO_3DM: "Rhino 3DM",
  SUMMARY_SHEET: "Order summary sheet",
  OTHER: "File",
};

/** What a designer or staff member can be uploading, in delivery order. */
const UPLOADABLE_KINDS: FileKind[] = [
  "RENDER",
  "WEIGHT_CHART",
  "DIAMOND_DETAILS",
  "STL",
  "RHINO_3DM",
  "SUMMARY_SHEET",
  "OTHER",
];

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function OrderDetail({
  order: o,
  role,
  userId,
  transitions,
  versions,
  messages,
  openDispute,
  held,
  payoutState,
  timelineRows,
  timelineError,
}: {
  order: OrderRow;
  role: string;
  userId: string;
  transitions: TransitionRow[];
  versions: VersionRow[];
  messages: MessageRow[];
  openDispute?: DisputeRow;
  held: number;
  payoutState?: PayoutStateSummary | null;
  timelineRows: TimelineRawRow[];
  timelineError?: string | null;
}) {
  const isOrderClient = o.client_id === userId;
  const isParticipant = isOrderClient || o.designer_id === userId;

  // The SAME function the download route calls, so the list and the API cannot
  // disagree: a row offered here is a row that will actually serve, and a row
  // the API would refuse is never shown as a link. NONE rows are dropped
  // entirely — for those viewers the file's existence is itself the secret.
  const visibleFiles = versions
    .map((version) => {
      const grant = fileGrantFor({
        orderStatus: o.status,
        role,
        isOrderClient,
        isOrderDesigner: o.designer_id === userId,
        isUploader: version.uploaded_by === userId,
        fileKind: version.kind,
      });
      return {
        version,
        grant,
        explanation: grantExplanation(grant, { orderStatus: o.status, fileKind: version.kind }),
      };
    })
    .filter((f) => f.grant !== "NONE");
  const allActions = availableTransitions(o.status, transitions, {
    role,
    isOrderClient,
    isOrderDesigner: o.designer_id === userId,
  }).filter((to) => !HIDDEN_TARGETS.has(to));

  // The QC pass/revision decision is the independent quality gate — surfaced as
  // its own clearly-labelled panel rather than a generic status chip.
  const isQcDecision = role === "QC" && o.status === "QC_REVIEW";
  const qcTargets = new Set(["CLIENT_PREVIEW", "REVISION_REQUESTED"]);
  const actions = isQcDecision ? allActions.filter((to) => !qcTargets.has(to)) : allActions;

  const canQuote = role === "SALES" && o.status === "SUBMITTED";
  // Party AND role. Owning the order is not enough: a staff member who happens
  // to have created an order must not be offered the client's actions while
  // acting in a staff role. The server action enforces the same pair.
  const isActingAsClient = role === "CLIENT" && isOrderClient;
  const canFund = isActingAsClient && o.status === "QUOTED";
  const canRelease = role === "FINANCE" && o.status === "CLOSED";
  const canRefund = role === "FINANCE" && (o.status === "PAYMENT_HELD" || o.status === "DISPUTED");
  // raise_dispute() requires role CLIENT too — without this the button appears
  // for a staff owner and then fails at the database.
  const canRaiseDispute =
    isActingAsClient && (o.status === "IN_PROGRESS" || o.status === "CLIENT_PREVIEW");
  const showMoney = o.price_total > 0 || canQuote || canFund || canRelease || canRefund;

  // The receipt for "what just happened": the timestamp of the most recent
  // recorded event, read straight from the timeline — no separate confirmation
  // mechanism needed, since every action already produces a timestamped entry.
  const lastEvent = timelineRows[timelineRows.length - 1];
  const lastUpdatedAt = lastEvent
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(lastEvent.created_at),
      )
    : null;

  return (
    <div className="space-y-4">
      {/* Timeline — every state explicit, visible, timestamped. The flagship
          trust surface: the client always sees exactly where their order is. */}
      <Panel title="Timeline">
        {timelineError ? (
          <p className="text-sm text-destructive">
            Couldn&apos;t load history: {timelineError}
          </p>
        ) : (
          <OrderTimeline rows={timelineRows} currency={o.currency} />
        )}
      </Panel>

      {/* Independent QC decision — the visible quality gate for this order. */}
      {isQcDecision && (
        <Panel title="Independent QC review">
          <p className="text-sm text-muted-foreground">
            Your decision appears on the client&apos;s timeline as &quot;Independent QC review:
            passed&quot; or &quot;revision requested&quot;, by role only. It is recorded against
            your account so the review is attributable and payable — you cannot review work you
            produced.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={qcDecisionAction}>
              <input type="hidden" name="order_id" value={o.id} />
              <input type="hidden" name="outcome" value="PASS" />
              <Button type="submit">Pass — send to client preview</Button>
            </form>
            <form action={qcDecisionAction}>
              <input type="hidden" name="order_id" value={o.id} />
              <input type="hidden" name="outcome" value="REVISION" />
              <Button type="submit" variant="outline">
                Request revision
              </Button>
            </form>
          </div>
        </Panel>
      )}

      {/* Overview + generic actions */}
      <Panel title="Order" aside={<StatusBadge status={o.status} />}>
        <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Reference</dt>
          <dd className="tabular truncate font-mono text-xs" title={o.id}>
            {o.id}
          </dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{o.product_type}</dd>
          {lastUpdatedAt && (
            <>
              <dt className="text-muted-foreground">Recorded</dt>
              <dd className="tabular font-mono text-xs text-muted-foreground">{lastUpdatedAt}</dd>
            </>
          )}
        </dl>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          {actions.length === 0 && (
            <p className="text-xs text-muted-foreground">No actions available for your role now.</p>
          )}
          {actions.map((to) => (
            <form key={to} action={transitionAction} className="flex items-end gap-1.5">
              <input type="hidden" name="order_id" value={o.id} />
              <input type="hidden" name="to_status" value={to} />
              {to === "ASSIGNED" && (
                <Input
                  name="designer_id"
                  placeholder="designer reference"
                  aria-label="Designer reference to assign"
                  className="h-8 w-40"
                />
              )}
              <Button type="submit" variant="outline" size="sm">
                <StatusBadge status={to} className="border-0 bg-transparent px-0" />
              </Button>
            </form>
          ))}
        </div>
      </Panel>

      {/* Payment / escrow */}
      {showMoney && (
        <Panel title="Payment">
          {o.price_total > 0 && (
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-4">
              {[
                ["Total", o.price_total],
                ["Designer", o.designer_payout],
                ["QC", o.qc_payout],
                ["Platform", o.platform_commission],
              ].map(([label, amt]) => (
                <div key={label as string}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="tabular font-mono">{formatMoney(amt as number, o.currency)}</dd>
                </div>
              ))}
            </dl>
          )}

          {held > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              <span className="text-muted-foreground">Held in escrow</span>
              <span className="tabular ml-auto font-mono font-medium">
                {formatMoney(held, o.currency)}
              </span>
            </div>
          )}
          {o.status === "PAYOUT_RELEASED" && (
            <p className={`mt-3 text-sm ${TONE_TEXT.success}`}>
              Funds released to the payout legs.
            </p>
          )}
          {o.status === "REFUNDED" && (
            <p className="mt-3 text-sm text-muted-foreground">Funds refunded to the client.</p>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            {canQuote && (
              <form action={quoteAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="order_id" value={o.id} />
                <label className="text-xs text-muted-foreground">
                  Total
                  <Input name="price_total" type="number" min="1" required className="mt-0.5 w-28" />
                </label>
                <label className="text-xs text-muted-foreground">
                  Designer
                  <Input name="designer_payout" type="number" min="0" defaultValue="0" required className="mt-0.5 w-28" />
                </label>
                <label className="text-xs text-muted-foreground">
                  QC
                  <Input name="qc_payout" type="number" min="0" defaultValue="0" required className="mt-0.5 w-24" />
                </label>
                <Button type="submit" size="sm">
                  Set quote
                </Button>
                <span className="w-full text-xs text-muted-foreground">
                  Amounts in cents (e.g. 10000 = $100.00). Platform = total − designer − QC.
                </span>
              </form>
            )}
            {canFund && (
              <PayButton orderId={o.id} amount={o.price_total} currency={o.currency} />
            )}
            {canRelease && (
              <form action={releaseEscrowAction}>
                <input type="hidden" name="order_id" value={o.id} />
                <Button type="submit">Release payout</Button>
              </form>
            )}
            {canRefund && (
              <form action={refundEscrowAction}>
                <input type="hidden" name="order_id" value={o.id} />
                <Button type="submit" variant="outline">
                  Refund client
                </Button>
              </form>
            )}
          </div>
        </Panel>
      )}

      {/* Payouts — FINANCE only. Released money is an OBLIGATION; this is the
          only view of whether it actually reached the people owed it. */}
      {role === "FINANCE" && payoutState && payoutState.owed > 0 && (
        <Panel title="Payouts">
          <PayoutPanel orderId={o.id} currency={o.currency} state={payoutState} />
        </Panel>
      )}

      {/* Dispute — critical state, shown as a persistent banner (never a toast) */}
      {(openDispute || canRaiseDispute) && (
        <Panel title="Dispute">
          {openDispute ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">Dispute open</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{openDispute.reason}</p>
              {(role === "OPS" || role === "FINANCE") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {role === "OPS" && (
                    <form action={resolveDisputeAction}>
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="resolution" value="REWORK" />
                      <Button type="submit" variant="outline" size="sm">
                        Send back for rework
                      </Button>
                    </form>
                  )}
                  {role === "FINANCE" && (
                    <form action={resolveDisputeAction}>
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="resolution" value="REFUND" />
                      <Button type="submit" variant="destructive" size="sm">
                        Refund the client
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ) : (
            <form action={raiseDisputeAction} className="space-y-2">
              <input type="hidden" name="order_id" value={o.id} />
              <Textarea
                name="reason"
                required
                rows={2}
                maxLength={5000}
                placeholder="Describe the problem with this order…"
                aria-label="Dispute reason"
              />
              <Button type="submit" variant="outline" size="sm">
                Raise a dispute
              </Button>
            </form>
          )}
        </Panel>
      )}

      {/* Files */}
      {(visibleFiles.length > 0 || isParticipant) && (
        <Panel title="Files">
          <ul className="divide-y divide-border">
            {visibleFiles.length === 0 && (
              <li className="py-2 text-sm text-muted-foreground">No files yet.</li>
            )}
            {visibleFiles.map(({ version: v, grant, explanation }) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="tabular font-mono text-xs text-muted-foreground">
                      v{v.version_no}
                    </span>
                    <span>{FILE_KIND_LABELS[v.kind] ?? v.kind}</span>
                  </span>
                  {explanation && (
                    <span className="mt-0.5 text-xs text-muted-foreground">{explanation}</span>
                  )}
                </span>
                {grant === "ALLOW" ? (
                  <a
                    href={`/api/files/${v.id}`}
                    className="shrink-0 text-sm text-primary hover:underline"
                  >
                    Download
                  </a>
                ) : (
                  // Named, but not a link. The row is here so the client can see
                  // the work exists and what it is; the sentence above says what
                  // unlocks it. The API returns 404 for this row either way —
                  // this is presentation, not enforcement.
                  <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                    Held
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isParticipant && (
            <form action={uploadFileAction} className="mt-3">
              <input type="hidden" name="order_id" value={o.id} />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  name="file"
                  required
                  accept=".png,.jpg,.jpeg,.step,.stp"
                  aria-label="Upload a file"
                  className="text-sm"
                />
                {/* What this file IS decides who can download it and when, so it
                    is asked for at upload time rather than guessed from the
                    extension afterwards. A client has one legitimate answer, so
                    they are not asked at all. */}
                {isOrderClient ? (
                  <input type="hidden" name="kind" value="CLIENT_REFERENCE" />
                ) : (
                  <select
                    name="kind"
                    defaultValue="RENDER"
                    aria-label="What this file is"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {UPLOADABLE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {FILE_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                )}
                <Button type="submit" variant="outline" size="sm">
                  Upload
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                PNG, JPEG or STEP. Identifying metadata (EXIF, author and organisation fields) is
                removed before the file is stored — formats we cannot clean are not accepted here.
              </p>
            </form>
          )}
        </Panel>
      )}

      {/* Messages — double-blind */}
      {(messages.length > 0 || isParticipant) && (
        <Panel
          title="Messages"
          aside={
            <span className="text-xs text-muted-foreground">Identities hidden — role only</span>
          }
        >
          <ul className="space-y-2">
            {messages.length === 0 && (
              <li className="text-sm text-muted-foreground">No messages yet.</li>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === userId;
              const who = mine ? "You" : m.sender_party === "CLIENT" ? "Client" : "Designer";
              return (
                <li key={m.id} className={mine ? "text-right" : "text-left"}>
                  <div
                    className={`inline-block max-w-[85%] rounded-lg border px-3 py-2 text-left text-sm ${
                      mine ? "border-primary/20 bg-primary/5" : "border-border bg-subtle"
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
            <form action={postMessageAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="order_id" value={o.id} />
              <Textarea
                name="body"
                required
                rows={2}
                maxLength={5000}
                placeholder="Write a message…"
                aria-label="Message body"
                className="flex-1"
              />
              <Button type="submit">Send</Button>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}
