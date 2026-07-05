import { statusMeta, type StatusTone } from "@/core";
import { cn } from "@/lib/utils";

// Functional status colour — carries information, not mood. Info reuses the single
// brand accent (in-flight); success/attention/danger are semantic status colours.
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/20",
  attention: "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-400",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-400",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
};

const DOT_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-primary",
  attention: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-destructive",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { label, tone } = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden />
      {label}
    </span>
  );
}
