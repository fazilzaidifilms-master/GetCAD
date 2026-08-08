import { cn } from "@/lib/utils";

export interface Step {
  label: string;
}

/** Horizontal step indicator for a linear flow (onboarding, wizards). */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: Step[];
  current: number;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex items-center gap-2 text-[length:var(--fs-3)] leading-[var(--lh-3)]",
        className,
      )}
      aria-label="Progress"
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.label} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[length:var(--fs-2)] leading-[var(--lh-2)] font-medium",
                done
                  ? "bg-primary text-primary-foreground"
                  : active
                    ? "border-2 border-primary text-primary"
                    : "border border-border text-muted-foreground",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
