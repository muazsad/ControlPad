import { Skeleton } from "@/components/ui/skeleton";

export function SummaryCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      <Skeleton className="mt-5 h-9 w-16" />
      <Skeleton className="mt-3 h-4 w-40" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <Skeleton className="h-5 w-36" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
