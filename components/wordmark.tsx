import { cn } from "@/lib/utils";

/**
 * The CAD Pillar wordmark. Monochrome, geometric — a set of columns (the
 * "pillar") in currentColor + the name. Functional brand identity, not
 * decoration; inherits text colour so it works in light and dark.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
        <rect x="1" y="2" width="2.5" height="12" rx="0.5" />
        <rect x="6.75" y="2" width="2.5" height="12" rx="0.5" />
        <rect x="12.5" y="2" width="2.5" height="12" rx="0.5" />
      </svg>
      <span>
        The CAD <span className="text-primary">Pillar</span>
      </span>
    </span>
  );
}
