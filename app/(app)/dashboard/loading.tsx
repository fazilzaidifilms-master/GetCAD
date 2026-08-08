import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main className="container max-w-3xl py-8">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-5 w-24" />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)]">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-5 w-48" />
        </div>
        <div className="rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)] p-[var(--s-5)]">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-7 w-10" />
        </div>
      </div>

      <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-card shadow-[var(--e-1)]">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </main>
  );
}
