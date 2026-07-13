import { Skeleton } from "@/components/ui/skeleton";

export default function DesignerOnboardingLoading() {
  return (
    <main className="container max-w-2xl py-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-px w-6" />
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>

      <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    </main>
  );
}
