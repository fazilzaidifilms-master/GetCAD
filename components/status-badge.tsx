import { statusMeta } from "@/core";
import { TONE_SURFACE } from "@/lib/tone";
import { cn } from "@/lib/utils";

/**
 * The order status, as a chip. The most-read element in the product.
 *
 * Colour carries information here, never mood, and it is never carrying it
 * alone — the label is always present, so the five families stay safe for the
 * roughly one man in twelve who cannot separate the red one from the green one.
 *
 * What the tones look like lives in `lib/tone`, which reads the tokens; which
 * tone a status IS lives in `core/orders/status`. Neither decision is made
 * here, which is why seventeen statuses now reliably render as five colours.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { label, tone } = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--r-full)] border px-2.5 py-1",
        // 13px at the comfortable density, 11px at the compact one — the same
        // step every other micro-label in the app uses, rather than a fixed
        // fixed pixel size that ignores which density it is standing in.
        "text-[length:var(--fs-1)] font-medium leading-[var(--lh-1)] tracking-[var(--ls-1)]",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {/* currentColor, so the dot cannot drift out of family when the text
          colour is retuned. */}
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        aria-hidden
      />
      {label}
    </span>
  );
}
