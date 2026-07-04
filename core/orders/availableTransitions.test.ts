import { describe, expect, it } from "vitest";

import { availableTransitions, type TransitionRow } from "./availableTransitions";

// A small slice of the real graph.
const graph: TransitionRow[] = [
  { from_status: "DRAFT", to_status: "SUBMITTED", actor_role: "CLIENT", actor_scope: "CLIENT_PARTY" },
  { from_status: "DRAFT", to_status: "CANCELLED", actor_role: "CLIENT", actor_scope: "CLIENT_PARTY" },
  { from_status: "SUBMITTED", to_status: "QUOTED", actor_role: "SALES", actor_scope: "STAFF" },
  { from_status: "ASSIGNED", to_status: "IN_PROGRESS", actor_role: "DESIGNER", actor_scope: "DESIGNER_PARTY" },
];

describe("availableTransitions", () => {
  it("offers a client their own DRAFT order's moves", () => {
    expect(
      availableTransitions("DRAFT", graph, { role: "CLIENT", isOrderClient: true, isOrderDesigner: false }),
    ).toEqual(["SUBMITTED", "CANCELLED"]);
  });

  it("offers nothing to a client who is NOT the order's client (party check)", () => {
    expect(
      availableTransitions("DRAFT", graph, { role: "CLIENT", isOrderClient: false, isOrderDesigner: false }),
    ).toEqual([]);
  });

  it("offers a STAFF role its move regardless of party", () => {
    expect(
      availableTransitions("SUBMITTED", graph, { role: "SALES", isOrderClient: false, isOrderDesigner: false }),
    ).toEqual(["QUOTED"]);
  });

  it("requires the assigned designer for DESIGNER_PARTY moves", () => {
    expect(
      availableTransitions("ASSIGNED", graph, { role: "DESIGNER", isOrderClient: false, isOrderDesigner: true }),
    ).toEqual(["IN_PROGRESS"]);
    expect(
      availableTransitions("ASSIGNED", graph, { role: "DESIGNER", isOrderClient: false, isOrderDesigner: false }),
    ).toEqual([]);
  });

  it("offers nothing for a status with no matching role", () => {
    expect(
      availableTransitions("SUBMITTED", graph, { role: "CLIENT", isOrderClient: true, isOrderDesigner: false }),
    ).toEqual([]);
  });
});
