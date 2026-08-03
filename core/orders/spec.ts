/**
 * The brief, in application terms: units, conversions, and the checks a form
 * can run before it asks the database anything.
 *
 * UNITS. Lengths are integers in MICRONS, carat weights integers in
 * THOUSANDTHS of a carat, matching the columns. The same rule as money, for the
 * same reason: 1.3 is not representable in binary floating point, and these
 * numbers decide whether a seat can physically be cut. Conversion happens here,
 * once, at the edge — never scattered through components.
 *
 * The validation below MIRRORS the database's constraints; it does not replace
 * them. The database is authoritative and will refuse a bad brief regardless.
 * The point of having it twice is that a person filling in a form should be
 * told what is missing while they are still looking at the field, rather than
 * by an error after a round trip that lost their answers.
 */

/* ------------------------------------------------------------------ units -- */

const MICRONS_PER_MM = 1000;
const MCT_PER_CARAT = 1000;

export function mmToMicrons(mm: number): number {
  return Math.round(mm * MICRONS_PER_MM);
}

export function micronsToMm(um: number): number {
  return um / MICRONS_PER_MM;
}

export function caratToMct(ct: number): number {
  return Math.round(ct * MCT_PER_CARAT);
}

export function mctToCarat(mct: number): number {
  return mct / MCT_PER_CARAT;
}

/** For display: "6.50 mm". Two decimals is the precision the trade quotes in. */
export function formatMm(um: number): string {
  return `${micronsToMm(um).toFixed(2)} mm`;
}

/** For display: "0.75 ct". */
export function formatCarat(mct: number): string {
  return `${mctToCarat(mct).toFixed(2)} ct`;
}

/* ------------------------------------------------------- weight estimates -- */

/**
 * Approximate carat weight from millimetre dimensions, and back.
 *
 * WHY THIS IS AN ESTIMATE AND MUST BE LABELLED AS ONE. Weight depends on the
 * cut's actual depth and girdle thickness, which a client asking "how many
 * carats is a 6.5mm round?" does not have. The industry formulae here get
 * within a few percent for well-cut stones and are what every trade calculator
 * uses — but a certified stone's real weight is on its certificate, and this
 * must never overwrite it.
 *
 * The shape factors are the standard ones: diameter² × depth × factor.
 */
const SHAPE_FACTOR: Record<string, number> = {
  ROUND: 0.0061,
  OVAL: 0.0062,
  CUSHION: 0.00815,
  PRINCESS: 0.0083,
  EMERALD: 0.0092,
  PEAR: 0.00615,
  MARQUISE: 0.00565,
  RADIANT: 0.0081,
  ASSCHER: 0.0080,
  HEART: 0.0059,
  TRILLION: 0.0057,
  BAGUETTE: 0.00915,
};

/** Typical depth as a fraction of width, used when depth is unknown. */
const DEPTH_RATIO = 0.62;

/**
 * Estimated weight in millicarats, or null when the shape is unknown to us or
 * the dimensions are not enough to say anything.
 */
export function estimateMct(
  shape: string,
  lengthUm: number | null,
  widthUm: number | null,
  depthUm: number | null,
): number | null {
  const factor = SHAPE_FACTOR[shape];
  if (!factor || !lengthUm || !widthUm) return null;

  const l = micronsToMm(lengthUm);
  const w = micronsToMm(widthUm);
  const d = depthUm ? micronsToMm(depthUm) : w * DEPTH_RATIO;

  const carats = l * w * d * factor;
  return Math.round(carats * MCT_PER_CARAT);
}

/**
 * The reverse: a plausible round-stone diameter for a given weight.
 *
 * Only offered for shapes with a fixed aspect ratio in practice — asking "how
 * wide is a 1ct pear?" has no single answer, because a pear can be long and
 * narrow or short and wide at the same weight. Returning a confident number
 * there would be inventing information.
 */
export function estimateDiameterUm(shape: string, mct: number): number | null {
  if (shape !== "ROUND" && shape !== "ASSCHER" && shape !== "PRINCESS") return null;
  const factor = SHAPE_FACTOR[shape];
  if (!factor || mct <= 0) return null;

  // carats = d * d * (d * DEPTH_RATIO) * factor  ->  d = cbrt(carats / (factor * ratio))
  const carats = mctToCarat(mct);
  const d = Math.cbrt(carats / (factor * DEPTH_RATIO));
  return mmToMicrons(d);
}

/* --------------------------------------------------------------- checking -- */

export interface OrderSpecInput {
  referenceName: string;
  product: string;
  metal: string;
  karatage: string;
  purpose: string;
  format: string;
  finish: string;
  hasCentreStone: boolean;
  centreShape?: string | null;
  centreLengthUm?: number | null;
  centreWidthUm?: number | null;
  centreDepthUm?: number | null;
  centreCaratMct?: number | null;
  centreQuantity?: number;
  centreSetting?: string | null;
  basedOnOrderId?: string | null;
  changeSummary?: string | null;
}

export interface SpecProblem {
  /** Which input to put the message next to, and to focus on submit. */
  field: string;
  message: string;
}

/**
 * Everything wrong with a brief, as field-addressed messages.
 *
 * Returns them all at once rather than stopping at the first: a form that
 * reveals its problems one at a time turns a two-minute task into six round
 * trips.
 */
export function specProblems(input: OrderSpecInput): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const need = (field: string, value: unknown, message: string) => {
    if (value === null || value === undefined || value === "") {
      problems.push({ field, message });
    }
  };

  if (!input.referenceName?.trim()) {
    problems.push({ field: "referenceName", message: "Give this job a name you'll recognise." });
  } else if (input.referenceName.length > 120) {
    problems.push({ field: "referenceName", message: "Keep the name under 120 characters." });
  }

  need("product", input.product, "Tell us what we're modelling.");
  need("metal", input.metal, "Pick a metal colour.");
  need("karatage", input.karatage, "Give the karatage or alloy.");
  need("purpose", input.purpose, "Say what the CAD is for — it sets the wall thickness.");
  need("format", input.format, "Choose an output format.");
  need("finish", input.finish, "Choose a finish.");

  if (input.hasCentreStone) {
    need("centreShape", input.centreShape, "Pick the stone's shape.");
    need("centreSetting", input.centreSetting, "Say how the stone is held.");

    if ((input.centreQuantity ?? 0) < 1) {
      problems.push({ field: "centreQuantity", message: "How many of this stone?" });
    }

    // Either measurement route is enough; the app converts and shows both.
    const hasDims = Boolean(input.centreLengthUm && input.centreWidthUm);
    if (!hasDims && !input.centreCaratMct) {
      problems.push({
        field: "centreSize",
        message: "Give either the millimetre size or the carat weight.",
      });
    }

    // Deliberately generous at both ends — the point is to catch a misplaced
    // decimal point, not to second-guess an unusual commission.
    for (const [field, value] of [
      ["centreLengthUm", input.centreLengthUm],
      ["centreWidthUm", input.centreWidthUm],
    ] as const) {
      if (value && (value < 500 || value > 60000)) {
        problems.push({
          field,
          message: "That's outside anything we can cut a seat for — check the decimal point.",
        });
      }
    }
  }

  // Basing a job on an earlier one without saying what differs leaves the
  // designer to guess which parts of the old brief still apply.
  if (input.basedOnOrderId && !input.changeSummary?.trim()) {
    problems.push({
      field: "changeSummary",
      message: "Describe what changes. The original brief travels with it.",
    });
  }
  if (!input.basedOnOrderId && input.changeSummary?.trim()) {
    problems.push({
      field: "basedOnOrderId",
      message: "Pick the order this is based on, or clear the description of changes.",
    });
  }

  return problems;
}

/** True when the brief is complete enough to submit. */
export function specIsComplete(input: OrderSpecInput): boolean {
  return specProblems(input).length === 0;
}
