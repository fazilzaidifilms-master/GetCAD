import { describe, expect, it } from "vitest";

import { orderActions, primaryAction } from "./actions";
import type { TransitionRow } from "./availableTransitions";

const t = (
  from: string,
  to: string,
  actor_role: string,
  actor_scope: TransitionRow["actor_scope"] = "STAFF",
): TransitionRow => ({ from_status: from, to_status: to, actor_role, actor_scope });

/** Index 0 with the `noUncheckedIndexedAccess` narrowing done once. */
const firstOf = <T,>(xs: T[]): T => {
  expect(xs.length).toBeGreaterThan(0);
  return xs[0] as T;
};

const CLIENT = { role: "CLIENT", isOrderClient: true, isOrderDesigner: false };
const OTHER_CLIENT = { role: "CLIENT", isOrderClient: false, isOrderDesigner: false };
const DESIGNER = { role: "DESIGNER", isOrderClient: false, isOrderDesigner: true };
const FINANCE = { role: "FINANCE", isOrderClient: false, isOrderDesigner: false };

describe("orderActions", () => {
  it("turns a legal transition into a verb, not a status name", () => {
    const rows = [t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY")];
    const action = orderActions("CLIENT_PREVIEW", rows, CLIENT)[0]!;
    expect(action.label).toBe("Approve and release");
    expect(action.to).toBe("APPROVED");
  });

  it("offers nothing to someone the transition table does not admit", () => {
    const rows = [t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY")];
    expect(orderActions("CLIENT_PREVIEW", rows, OTHER_CLIENT)).toEqual([]);
    expect(orderActions("CLIENT_PREVIEW", rows, DESIGNER)).toEqual([]);
  });

  // The failure this prevents: a screen rendering "Raise a dispute" as the
  // friendly primary button sitting next to "Approve".
  it("marks the destructive routes as destructive", () => {
    const rows = [
      t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY"),
      t("CLIENT_PREVIEW", "DISPUTED", "CLIENT", "CLIENT_PARTY"),
    ];
    const actions = orderActions("CLIENT_PREVIEW", rows, CLIENT);
    const dispute = actions.find((a) => a.to === "DISPUTED");
    expect(dispute?.intent).toBe("danger");
    expect(actions.find((a) => a.to === "APPROVED")?.intent).toBe("primary");
  });

  it("allows only one primary — two equally loud buttons is the same as none", () => {
    const rows = [
      t("QC_REVIEW", "CLIENT_PREVIEW", "QC"),
      t("QC_REVIEW", "REVISION_REQUESTED", "QC"),
      t("QC_REVIEW", "DISPUTED", "QC"),
    ];
    const actions = orderActions("QC_REVIEW", rows, {
      role: "QC",
      isOrderClient: false,
      isOrderDesigner: false,
    });
    expect(actions.filter((a) => a.intent === "primary")).toHaveLength(1);
  });

  it("puts the most important action first, whatever order the rows arrive in", () => {
    const rows = [
      t("CLIENT_PREVIEW", "REVISION_REQUESTED", "CLIENT", "CLIENT_PARTY"),
      t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY"),
    ];
    expect(orderActions("CLIENT_PREVIEW", rows, CLIENT)[0]!.to).toBe("APPROVED");
  });

  it("requires a reason exactly where the database does", () => {
    const rows = [
      t("CLIENT_PREVIEW", "REVISION_REQUESTED", "CLIENT", "CLIENT_PARTY"),
      t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY"),
    ];
    const actions = orderActions("CLIENT_PREVIEW", rows, CLIENT);
    expect(actions.find((a) => a.to === "REVISION_REQUESTED")?.requiresReason).toBe(true);
    expect(actions.find((a) => a.to === "APPROVED")?.requiresReason).toBe(false);
  });

  it("confirms before anything the actor cannot walk back", () => {
    const approve = orderActions(
      "CLIENT_PREVIEW",
      [t("CLIENT_PREVIEW", "APPROVED", "CLIENT", "CLIENT_PARTY")],
      CLIENT,
    )[0]!;
    expect(approve.confirm).toMatch(/cannot be undone/i);

    const payout = orderActions(
      "CLOSED",
      [t("CLOSED", "PAYOUT_RELEASED", "FINANCE")],
      FINANCE,
    )[0]!;
    expect(payout.confirm).toMatch(/cannot be reversed/i);
  });

  // Same destination, different sentence depending on where you came from.
  it("reads the origin, not just the target", () => {
    const fromQc = orderActions(
      "QC_REVIEW",
      [t("QC_REVIEW", "CLIENT_PREVIEW", "QC")],
      { role: "QC", isOrderClient: false, isOrderDesigner: false },
    )[0]!;
    const fromRevision = orderActions(
      "REVISION_REQUESTED",
      [t("REVISION_REQUESTED", "CLIENT_PREVIEW", "DESIGNER", "DESIGNER_PARTY")],
      DESIGNER,
    )[0]!;
    expect(fromQc.label).toBe("Pass review");
    expect(fromRevision.label).toBe("Submit the revision");
  });

  // The database is authoritative. A transition this table has not been taught
  // must still render — just never as the loudest thing on the screen.
  it("renders an unknown target rather than hiding it", () => {
    const rows = [t("CLOSED", "ARCHIVED", "OPS")];
    const action = firstOf(orderActions("CLOSED", rows, {
      role: "OPS",
      isOrderClient: false,
      isOrderDesigner: false,
    }));
    expect(action.label).toBe("Archived");
    expect(action.intent).toBe("secondary");
  });

  it("says nothing when the actor is only waiting", () => {
    const rows = [t("IN_PROGRESS", "DESIGNER_SUBMITTED", "DESIGNER", "DESIGNER_PARTY")];
    const actions = orderActions("IN_PROGRESS", rows, CLIENT);
    expect(actions).toEqual([]);
    expect(primaryAction(actions)).toBeNull();
  });
});
