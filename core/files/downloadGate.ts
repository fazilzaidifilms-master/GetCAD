/**
 * Who may download the REAL file, and who only gets the preview.
 *
 * This is the rule the entire escrow model rests on. If a client can pull the
 * deliverable before approving it, the platform is holding money it has no
 * reason to hold and the designer has already been paid in kind. So it lives
 * here — one function, framework-free, unit-tested — rather than as a
 * condition inside whichever route happens to serve a file.
 *
 * The database enforces its own half (RLS decides which rows exist at all).
 * This decides which of the two artefacts a visible row hands over.
 */

/** What a viewer is being offered. */
export type FileGrant = "ORIGINAL" | "PREVIEW" | "NONE";

export interface DownloadContext {
  orderStatus: string;
  /** The viewer's app role. */
  role: string;
  isOrderClient: boolean;
  isOrderDesigner: boolean;
}

/**
 * Statuses at which the client has bought the file.
 *
 * DELIVERED is the moment staff release the files, and everything after it is
 * downstream of that. Note that APPROVED is NOT here: approving releases the
 * money, and delivery is the separate step where files change hands. Collapsing
 * the two would mean an approval — which is a judgement about a preview — also
 * silently handing over the asset.
 */
const CLIENT_MAY_HAVE_ORIGINAL = new Set(["DELIVERED", "CLOSED", "PAYOUT_RELEASED"]);

export function fileGrantFor(ctx: DownloadContext): FileGrant {
  // The designer made it. Withholding their own work from them would be absurd,
  // and they have the source file on their own machine regardless.
  if (ctx.isOrderDesigner) return "ORIGINAL";

  // QC cannot review a model they can only orbit. Checking wall thickness and
  // seat geometry is the job, and it needs the real geometry.
  if (ctx.role === "QC") return "ORIGINAL";

  // Ops handle delivery and disputes, and a dispute about the file is not
  // resolvable without the file.
  if (ctx.role === "OPS") return "ORIGINAL";

  if (ctx.isOrderClient) {
    return CLIENT_MAY_HAVE_ORIGINAL.has(ctx.orderStatus) ? "ORIGINAL" : "PREVIEW";
  }

  // SALES and FINANCE act on money and scheduling, not geometry. They can see
  // that an order has files without being handed the asset.
  if (ctx.role === "SALES" || ctx.role === "FINANCE") return "PREVIEW";

  // Anyone else visible to RLS but not covered above gets nothing. Failing
  // closed is the only safe default for a rule of this shape.
  return "NONE";
}

/**
 * The sentence shown where a client is offered a preview rather than the file.
 *
 * Says what they are looking at and what unlocks the rest, because "download
 * disabled" with no explanation reads as a bug and generates a support message
 * every time.
 */
export function grantExplanation(grant: FileGrant, orderStatus: string): string | null {
  if (grant !== "PREVIEW") return null;
  if (orderStatus === "CLIENT_PREVIEW") {
    return "You're viewing a preview — accurate in shape, deliberately too coarse to manufacture from. Approve the work and the full-resolution files are released.";
  }
  return "You're viewing a preview. The full-resolution files are released once the order is delivered.";
}
