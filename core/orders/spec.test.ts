import { describe, expect, it } from "vitest";

import {
  caratToMct,
  estimateDiameterUm,
  estimateMct,
  formatCarat,
  formatMm,
  mctToCarat,
  micronsToMm,
  mmToMicrons,
  specIsComplete,
  specProblems,
  type OrderSpecInput,
} from "./spec";

const COMPLETE: OrderSpecInput = {
  referenceName: "Anniversary band",
  product: "RING",
  metal: "YELLOW",
  karatage: "18K",
  purpose: "CASTING",
  format: "BOTH",
  finish: "HIGH_POLISH",
  hasCentreStone: false,
};

const fields = (input: OrderSpecInput) => specProblems(input).map((p) => p.field);

describe("units", () => {
  // The reason integers exist here at all: 1.3mm is not representable in binary
  // floating point, and these numbers decide whether a seat can be cut.
  it("round-trips a millimetre value that a float would mangle", () => {
    expect(mmToMicrons(1.3)).toBe(1300);
    expect(micronsToMm(1300)).toBe(1.3);
    expect(mmToMicrons(6.5)).toBe(6500);
  });

  it("round-trips carat weights", () => {
    expect(caratToMct(0.75)).toBe(750);
    expect(mctToCarat(750)).toBe(0.75);
    expect(caratToMct(1.01)).toBe(1010);
  });

  it("stores whole microns, never a fraction", () => {
    expect(Number.isInteger(mmToMicrons(1.2345))).toBe(true);
  });

  it("formats at the precision the trade quotes in", () => {
    expect(formatMm(6500)).toBe("6.50 mm");
    expect(formatCarat(1010)).toBe("1.01 ct");
  });
});

describe("weight estimates", () => {
  // A 6.5mm round brilliant is ~1ct — the number every jeweller knows, and the
  // one that shows the formula is wired up correctly.
  it("puts a 6.5mm round at about a carat", () => {
    const mct = estimateMct("ROUND", 6500, 6500, null);
    expect(mct).not.toBeNull();
    expect(mctToCarat(mct!)).toBeGreaterThan(0.9);
    expect(mctToCarat(mct!)).toBeLessThan(1.15);
  });

  it("uses a measured depth when it has one", () => {
    const shallow = estimateMct("ROUND", 6500, 6500, 3500);
    const deep = estimateMct("ROUND", 6500, 6500, 4500);
    expect(deep!).toBeGreaterThan(shallow!);
  });

  it("says nothing rather than guessing for an unknown shape", () => {
    expect(estimateMct("SPARKLY", 6500, 6500, null)).toBeNull();
  });

  it("says nothing without both dimensions", () => {
    expect(estimateMct("ROUND", 6500, null, null)).toBeNull();
  });

  it("goes back from weight to diameter for a round", () => {
    const um = estimateDiameterUm("ROUND", 1000);
    expect(um).not.toBeNull();
    expect(micronsToMm(um!)).toBeGreaterThan(6.0);
    expect(micronsToMm(um!)).toBeLessThan(7.0);
  });

  // A pear can be long and narrow or short and wide at the same weight, so a
  // single confident number would be invented information.
  it("refuses to invent a width for a shape with no fixed ratio", () => {
    expect(estimateDiameterUm("PEAR", 1000)).toBeNull();
    expect(estimateDiameterUm("MARQUISE", 1000)).toBeNull();
  });
});

describe("specProblems", () => {
  it("passes a complete brief", () => {
    expect(specProblems(COMPLETE)).toEqual([]);
    expect(specIsComplete(COMPLETE)).toBe(true);
  });

  // A form that reveals its problems one at a time turns a two-minute task
  // into six round trips.
  it("reports every problem at once, not just the first", () => {
    const empty = { ...COMPLETE, referenceName: "", product: "", metal: "", finish: "" };
    expect(specProblems(empty).length).toBeGreaterThanOrEqual(4);
  });

  it("addresses each problem to the field that caused it", () => {
    expect(fields({ ...COMPLETE, karatage: "" })).toEqual(["karatage"]);
  });

  it("asks for a shape and a setting once there is a centre stone", () => {
    const f = fields({ ...COMPLETE, hasCentreStone: true });
    expect(f).toContain("centreShape");
    expect(f).toContain("centreSetting");
    expect(f).toContain("centreQuantity");
  });

  it("accepts either measurement route", () => {
    const base = {
      ...COMPLETE,
      hasCentreStone: true,
      centreShape: "ROUND",
      centreSetting: "PRONG_6",
      centreQuantity: 1,
    };
    expect(specProblems({ ...base, centreLengthUm: 6500, centreWidthUm: 6500 })).toEqual([]);
    expect(specProblems({ ...base, centreCaratMct: 1000 })).toEqual([]);
    expect(fields(base)).toContain("centreSize");
  });

  // The point is catching a misplaced decimal point, not second-guessing an
  // unusual commission.
  it("catches a decimal point in the wrong place", () => {
    const f = fields({
      ...COMPLETE,
      hasCentreStone: true,
      centreShape: "ROUND",
      centreSetting: "BEZEL",
      centreQuantity: 1,
      centreLengthUm: mmToMicrons(650),
      centreWidthUm: 6500,
    });
    expect(f).toContain("centreLengthUm");
  });

  it("says nothing about stone size when there is no stone", () => {
    expect(fields({ ...COMPLETE, hasCentreStone: false })).toEqual([]);
  });

  it("wants to know what changed on a revision", () => {
    expect(fields({ ...COMPLETE, basedOnOrderId: "ord_1" })).toEqual(["changeSummary"]);
  });

  it("wants to know which order a description of changes refers to", () => {
    expect(fields({ ...COMPLETE, changeSummary: "wider band" })).toEqual(["basedOnOrderId"]);
  });

  it("accepts a coherent revision", () => {
    expect(
      specProblems({ ...COMPLETE, basedOnOrderId: "ord_1", changeSummary: "wider band" }),
    ).toEqual([]);
  });

  it("rejects a name too long for the column", () => {
    expect(fields({ ...COMPLETE, referenceName: "x".repeat(121) })).toEqual(["referenceName"]);
  });
});
