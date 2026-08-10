import type { DatasetStatus } from "@/lib/types";

const STYLES: Record<DatasetStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

const LABELS: Record<DatasetStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  error: "Error",
};

export function StatusBadge({ status }: { status: DatasetStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status === "processing" && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      )}
      {LABELS[status]}
    </span>
  );
}