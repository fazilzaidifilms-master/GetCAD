/**
 * Who may download which artefact, and when.
 *
 * This is the rule the entire escrow model rests on. If a client can pull the
 * deliverable before approving it, the platform is holding money it has no
 * reason to hold and the designer has already been paid in kind. So it lives
 * here — one function, framework-free, unit-tested — rather than as a condition
 * inside whichever route happens to serve a file.
 *
 * WHAT CHANGED, AND WHY. An earlier version of this file decided between the
 * real model and a decimated stand-in: the client would orbit a deliberately
 * coarse mesh, approve, and then receive the original. That is not the product.
 * A delivery is four render images, a gold weight chart and a diamond details
 * sheet; the client judges the work from those, and approval releases the STL,
 * the 3DM and the order summary sheet. There is no degraded model, because
 * there is no model before approval at all. So the axis this gate turns on is
 * not resolution, it is WHICH ARTEFACT — and that is why `file_kind` exists.
 *
 * The database enforces its own half: RLS decides which rows are visible to
 * this caller at all, and only participants and staff get that far. This
 * decides which of those visible rows actually hand over bytes.
 */

/** What a viewer is being offered for one specific file. */
export type FileGrant =
  /** Serve it. */
  | "ALLOW"
  /** It exists and it is theirs eventually, but not yet. Show the reason. */
  | "WITHHELD"
  /** Not theirs. Say nothing about it. */
  | "NONE";

/**
 * The kinds, mirroring the `file_kind` enum in 0030_file_kinds.sql.
 *
 * Kept as a plain union rather than imported from generated DB types so this
 * module stays free of any dependency; the migration and this file are checked
 * against each other by a test rather than by the type system.
 */
export type FileKind =
  | "CLIENT_REFERENCE"
  | "RENDER"
  | "WEIGHT_CHART"
  | "DIAMOND_DETAILS"
  | "STL"
  | "RHINO_3DM"
  | "SUMMARY_SHEET"
  | "OTHER";

export interface DownloadContext {
  orderStatus: string;
  /** The viewer's app role. */
  role: string;
  isOrderClient: boolean;
  isOrderDesigner: boolean;
  /** Did this viewer upload this exact file? */
  isUploader: boolean;
  fileKind: FileKind;
}

/**
 * The review set: what the client is asked to form a judgement from.
 *
 * Images and figures, not geometry. Nothing here can be sent to a mill, which
 * is precisely why it is safe to show before money is released.
 */
export const REVIEW_KINDS: readonly FileKind[] = ["RENDER", "WEIGHT_CHART", "DIAMOND_DETAILS"];

/**
 * The release set: what the client is actually buying.
 *
 * OTHER is here rather than in the review set on purpose. An unclassified file
 * is one nobody has vouched for, and the safe reading of "we don't know what
 * this is" is "don't hand it over yet".
 */
export const RELEASE_KINDS: readonly FileKind[] = ["STL", "RHINO_3DM", "SUMMARY_SHEET", "OTHER"];

const REVIEW = new Set<string>(REVIEW_KINDS);

/**
 * When the client may see the review set.
 *
 * CLIENT_PREVIEW is the status that exists for exactly this: the work has
 * cleared QC and is in front of the client. DISPUTED is included because a
 * client arguing about the work has to be able to point at it — and the review
 * set is images, so there is nothing to lose by showing them.
 */
const REVIEW_VISIBLE_TO_CLIENT = new Set([
  "CLIENT_PREVIEW",
  "APPROVED",
  "DELIVERED",
  "CLOSED",
  "PAYOUT_RELEASED",
  "DISPUTED",
]);

/**
 * When the client may have the deliverables.
 *
 * APPROVED, not DELIVERED. Approval is the client saying the work is right, and
 * it is the moment the escrow releases; making them wait for a separate staff
 * action to receive what they have already paid for adds a manual step to the
 * happy path and a support message every time it is slow.
 *
 * DISPUTED is deliberately ABSENT. If disputing released the files, the cheapest
 * way to get an STL for free would be to dispute instead of approve — the escrow
 * would be defending against a client who already has what they came for. A
 * client who disputes AFTER approving has the files already; one who disputes
 * instead of approving does not, and that asymmetry is the point.
 *
 * REFUNDED and CANCELLED are absent for the obvious reason: the sale did not
 * happen.
 */
const RELEASE_VISIBLE_TO_CLIENT = new Set(["APPROVED", "DELIVERED", "CLOSED", "PAYOUT_RELEASED"]);

export function fileGrantFor(ctx: DownloadContext): FileGrant {
  // Your own upload. Withholding someone's file from the person who supplied it
  // is never right, and this also stops a client's own attachment being caught
  // by the release rule below.
  if (ctx.isUploader) return "ALLOW";

  // The designer made it. Withholding their own work from them would be absurd,
  // and they have the source file on their own machine regardless.
  if (ctx.isOrderDesigner) return "ALLOW";

  // QC cannot review a model they can only look at pictures of. Checking wall
  // thickness and stone seats is the job, and it needs the real geometry.
  if (ctx.role === "QC") return "ALLOW";

  // Ops handle delivery and disputes, and a dispute about a file is not
  // resolvable without the file.
  if (ctx.role === "OPS") return "ALLOW";

  if (ctx.isOrderClient) {
    // Their own material, whoever uploaded the row.
    if (ctx.fileKind === "CLIENT_REFERENCE") return "ALLOW";

    if (REVIEW.has(ctx.fileKind)) {
      return REVIEW_VISIBLE_TO_CLIENT.has(ctx.orderStatus) ? "ALLOW" : "WITHHELD";
    }
    return RELEASE_VISIBLE_TO_CLIENT.has(ctx.orderStatus) ? "ALLOW" : "WITHHELD";
  }

  // SALES and FINANCE act on money and scheduling, not on the work. They can
  // see from the order that files exist without being handed one. If that turns
  // out to be too tight in practice — a salesperson wanting a render to talk a
  // client through — the fix is one line here, and it should be an explicit
  // decision rather than a side effect of a default.
  //
  // Anyone else visible to RLS but not covered above gets nothing. Failing
  // closed is the only safe default for a rule of this shape.
  return "NONE";
}

/**
 * The sentence shown where a file is listed but withheld.
 *
 * Says what unlocks it, because a greyed-out download with no explanation reads
 * as a bug and generates a support message every time.
 */
export function grantExplanation(grant: FileGrant, ctx: Pick<DownloadContext, "orderStatus" | "fileKind">): string | null {
  if (grant !== "WITHHELD") return null;

  if (REVIEW.has(ctx.fileKind)) {
    return "Not ready yet — the renders, weight chart and diamond details are released together once the work clears QC.";
  }
  if (ctx.orderStatus === "CLIENT_PREVIEW") {
    return "Approve the work and the STL, 3DM and order summary sheet are released straight away.";
  }
  if (ctx.orderStatus === "DISPUTED") {
    return "Files stay held while this order is under dispute. Resolving it releases them.";
  }
  return "The final files are released once you approve the work.";
}
