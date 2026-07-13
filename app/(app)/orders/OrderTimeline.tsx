import { buildTimeline, type TimelineRawRow } from "@/core";
import { formatMoney } from "@/lib/money";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// Milestone box tone — success (QC passed) vs attention (revision requested).
// Same semantic colours as StatusBadge; here rendered as a filled panel because
// this is the flagship trust surface and must read as a discrete, labeled event.
const QC_TONE = {
  passed: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  revision_requested: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
} as const;

export function OrderTimeline({
  rows,
  currency,
}: {
  rows: TimelineRawRow[];
  currency: string;
}) {
  const steps = buildTimeline(rows);

  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-4">
      {steps.map((step) => {
        if (step.isQcMilestone && step.qcOutcome) {
          return (
            <li key={step.id} className="relative">
              <span
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background ${
                  step.qcOutcome === "passed" ? "bg-emerald-500" : "bg-amber-500"
                }`}
                aria-hidden
              />
              <div className={`rounded-md border p-3 ${QC_TONE[step.qcOutcome]}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">Independent QC review</p>
                  <time className="tabular shrink-0 font-mono text-xs opacity-80">
                    {formatWhen(step.createdAt)}
                  </time>
                </div>
                <p className="mt-0.5 text-sm">
                  {step.qcOutcome === "passed" ? "Passed" : "Revision requested"}
                </p>
                <p className="mt-1 text-xs opacity-75">Reviewed by role: QC · identity protected</p>
              </div>
            </li>
          );
        }

        return (
          <li key={step.id} className="relative">
            <span
              className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground/40 ring-4 ring-background"
              aria-hidden
            />
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm">
                {step.label}
                {step.amount != null && (
                  <span className="tabular ml-1.5 font-mono text-muted-foreground">
                    {formatMoney(step.amount, currency)}
                  </span>
                )}
              </p>
              <time className="tabular shrink-0 font-mono text-xs text-muted-foreground">
                {formatWhen(step.createdAt)}
              </time>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{step.actorRole}</p>
          </li>
        );
      })}
    </ol>
  );
}
