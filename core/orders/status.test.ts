import { describe, expect, it } from "vitest";

import { ORDER_STATUS_META, statusMeta } from "./status";

describe("statusMeta", () => {
  it("maps known statuses to a label + tone", () => {
    expect(statusMeta("IN_PROGRESS")).toEqual({ label: "In progress", tone: "info" });
    expect(statusMeta("DISPUTED").tone).toBe("danger");
    expect(statusMeta("APPROVED").tone).toBe("success");
    expect(statusMeta("CLIENT_PREVIEW").tone).toBe("attention");
  });

  it("every known status has a non-empty label and a valid tone", () => {
    const tones = ["neutral", "info", "attention", "success", "danger"];
    for (const [, meta] of Object.entries(ORDER_STATUS_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(tones).toContain(meta.tone);
    }
  });

  it("humanises unknown statuses as a neutral fallback (never throws)", () => {
    expect(statusMeta("SOME_NEW_STATE")).toEqual({ label: "Some new state", tone: "neutral" });
  });
});
