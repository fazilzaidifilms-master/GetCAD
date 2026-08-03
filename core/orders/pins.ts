/**
 * Pin coordinates.
 *
 * A pin is a point on a reference picture with a label — "this prong style",
 * "this band width" — and it is stored as integer BASIS POINTS of the image's
 * own dimensions rather than pixels or fractions.
 *
 * Not pixels, because the same pin must land in the same place on the client's
 * phone and on the designer's monitor. A pin is a position within the image,
 * not within one rendering of it.
 *
 * Not floats, for the reason nothing else in this schema is one: 0.1 has no
 * exact binary representation, so "is this the same pin?" stops being
 * answerable the moment two of them are compared.
 *
 * 0–10000 across and down. 10000 is the right or bottom edge, and a tenth of a
 * percent is far finer than a fingertip.
 */

export const BP_MAX = 10000;

export interface Pin {
  xBp: number;
  yBp: number;
  label: string;
}

/** Clamp into range and round. Both are needed at the edges of a tap target. */
function toBp(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(BP_MAX, Math.max(0, Math.round(fraction * BP_MAX)));
}

/**
 * A tap, in the element's own pixel space, converted to basis points.
 *
 * Takes the rectangle rather than reading it, so this stays framework-free and
 * testable without a DOM.
 */
export function pinFromTap(
  tapX: number,
  tapY: number,
  rect: { left: number; top: number; width: number; height: number },
): { xBp: number; yBp: number } {
  // A zero-sized rect means the image has not laid out yet. Dropping the pin in
  // the corner would be a silent wrong answer, so it goes to the centre, where
  // it is obviously wrong and obviously draggable.
  if (rect.width <= 0 || rect.height <= 0) return { xBp: BP_MAX / 2, yBp: BP_MAX / 2 };

  return {
    xBp: toBp((tapX - rect.left) / rect.width),
    yBp: toBp((tapY - rect.top) / rect.height),
  };
}

/** Percentage strings for CSS positioning. */
export function pinStyle(pin: { xBp: number; yBp: number }): { left: string; top: string } {
  return {
    left: `${(pin.xBp / BP_MAX) * 100}%`,
    top: `${(pin.yBp / BP_MAX) * 100}%`,
  };
}

/**
 * Problems with a set of pins, as messages.
 *
 * An unlabelled pin is a dot, and a dot is the ambiguity pins exist to remove —
 * so it is an error rather than a warning, and the database refuses it too.
 */
export function pinProblems(pins: Pin[]): string[] {
  const problems: string[] = [];

  const unlabelled = pins.filter((p) => !p.label.trim()).length;
  if (unlabelled > 0) {
    problems.push(
      `${unlabelled} pin${unlabelled === 1 ? " has" : "s have"} no label. A pin without one is just a dot.`,
    );
  }

  const tooLong = pins.filter((p) => p.label.length > 120).length;
  if (tooLong > 0) {
    problems.push(`${tooLong} label${tooLong === 1 ? " is" : "s are"} longer than 120 characters.`);
  }

  if (pins.length > 30) {
    problems.push("More than 30 pins on one picture. Consider splitting it across two.");
  }

  return problems;
}

/**
 * Two pins close enough that a designer cannot tell which label belongs to
 * which point.
 *
 * Not an error — someone may legitimately mark the prong and the girdle a
 * millimetre apart — but worth saying, because it looks fine while placing and
 * unreadable afterwards.
 */
export function crowdedPairs(pins: Pin[], thresholdBp = 300): number {
  let count = 0;
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      const a = pins[i]!;
      const b = pins[j]!;
      const dx = a.xBp - b.xBp;
      const dy = a.yBp - b.yBp;
      if (Math.hypot(dx, dy) < thresholdBp) count += 1;
    }
  }
  return count;
}
