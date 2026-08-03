import { describe, expect, it } from "vitest";

import { fileGrantFor, grantExplanation, type DownloadContext } from "./downloadGate";

const base: DownloadContext = {
  orderStatus: "CLIENT_PREVIEW",
  role: "CLIENT",
  isOrderClient: false,
  isOrderDesigner: false,
};

const grant = (o: Partial<DownloadContext>) => fileGrantFor({ ...base, ...o });

describe("fileGrantFor", () => {
  // The rule the escrow model rests on.
  it("gives a client only a preview before delivery", () => {
    for (const status of [
      "CLIENT_PREVIEW",
      "QC_REVIEW",
      "IN_PROGRESS",
      "APPROVED",
      "REVISION_REQUESTED",
    ]) {
      expect(grant({ isOrderClient: true, orderStatus: status })).toBe("PREVIEW");
    }
  });

  // Approving releases the MONEY. Delivery is the separate step where files
  // change hands, and collapsing the two would hand over the asset on a
  // judgement made about a preview.
  it("does not hand over the file merely because the work was approved", () => {
    expect(grant({ isOrderClient: true, orderStatus: "APPROVED" })).toBe("PREVIEW");
  });

  it("gives the client the real file from delivery onwards", () => {
    for (const status of ["DELIVERED", "CLOSED", "PAYOUT_RELEASED"]) {
      expect(grant({ isOrderClient: true, orderStatus: status })).toBe("ORIGINAL");
    }
  });

  it("never withholds a designer's own work from them", () => {
    expect(grant({ isOrderDesigner: true, role: "DESIGNER", orderStatus: "IN_PROGRESS" })).toBe(
      "ORIGINAL",
    );
  });

  // Checking wall thickness is the job; it cannot be done by orbiting.
  it("gives QC the real geometry", () => {
    expect(grant({ role: "QC", orderStatus: "QC_REVIEW" })).toBe("ORIGINAL");
  });

  it("gives Ops the real file, for delivery and disputes", () => {
    expect(grant({ role: "OPS", orderStatus: "DISPUTED" })).toBe("ORIGINAL");
  });

  it("gives Sales and Finance a preview only", () => {
    expect(grant({ role: "SALES" })).toBe("PREVIEW");
    expect(grant({ role: "FINANCE", orderStatus: "CLOSED" })).toBe("PREVIEW");
  });

  // Failing closed is the only safe default for a rule of this shape.
  it("gives nothing to a role it does not recognise", () => {
    expect(grant({ role: "SUPER_ADMIN" })).toBe("NONE");
    expect(grant({ role: "" })).toBe("NONE");
  });

  it("does not let another client's session through", () => {
    expect(grant({ role: "CLIENT", isOrderClient: false, orderStatus: "DELIVERED" })).toBe("NONE");
  });
});

describe("grantExplanation", () => {
  // "Download disabled" with no reason reads as a bug and generates a support
  // message every time.
  it("explains what unlocks the real file", () => {
    expect(grantExplanation("PREVIEW", "CLIENT_PREVIEW")).toMatch(/Approve the work/);
    expect(grantExplanation("PREVIEW", "IN_PROGRESS")).toMatch(/once the order is delivered/);
  });

  it("says nothing when there is nothing to explain", () => {
    expect(grantExplanation("ORIGINAL", "DELIVERED")).toBeNull();
    expect(grantExplanation("NONE", "DELIVERED")).toBeNull();
  });
});
