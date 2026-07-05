import { cn } from "@/lib/utils";

/** Specific, actionable error state — never a bare "something went wrong". */
export function ErrorPanel({
  title,
  message,
  className,
}: {
  title: string;
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-destructive/90">{message}</p>
    </div>
  );
}
