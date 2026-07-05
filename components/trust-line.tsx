import { cn } from "@/lib/utils";

// Persistent trust guarantees, shown where the double-blind + audit posture is
// relevant. Static, non-decorative — it states facts the system enforces.
const GUARANTEES = [
  "Designer identity protected",
  "All actions logged",
  "Independent QC required",
];

export function TrustLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {GUARANTEES.map((g, i) => (
        <span key={g} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
          <span className="inline-flex items-center gap-1">
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {g}
          </span>
        </span>
      ))}
    </div>
  );
}
