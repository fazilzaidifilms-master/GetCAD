import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * An amount of money.
 *
 * Every price, payout, commission and escrow balance in the application renders
 * through this. Two reasons it is a component rather than a call to
 * `formatMoney` at each site:
 *
 * 1. Amounts are integer MINOR units everywhere — paise, never rupees, never a
 *    float. Taking `minor` as the prop name makes the wrong thing awkward to
 *    pass, and there is exactly one place that divides by 100.
 * 2. Tabular figures. Money in a list must align on the decimal point, which
 *    means `font-variant-numeric: tabular-nums` on every amount, forever. One
 *    component that forgets it is a column that visibly wobbles.
 */
export function Money({
  minor,
  currency = "INR",
  className,
  /** Larger, heavier — for the one figure a screen is actually about. */
  emphasis = false,
}: {
  minor: number;
  currency?: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn("tabular", emphasis && "font-semibold", className)}
      // The unformatted value, for anything reading the DOM rather than looking
      // at it — and so a screen reader announces a number, not a glyph.
      data-minor={minor}
    >
      {formatMoney(minor, currency)}
    </span>
  );
}
