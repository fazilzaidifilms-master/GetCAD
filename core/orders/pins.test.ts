import { describe, expect, it } from "vitest";

import { BP_MAX, crowdedPairs, pinFromTap, pinProblems, pinStyle, type Pin } from "./pins";

const RECT = { left: 20, top: 40, width: 200, height: 400 };
const pin = (xBp: number, yBp: number, label = "prong"): Pin => ({ xBp, yBp, label });

describe("pinFromTap", () => {
  it("puts a centre tap in the centre", () => {
    expect(pinFromTap(120, 240, RECT)).toEqual({ xBp: 5000, yBp: 5000 });
  });

  it("puts the corners at the corners", () => {
    expect(pinFromTap(20, 40, RECT)).toEqual({ xBp: 0, yBp: 0 });
    expect(pinFromTap(220, 440, RECT)).toEqual({ xBp: BP_MAX, yBp: BP_MAX });
  });

  // Fingers overshoot the edge of an image constantly.
  it("clamps a tap that lands outside the image", () => {
    expect(pinFromTap(-500, -500, RECT)).toEqual({ xBp: 0, yBp: 0 });
    expect(pinFromTap(9999, 9999, RECT)).toEqual({ xBp: BP_MAX, yBp: BP_MAX });
  });

  it("always produces whole basis points", () => {
    const p = pinFromTap(73, 211, RECT);
    expect(Number.isInteger(p.xBp)).toBe(true);
    expect(Number.isInteger(p.yBp)).toBe(true);
  });

  // Dropping it in the corner would be a silent wrong answer; the centre is
  // obviously wrong and obviously draggable.
  it("falls back to the centre when the image has not laid out", () => {
    expect(pinFromTap(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      xBp: 5000,
      yBp: 5000,
    });
  });

  // The whole reason for basis points: same pin, different screens.
  it("gives the same coordinates whatever the rendered size", () => {
    const phone = pinFromTap(100, 200, { left: 0, top: 0, width: 200, height: 400 });
    const desktop = pinFromTap(400, 800, { left: 0, top: 0, width: 800, height: 1600 });
    expect(phone).toEqual(desktop);
  });
});

describe("pinStyle", () => {
  it("converts to percentages for CSS", () => {
    expect(pinStyle({ xBp: 2500, yBp: 7500 })).toEqual({ left: "25%", top: "75%" });
  });
});

describe("pinProblems", () => {
  it("passes a labelled set", () => {
    expect(pinProblems([pin(0, 0), pin(9000, 9000, "band width")])).toEqual([]);
  });

  it("objects to an unlabelled pin", () => {
    expect(pinProblems([pin(0, 0, "")])[0]).toMatch(/just a dot/);
    expect(pinProblems([pin(0, 0, "   ")])).toHaveLength(1);
  });

  it("counts how many are unlabelled", () => {
    expect(pinProblems([pin(0, 0, ""), pin(1, 1, ""), pin(2, 2, "ok")])[0]).toMatch(/2 pins have/);
  });

  it("catches a label longer than the column", () => {
    expect(pinProblems([pin(0, 0, "x".repeat(121))])[0]).toMatch(/longer than 120/);
  });

  it("suggests splitting a picture with too many pins", () => {
    const many = Array.from({ length: 31 }, (_, i) => pin(i * 100, i * 100));
    expect(pinProblems(many).some((p) => /splitting/.test(p))).toBe(true);
  });
});

describe("crowdedPairs", () => {
  // Looks fine while placing, unreadable afterwards — worth saying, not worth
  // refusing.
  it("notices two pins on top of each other", () => {
    expect(crowdedPairs([pin(5000, 5000), pin(5100, 5050)])).toBe(1);
  });

  it("leaves well-spread pins alone", () => {
    expect(crowdedPairs([pin(0, 0), pin(9000, 9000), pin(0, 9000)])).toBe(0);
  });

  it("counts every crowded pair, not just the first", () => {
    expect(crowdedPairs([pin(5000, 5000), pin(5050, 5000), pin(5100, 5000)])).toBe(3);
  });
});
