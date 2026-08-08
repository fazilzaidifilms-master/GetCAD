import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>`, dressed to match `Input`.
 *
 * WHY STILL NATIVE. A custom listbox is the usual next step and it would be the
 * wrong one here. The native control opens the platform's own picker — the iOS
 * wheel, Android's sheet — which is the thing this audience has used ten
 * thousand times, works with the OS text-size setting, and cannot be broken by
 * our JavaScript failing to load. The brief wizard already reaches for radio
 * pills (`Choice`) wherever a choice carries a consequence someone should weigh
 * side by side; this is for the rest, where a dropdown is genuinely right.
 *
 * WHAT WAS WRONG. Three of the five selects in the app were `h-9` — a fixed
 * 36px, below the 44px every platform asks of a touch target and 12px shorter
 * than the `Input` sitting next to them. On the upload form that meant a
 * file-kind chooser visibly smaller than the button beside it, which is the
 * single most "unfinished" thing a form can do.
 *
 * `appearance-none` plus our own chevron, because the default arrow is drawn by
 * the OS and looks like neither the light theme nor the dark one. The chevron
 * is `currentColor` so it follows the text, and `pointer-events-none` so it is
 * never the thing that swallows the click.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-[var(--ctl)] w-full appearance-none rounded-[var(--r-md)] border border-input bg-background",
        // Right padding clears the chevron; without it a long option runs
        // underneath and reads as a rendering fault.
        "pl-3.5 pr-10 text-[length:var(--fs-3)] shadow-sm",
        "transition-colors duration-[var(--dur-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
));
Select.displayName = "Select";

/**
 * A checkbox you can actually hit.
 *
 * The one in the brief was `h-4 w-4` — 16px, on a form where ticking it is how
 * you tell us a stone is certified. `--ctl-icon` is 44px comfortable, so the
 * box grows to 20px and the tappable area around it reaches the platform
 * minimum via the label that wraps it.
 *
 * `accent-color` rather than a hand-built box: it recolours the native control
 * to our accent in one line and keeps the platform's own checked state,
 * indeterminate rendering, and high-contrast-mode behaviour intact.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "h-5 w-5 shrink-0 cursor-pointer rounded-[var(--r-xs)] border-input",
      "accent-[hsl(var(--primary))]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

export { Select, Checkbox };
