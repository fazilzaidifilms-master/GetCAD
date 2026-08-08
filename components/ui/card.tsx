import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The surface every panel in the app was already drawing by hand.
 *
 * Before this, "a card" was a border, a radius and a padding retyped in a dozen
 * files, which is how a radius ends up different on one screen and nobody
 * notices for a month. Nothing here is new behaviour — it is the same surface,
 * named once.
 *
 * Padding and radius come from tokens, so a card is roomy on a client screen
 * and tight on a staff one without either screen asking for it.
 */
/**
 * `as` exists so a card can still be a `<section>` or an `<article>` where the
 * screen means one. Landmarks are not decoration — they are how a screen reader
 * user skips between the nine panels on an order — and a shared surface should
 * not cost a page its semantics. A plain element override rather than a Slot,
 * because this project has no Radix and one prop does not justify adding it.
 */
type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside";
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, as: Tag = "div", ...props }, ref) => (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(
        "rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

/** Title row. `aside` sits opposite — a status, a count, an action. */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border",
        "px-[var(--s-5)] py-[var(--s-4)]",
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn(
        "text-[length:var(--fs-4)] font-semibold leading-[var(--lh-4)] tracking-[var(--ls-4)]",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-[var(--s-5)]", className)} {...props} />
  ),
);
CardBody.displayName = "CardBody";

export { Card, CardHeader, CardTitle, CardBody };
