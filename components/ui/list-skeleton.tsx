import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

// Shared loading skeletons for route segments. Rendered by loading.tsx
// files so navigations show instant structure instead of a frozen page.

export function ListHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-5 w-8 rounded-full" />
      </div>
      {action && <Skeleton className="h-9 w-28 rounded-lg" />}
    </div>
  );
}

export function ListRowsSkeleton({
  rows = 6,
  withBadge = true,
}: {
  rows?: number;
  withBadge?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <ul className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5 sm:py-3.5">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3 max-w-56" />
              <Skeleton className="h-3 w-1/2 max-w-72" />
            </div>
            {withBadge && <Skeleton className="h-5 w-16 shrink-0 rounded-full" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ListPageSkeleton({
  rows,
  withBadge,
  action,
}: {
  rows?: number;
  withBadge?: boolean;
  action?: boolean;
}) {
  return (
    <div className={cn("animate-fade-in")}>
      <ListHeaderSkeleton action={action} />
      <ListRowsSkeleton rows={rows} withBadge={withBadge} />
    </div>
  );
}
