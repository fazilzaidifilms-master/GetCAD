import { describe, expect, it } from "vitest";

import { ESCROW_KINDS, escrowSign, netHeld } from "./escrowSign";

describe("Test AT1 — escrow sign is explicit, never defaulted", () => {
  it("credits money that arrives or returns", () => {
    expect(escrowSign("HOLD")).toBe(1);
    expect(escrowSign("REVERSAL")).toBe(1);
  });

  it("debits money that leaves", () => {
    for (const kind of ["RELEASE", "REFUND", "PROCESSOR_FEE", "CHARGEBACK"]) {
      expect(escrowSign(kind)).toBe(-1);
    }
  });

  it("THROWS on an unknown kind rather than guessing a direction", () => {
    // The bug this guards: `kind === "HOLD" ? amount : -amount` silently
    // subtracted anything it did not recognise.
    expect(() => escrowSign("SOMETHING_NEW")).toThrow(/unknown escrow kind/i);
  });

  it("has a defined direction for every declared kind", () => {
    for (const kind of ESCROW_KINDS) {
      expect([1, -1]).toContain(escrowSign(kind));
    }
  });
});

describe("Test AT2 — net held", () => {
  it("is zero for an order with no movements", () => {
    expect(netHeld([])).toBe(0);
  });

  it("nets a full lifecycle to zero", () => {
    expect(
      netHeld([
        { kind: "HOLD", amount: 1000 },
        { kind: "RELEASE", amount: 600 },
        { kind: "RELEASE", amount: 200 },
        { kind: "RELEASE", amount: 200 },
      ]),
    ).toBe(0);
  });

  it("leaves the remainder held after a PARTIAL refund", () => {
    expect(
      netHeld([
        { kind: "HOLD", amount: 1000 },
        { kind: "REFUND", amount: 400 },
      ]),
    ).toBe(600);
  });

  it("ADDS a reversal back — the case the old shortcut got backwards", () => {
    const legs = [
      { kind: "HOLD", amount: 1000 },
      { kind: "RELEASE", amount: 600 },
      { kind: "REVERSAL", amount: 600 }, // the payout failed and came back
    ];
    expect(netHeld(legs)).toBe(1000);
    // What the old inline shortcut would have produced:
    const buggy = legs.reduce((n, l) => n + (l.kind === "HOLD" ? l.amount : -l.amount), 0);
    expect(buggy).toBe(-200);
    expect(buggy).not.toBe(netHeld(legs));
  });

  it("subtracts processor fees and chargebacks", () => {
    expect(
      netHeld([
        { kind: "HOLD", amount: 1000 },
        { kind: "PROCESSOR_FEE", amount: 29 },
      ]),
    ).toBe(971);
    expect(
      netHeld([
        { kind: "HOLD", amount: 1000 },
        { kind: "CHARGEBACK", amount: 1000 },
      ]),
    ).toBe(0);
  });
});
