// Maps raw order_timeline() rows into presentation-ready steps. Framework-free
// (no next/react) so the labeling/QC-milestone logic is unit-testable
// independent of any UI. Never touches actor identity — only actor_role, which
// the DB has already stripped down to a role string.

export interface TimelineRawRow {
  seq: number | string;
  created_at: string;
  action: string;
  actor_role: string;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
  detail: string | null;
}

export type QcOutcome = "passed" | "revision_requested";

export interface TimelineStep {
  id: string;
  createdAt: string;
  label: string;
  actorRole: string;
  toStatus: string | null;
  amount: number | null;
  isQcMilestone: boolean;
  qcOutcome?: QcOutcome;
}

function humanizeStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function labelFor(row: TimelineRawRow): { label: string; isQcMilestone: boolean; qcOutcome?: QcOutcome } {
  const { action, from_status: from, to_status: to, detail } = row;

  if (action === "ORDER_CREATED") return { label: "Order created", isQcMilestone: false };

  if (action === "ORDER_QUOTED") return { label: "Quote issued", isQcMilestone: false };
  if (action === "ESCROW_HELD") return { label: "Payment secured in escrow", isQcMilestone: false };
  if (action === "ESCROW_RELEASED") return { label: "Payout released", isQcMilestone: false };
  if (action === "ESCROW_REFUNDED") return { label: "Refund issued to client", isQcMilestone: false };

  if (action === "DISPUTE_RAISED") return { label: "Dispute raised", isQcMilestone: false };
  if (action === "DISPUTE_RESOLVED") {
    if (detail === "REWORK") return { label: "Dispute resolved — returned for rework", isQcMilestone: false };
    if (detail === "REFUND") return { label: "Dispute resolved — refunded", isQcMilestone: false };
    return { label: "Dispute resolved", isQcMilestone: false };
  }

  if (action === "ORDER_STATUS_CHANGED") {
    // The independent QC gate: shown as an explicit, discrete milestone.
    if (from === "QC_REVIEW" && to === "CLIENT_PREVIEW") {
      return { label: "Independent QC review: passed", isQcMilestone: true, qcOutcome: "passed" };
    }
    if (from === "QC_REVIEW" && to === "REVISION_REQUESTED") {
      return {
        label: "Independent QC review: revision requested",
        isQcMilestone: true,
        qcOutcome: "revision_requested",
      };
    }

    switch (to) {
      case "SUBMITTED":
        return { label: "Submitted for quote", isQcMilestone: false };
      case "ASSIGNED":
        return { label: "Assigned to a designer", isQcMilestone: false };
      case "IN_PROGRESS":
        return {
          label: from === "REVISION_REQUESTED" ? "Revision started" : "Design work started",
          isQcMilestone: false,
        };
      case "DESIGNER_SUBMITTED":
        return { label: "Work submitted for QC", isQcMilestone: false };
      case "QC_REVIEW":
        return { label: "Independent QC review started", isQcMilestone: false };
      case "APPROVED":
        return { label: "Approved by client", isQcMilestone: false };
      case "DELIVERED":
        return { label: "Delivered", isQcMilestone: false };
      case "CLOSED":
        return { label: "Closed", isQcMilestone: false };
      case "CANCELLED":
        return { label: "Cancelled", isQcMilestone: false };
      default:
        return { label: to ? `Moved to ${humanizeStatus(to)}` : "Status changed", isQcMilestone: false };
    }
  }

  return { label: humanizeStatus(action), isQcMilestone: false };
}

/** Map raw order_timeline() rows (already chronological) into display steps. */
export function buildTimeline(rows: TimelineRawRow[]): TimelineStep[] {
  return rows.map((row) => {
    const { label, isQcMilestone, qcOutcome } = labelFor(row);
    return {
      id: String(row.seq),
      createdAt: row.created_at,
      label,
      actorRole: row.actor_role,
      toStatus: row.to_status,
      amount: row.amount,
      isQcMilestone,
      qcOutcome,
    };
  });
}
