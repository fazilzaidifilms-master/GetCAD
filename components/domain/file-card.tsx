import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A deliverable file.
 *
 * Three things this is careful about, all of which are easy to get wrong once
 * per screen instead of once:
 *
 * 1. **It never links directly.** Access is a short-lived signed URL minted on
 *    request, so the card takes an `onGet` callback rather than an `href`. A
 *    plain link would be a URL that outlives the page it was rendered on.
 * 2. **It states the expiry.** People assume a download link is permanent and
 *    bookmark it. Saying "expires in 15 minutes" at the point of the click is
 *    the only place the message is actually read.
 * 3. **It shows the version.** Deliverables are versioned per order, and "which
 *    one did they approve" is a question the timeline has to be able to answer.
 */
const KB = 1024;

export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

/** The extension, uppercased, for the type chip. Falls back to "FILE". */
export function fileKind(name: string): string {
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase().slice(0, 5) : "FILE";
}

export function FileCard({
  name,
  sizeBytes,
  versionNo,
  when,
  onGet,
  pending = false,
  className,
}: {
  name: string;
  sizeBytes: number;
  versionNo?: number;
  /** Human-readable, already formatted — this component does no date maths. */
  when?: string;
  onGet?: () => void;
  pending?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--r-lg)] border border-border bg-card p-3",
        className,
      )}
      style={{ boxShadow: "var(--e-1)" }}
    >
      <span
        className="shrink-0 rounded-[var(--r-sm)] bg-muted px-2 py-1 font-mono text-[length:var(--fs-1)] tracking-[var(--ls-1)] text-muted-foreground"
        aria-hidden
      >
        {fileKind(name)}
      </span>

      <div className="min-w-0 flex-1">
        {/* Filenames are long and unbreakable; truncation is the norm, not the
            exception, so the full name stays available on hover and to a
            screen reader. */}
        <p className="truncate text-[length:var(--fs-4)] font-medium" title={name}>
          {name}
        </p>
        <p className="text-[length:var(--fs-2)] text-muted-foreground">
          {versionNo !== undefined ? `Version ${versionNo} · ` : ""}
          <span className="tabular">{formatBytes(sizeBytes)}</span>
          {when ? ` · ${when}` : ""}
        </p>
      </div>

      {onGet ? (
        <Button
          variant="outline"
          size="sm"
          className="min-h-[var(--ctl)] shrink-0"
          onClick={onGet}
          disabled={pending}
        >
          {pending ? "Preparing…" : "Get"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The standing note that belongs wherever files are listed.
 *
 * Both halves are load-bearing promises rather than decoration: the expiry is
 * why a link cannot be shared, and the stripping is part of the anonymity
 * guarantee — a 3DM carries its author in the file itself.
 */
export function FileNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-[length:var(--fs-2)] text-muted-foreground", className)}>
      Links expire 15 minutes after you tap Get. Authoring metadata is stripped from every file
      before storage.
    </p>
  );
}
