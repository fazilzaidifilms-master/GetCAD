import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <main className="container max-w-5xl py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-4 w-20" />
      </div>

      <div className="mt-6 space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-3 w-6" />
            </div>
            <div className="space-y-0">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-14 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
