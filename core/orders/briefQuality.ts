/**
 * How good is this brief, and what can a designer still not work out from it?
 *
 * THIS IS NOT VALIDATION. `specProblems` answers "is this submittable" — a
 * yes/no about required fields. This answers a harder and more useful question:
 * given everything you have told us, what would a designer still have to guess?
 *
 * The distinction matters because a brief can be completely valid and still
 * unbuildable without a phone call. "18K yellow, ring, casting, high polish,
 * one round centre stone at 1.00ct" passes every required field and does not
 * say how wide the stone actually is — and a carat weight is not a footprint.
 * The seat is cut to the outline, not to the weight.
 *
 * Every gap here was chosen on the same test: does a designer, looking at this
 * brief alone, have to stop and ask? If not, it is not a gap, however incomplete
 * the form looks.
 *
 * Framework-free, so the same grading runs in the wizard as the client types,
 * on the review screen, and anywhere staff need to know why a brief is thin.
 */

import type { OrderSpecInput } from "./spec";

export type GapSeverity = "blocking" | "ambiguity";

export interface BriefGap {
  /** What cannot be determined, in the designer's terms. */
  what: string;
  /** Why it matters — the consequence, not a restatement of the question. */
  why: string;
  severity: GapSeverity;
  /** Which step of the wizard fixes it. */
  field: string;
}

export type BriefGrade = "Incomplete" | "Workable" | "Good" | "Excellent";

export interface BriefQuality {
  /** 0–100. Not a percentage of fields filled — a percentage of certainty. */
  score: number;
  grade: BriefGrade;
  gaps: BriefGap[];
  /** How many required answers are still missing. Zero to submit. */
  blockingCount: number;
}

export interface BriefContext {
  accentRowCount: number;
  /** Reference images attached. The single strongest predictor of a good first version. */
  referenceImageCount: number;
  /** How many of those images carry at least one labelled pin. */
  pinnedImageCount: number;
}

/**
 * Penalties, in points. Deliberately uneven: these reflect how often each gap
 * actually causes a revision, not how many form fields it corresponds to.
 */
const PENALTY: Record<GapSeverity, number> = {
  blocking: 25,
  ambiguity: 12,
};

const KNOWN_KARATAGE = /^(9|10|14|18|22|24)\s*K|^(375|417|585|750|916|999)$|^PT\s*(900|950)$|^950\s*PT$|^SILVER$|^925$/i;

export function gradeBrief(spec: OrderSpecInput, ctx: BriefContext): BriefQuality {
  const gaps: BriefGap[] = [];
  const gap = (severity: GapSeverity, field: string, what: string, why: string) =>
    gaps.push({ severity, field, what, why });

  /* --- what the piece is ------------------------------------------------ */

  if (!spec.product) {
    gap("blocking", "product", "What kind of piece this is", "Everything else follows from it.");
  } else if (spec.product === "OTHER") {
    gap(
      "ambiguity",
      "notes",
      "What the piece actually is",
      "'Other' tells a designer nothing about proportions, wall thickness or how it is worn.",
    );
  }

  /* --- the stone -------------------------------------------------------- */

  if (spec.hasCentreStone) {
    if (!spec.centreShape) {
      gap("blocking", "centreShape", "The stone's shape", "The seat is cut to its outline.");
    }
    if (!spec.centreSetting) {
      gap(
        "blocking",
        "centreSetting",
        "How the stone is held",
        "A four-prong head and a bezel are two different builds, not a finishing choice.",
      );
    }

    const hasFootprint = Boolean(spec.centreLengthUm && spec.centreWidthUm);
    if (!hasFootprint && !spec.centreCaratMct) {
      gap(
        "blocking",
        "centreSize",
        "How big the stone is",
        "Nothing about the head can be modelled without it.",
      );
    } else if (!hasFootprint) {
      // The case that motivated this whole module: valid, and still unbuildable.
      gap(
        "ambiguity",
        "centreSize",
        "The stone's exact footprint",
        "A carat weight can be several different footprints depending on cut. The seat is cut to the outline, not to the weight.",
      );
    }

    // A certified stone is cut to no tolerance, so depth stops being optional.
    if (spec.centreCertified && !spec.centreDepthUm) {
      gap(
        "ambiguity",
        "centreDepthUm",
        "The certified stone's depth",
        "Certified dimensions are fixed, so the seat is cut with no tolerance either way — depth decides how deep it sits.",
      );
    }

    if ((spec.centreQuantity ?? 0) > 1) {
      gap(
        "ambiguity",
        "notes",
        "How the multiple centre stones are arranged",
        "Three stones in a row and three in a cluster share every answer in this brief and are different pieces.",
      );
    }
  }

  /* --- material --------------------------------------------------------- */

  if (spec.metal === "TWO_TONE" || spec.metal === "TRI_COLOUR") {
    gap(
      "ambiguity",
      "notes",
      "Which parts are which metal",
      "Two-tone without naming the parts is a decision the designer would be making for you.",
    );
  }

  if (spec.karatage && !KNOWN_KARATAGE.test(spec.karatage.trim())) {
    gap(
      "ambiguity",
      "karatage",
      "What alloy this actually is",
      "The value given is not one we recognise, and alloy decides minimum wall thickness.",
    );
  }

  if (spec.finish === "MIXED") {
    gap(
      "ambiguity",
      "notes",
      "Which surfaces get which finish",
      "'Mixed' names the fact of a contrast, not where it falls.",
    );
  }

  /* --- references ------------------------------------------------------- */
  //
  // The strongest single predictor of a first version coming back right, and
  // the reason the design puts pinning on its own step.

  if (ctx.referenceImageCount === 0) {
    gap(
      "ambiguity",
      "references",
      "What you want it to look like",
      "Words describe proportions badly. One photo of a sketch or a piece you like is usually enough.",
    );
  } else if (ctx.pinnedImageCount === 0) {
    gap(
      "ambiguity",
      "references",
      "Which part of the picture you mean",
      "Pictures with nothing marked are the most common reason a first version comes back wrong — the designer copies the wrong element.",
    );
  }

  /* --- revisions -------------------------------------------------------- */

  if (spec.basedOnOrderId && !spec.changeSummary?.trim()) {
    gap(
      "blocking",
      "changeSummary",
      "What differs from the original",
      "Otherwise the designer has to diff two briefs and guess which differences were intended.",
    );
  }

  /* --- score ------------------------------------------------------------ */

  const penalty = gaps.reduce((sum, g) => sum + PENALTY[g.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const blockingCount = gaps.filter((g) => g.severity === "blocking").length;

  return { score, grade: gradeFor(score, blockingCount), gaps, blockingCount };
}

/**
 * A brief with anything blocking outstanding is Incomplete regardless of score:
 * calling it "Good" because only one required answer is missing would be
 * telling someone their brief is nearly ready when it cannot be sent at all.
 */
function gradeFor(score: number, blockingCount: number): BriefGrade {
  if (blockingCount > 0) return "Incomplete";
  if (score >= 100) return "Excellent";
  if (score >= 76) return "Good";
  return "Workable";
}

/**
 * The one-line summary shown beside the grade.
 *
 * Says what it means for the person reading, not what the number is. "88%" on
 * its own invites gaming; "a designer can build this without asking you a
 * question" is the thing they actually want to be true.
 */
export function qualitySummary(q: BriefQuality): string {
  if (q.blockingCount > 0) {
    return `${q.blockingCount} required answer${q.blockingCount === 1 ? "" : "s"} still missing.`;
  }
  if (q.gaps.length === 0) {
    return "Nothing ambiguous. A designer can build this brief without asking you a question.";
  }
  return `Buildable, but ${q.gaps.length} thing${q.gaps.length === 1 ? "" : "s"} a designer would have to guess.`;
}
