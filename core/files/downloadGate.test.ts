import { describe, expect, it } from "vitest";

import {
  fileGrantFor,
  grantExplanation,
  RELEASE_KINDS,
  REVIEW_KINDS,
  type DownloadContext,
  type FileKind,
} from "./downloadGate";

const ALL_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "QUOTED",
  "PAYMENT_HELD",
  "ASSIGNED",
  "IN_PROGRESS",
  "DESIGNER_SUBMITTED",
  "QC_REVIEW",
  "REVISION_REQUESTED",
  "CLIENT_PREVIEW",
  "APPROVED",
  "DELIVERED",
  "CLOSED",
  "PAYOUT_RELEASED",
  "DISPUTED",
  "REFUNDED",
  "CANCELLED",
];

const ctx = (over: Partial<DownloadContext> = {}): DownloadContext => ({
  orderStatus: "IN_PROGRESS",
  role: "CLIENT",
  isOrderClient: false,
  isOrderDesigner: false,
  isUploader: false,
  fileKind: "STL",
  ...over,
});

const asClient = (status: string, fileKind: FileKind) =>
  fileGrantFor(ctx({ orderStatus: status, role: "CLIENT", isOrderClient: true, fileKind }));

describe("the kind sets", () => {
  it("do not overlap, and leave the client's own material out of both", () => {
    const covered = [...REVIEW_KINDS, ...RELEASE_KINDS];
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).not.toContain("CLIENT_REFERENCE");
  });

  // The one that matters: an unclassified file must not drift into the set the
  // client sees before paying for it.
  it("put the unclassified kind on the withheld side", () => {
    expect(RELEASE_KINDS).toContain("OTHER");
    expect(REVIEW_KINDS).not.toContain("OTHER");
  });
});

describe("the client before approval", () => {
  // This is the escrow. If any of these become ALLOW, approval is optional.
  it("never hands over a deliverable before APPROVED", () => {
    const beforeApproval = ALL_STATUSES.slice(0, ALL_STATUSES.indexOf("APPROVED"));
    for (const status of beforeApproval) {
      for (const kind of RELEASE_KINDS) {
        expect(asClient(status, kind), `${status}/${kind}`).toBe("WITHHELD");
      }
    }
  });

  it("shows the review set once the work reaches the client", () => {
    for (const kind of REVIEW_KINDS) {
      expect(asClient("CLIENT_PREVIEW", kind), kind).toBe("ALLOW");
    }
  });

  it("still withholds the review set while the work is in progress", () => {
    for (const kind of REVIEW_KINDS) {
      expect(asClient("IN_PROGRESS", kind), kind).toBe("WITHHELD");
      expect(asClient("QC_REVIEW", kind), kind).toBe("WITHHELD");
    }
  });

  it("releases the deliverables on APPROVED, not on DELIVERED", () => {
    for (const kind of RELEASE_KINDS) {
      expect(asClient("APPROVED", kind), kind).toBe("ALLOW");
    }
  });

  it("keeps the deliverables available downstream of approval", () => {
    for (const status of ["DELIVERED", "CLOSED", "PAYOUT_RELEASED"]) {
      for (const kind of RELEASE_KINDS) {
        expect(asClient(status, kind), `${status}/${kind}`).toBe("ALLOW");
      }
    }
  });

  // The exploit this closes: dispute instead of approving, and collect the STL
  // anyway. Disputing must be strictly worse than approving, never a shortcut.
  it("does not let a dispute stand in for an approval", () => {
    for (const kind of RELEASE_KINDS) {
      expect(asClient("DISPUTED", kind), kind).toBe("WITHHELD");
    }
    // But they can see what they are disputing — the review set is images.
    for (const kind of REVIEW_KINDS) {
      expect(asClient("DISPUTED", kind), kind).toBe("ALLOW");
    }
  });

  it("gives nothing back after a refund or a cancellation", () => {
    for (const status of ["REFUNDED", "CANCELLED"]) {
      for (const kind of [...REVIEW_KINDS, ...RELEASE_KINDS]) {
        expect(asClient(status, kind), `${status}/${kind}`).toBe("WITHHELD");
      }
    }
  });

  it("always returns the client their own reference material", () => {
    for (const status of ALL_STATUSES) {
      expect(asClient(status, "CLIENT_REFERENCE"), status).toBe("ALLOW");
    }
  });

  it("does not let another client's session through", () => {
    expect(fileGrantFor(ctx({ role: "CLIENT", isOrderClient: false, orderStatus: "DELIVERED" }))).toBe(
      "NONE",
    );
  });
});

describe("everyone else", () => {
  it("gives the designer their own work at every stage", () => {
    for (const status of ALL_STATUSES) {
      for (const kind of RELEASE_KINDS) {
        expect(
          fileGrantFor(
            ctx({ orderStatus: status, role: "DESIGNER", isOrderDesigner: true, fileKind: kind }),
          ),
          `${status}/${kind}`,
        ).toBe("ALLOW");
      }
    }
  });

  it("gives QC the real geometry — they cannot review a picture", () => {
    expect(fileGrantFor(ctx({ role: "QC", orderStatus: "QC_REVIEW", fileKind: "STL" }))).toBe("ALLOW");
    expect(fileGrantFor(ctx({ role: "QC", orderStatus: "QC_REVIEW", fileKind: "RHINO_3DM" }))).toBe(
      "ALLOW",
    );
  });

  it("gives OPS what they need to settle a dispute", () => {
    expect(fileGrantFor(ctx({ role: "OPS", orderStatus: "DISPUTED", fileKind: "STL" }))).toBe("ALLOW");
  });

  it("gives SALES and FINANCE no artefact at all", () => {
    for (const role of ["SALES", "FINANCE"]) {
      for (const kind of [...REVIEW_KINDS, ...RELEASE_KINDS]) {
        expect(
          fileGrantFor(ctx({ role, orderStatus: "DELIVERED", fileKind: kind })),
          `${role}/${kind}`,
        ).toBe("NONE");
      }
    }
  });

  // A row RLS let through but this function does not recognise is a row nobody
  // has reasoned about. NONE, not ALLOW.
  it("fails closed on an unrecognised role", () => {
    expect(fileGrantFor(ctx({ role: "SUPER_ADMIN", orderStatus: "CLOSED", fileKind: "RENDER" }))).toBe(
      "NONE",
    );
    expect(fileGrantFor(ctx({ role: "", orderStatus: "CLOSED", fileKind: "RENDER" }))).toBe("NONE");
  });

  // Staff can attach a summary sheet; they must not then lose access to it.
  it("returns anyone their own upload", () => {
    expect(
      fileGrantFor(
        ctx({ role: "SALES", orderStatus: "DRAFT", fileKind: "SUMMARY_SHEET", isUploader: true }),
      ),
    ).toBe("ALLOW");
  });
});

describe("grantExplanation", () => {
  it("says nothing when there is nothing to explain", () => {
    expect(grantExplanation("ALLOW", { orderStatus: "APPROVED", fileKind: "STL" })).toBeNull();
    // NONE means the viewer should not learn the file exists, so there is no
    // sentence to show them either.
    expect(grantExplanation("NONE", { orderStatus: "APPROVED", fileKind: "STL" })).toBeNull();
  });

  it("names approval as the unlock while the client is deciding", () => {
    expect(grantExplanation("WITHHELD", { orderStatus: "CLIENT_PREVIEW", fileKind: "STL" })).toMatch(
      /approve/i,
    );
  });

  it("explains a dispute hold rather than implying the files are gone", () => {
    expect(grantExplanation("WITHHELD", { orderStatus: "DISPUTED", fileKind: "STL" })).toMatch(
      /dispute/i,
    );
  });

  it("explains a not-yet review set without pinning it on the client", () => {
    expect(grantExplanation("WITHHELD", { orderStatus: "IN_PROGRESS", fileKind: "RENDER" })).toMatch(
      /QC/,
    );
  });
});
