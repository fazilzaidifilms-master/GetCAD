import type { StatusTone } from "@/core";

/**
 * The five status families, as classes.
 *
 * WHY THIS EXISTS. `core/orders/status.ts` decides which of five tones a status
 * is; `app/globals.css` decides what those five look like. Between them sat
 * nothing, so five different files each wrote out their own class string and
 * each drifted: a 5% fill in the timeline and a 10% fill in the badge, /25
 * borders in one place and /30 in another, `emerald-700` here and
 * `emerald-600` there. Seventeen statuses were being drawn in rather more than
 * five ways, which is the exact thing the five-tone mapping exists to prevent.
 *
 * This is the missing middle: one string per family, read from tokens, so a
 * change to what "attention" looks like is a change to two lines of CSS.
 *
 * `color:` is spelled out in the arbitrary values on purpose — `border-[…]` is
 * ambiguous between a width and a colour, and Tailwind guesses.
 */

/** Pale fill + readable text + a soft edge. For badges and milestone panels. */
export const TONE_SURFACE: Record<StatusTone, string> = {
  neutral:
    "bg-[color:var(--tone-neutral-bg)] text-[color:var(--tone-neutral-fg)] border-[color:var(--tone-neutral-line)]",
  info: "bg-[color:var(--tone-info-bg)] text-[color:var(--tone-info-fg)] border-[color:var(--tone-info-line)]",
  attention:
    "bg-[color:var(--tone-attention-bg)] text-[color:var(--tone-attention-fg)] border-[color:var(--tone-attention-line)]",
  success:
    "bg-[color:var(--tone-success-bg)] text-[color:var(--tone-success-fg)] border-[color:var(--tone-success-line)]",
  danger:
    "bg-[color:var(--tone-danger-bg)] text-[color:var(--tone-danger-fg)] border-[color:var(--tone-danger-line)]",
};

/** Text only, on the page's own background. For a line of prose that reports state. */
export const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-[color:var(--tone-neutral-fg)]",
  info: "text-[color:var(--tone-info-fg)]",
  attention: "text-[color:var(--tone-attention-fg)]",
  success: "text-[color:var(--tone-success-fg)]",
  danger: "text-[color:var(--tone-danger-fg)]",
};

/** A solid dot or marker in the family's colour, for use outside a toned surface. */
export const TONE_MARK: Record<StatusTone, string> = {
  neutral: "bg-[color:var(--tone-neutral-fg)]",
  info: "bg-[color:var(--tone-info-fg)]",
  attention: "bg-[color:var(--tone-attention-fg)]",
  success: "bg-[color:var(--tone-success-fg)]",
  danger: "bg-[color:var(--tone-danger-fg)]",
};
