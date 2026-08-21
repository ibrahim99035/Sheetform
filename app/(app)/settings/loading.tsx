import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="space-y-3 p-4">
            <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
            <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
