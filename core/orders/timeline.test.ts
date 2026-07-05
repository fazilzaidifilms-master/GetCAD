import { describe, expect, it } from "vitest";

import { buildTimeline, type TimelineRawRow } from "./timeline";

function row(overrides: Partial<TimelineRawRow>): TimelineRawRow {
  return {
    seq: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    action: "ORDER_STATUS_CHANGED",
    actor_role: "CLIENT",
    from_status: null,
    to_status: null,
    amount: null,
    detail: null,
    ...overrides,
  };
}

/** buildTimeline() on a single row always yields exactly one step. */
function buildOne(overrides: Partial<TimelineRawRow>) {
  const [step] = buildTimeline([row(overrides)]);
  if (!step) throw new Error("expected exactly one timeline step");
  return step;
}

describe("buildTimeline", () => {
  it("labels ORDER_CREATED and preserves order/actor role", () => {
    const step = buildOne({ action: "ORDER_CREATED", to_status: "DRAFT", actor_role: "CLIENT" });
    expect(step).toMatchObject({
      label: "Order created",
      actorRole: "CLIENT",
      toStatus: "DRAFT",
      isQcMilestone: false,
    });
  });

  it("flags the QC-pass milestone distinctly, with the reviewer shown only by role", () => {
    const step = buildOne({
      action: "ORDER_STATUS_CHANGED",
      from_status: "QC_REVIEW",
      to_status: "CLIENT_PREVIEW",
      actor_role: "QC",
    });
    expect(step.label).toBe("Independent QC review: passed");
    expect(step.isQcMilestone).toBe(true);
    expect(step.qcOutcome).toBe("passed");
    expect(step.actorRole).toBe("QC");
  });

  it("flags the QC-revision milestone distinctly from a plain status change", () => {
    const step = buildOne({
      action: "ORDER_STATUS_CHANGED",
      from_status: "QC_REVIEW",
      to_status: "REVISION_REQUESTED",
      actor_role: "QC",
    });
    expect(step.label).toBe("Independent QC review: revision requested");
    expect(step.qcOutcome).toBe("revision_requested");
  });

  it("labels money-bearing entries and carries their amount through", () => {
    const quoted = buildOne({ action: "ORDER_QUOTED", amount: 10000 });
    const held = buildOne({ action: "ESCROW_HELD", amount: 10000 });
    const refunded = buildOne({ action: "ESCROW_REFUNDED", amount: 5000 });
    expect(quoted).toMatchObject({ label: "Quote issued", amount: 10000 });
    expect(held).toMatchObject({ label: "Payment secured in escrow", amount: 10000 });
    expect(refunded).toMatchObject({ label: "Refund issued to client", amount: 5000 });
  });

  it("labels dispute resolution by its outcome (rework vs refund)", () => {
    const rework = buildOne({ action: "DISPUTE_RESOLVED", detail: "REWORK" });
    const refund = buildOne({ action: "DISPUTE_RESOLVED", detail: "REFUND" });
    expect(rework.label).toBe("Dispute resolved — returned for rework");
    expect(refund.label).toBe("Dispute resolved — refunded");
  });

  it("humanises an unrecognised target status instead of throwing", () => {
    const step = buildOne({ action: "ORDER_STATUS_CHANGED", to_status: "SOME_NEW_STATE" });
    expect(step.label).toBe("Moved to Some new state");
    expect(step.isQcMilestone).toBe(false);
  });

  it("preserves row order and never leaks an actor id field", () => {
    const rows = [
      row({ seq: 1, action: "ORDER_CREATED" }),
      row({ seq: 2, action: "ORDER_STATUS_CHANGED", to_status: "SUBMITTED" }),
    ];
    const steps = buildTimeline(rows);
    expect(steps.map((s) => s.id)).toEqual(["1", "2"]);
    for (const s of steps) expect(s).not.toHaveProperty("actorId");
  });
});
