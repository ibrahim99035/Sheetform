import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { DatasetStatus } from "@/lib/types";

const CONFIG: Record<
  DatasetStatus,
  { variant: NonNullable<BadgeProps["variant"]>; label: string; dot?: BadgeProps["dot"] }
> = {
  pending: { variant: "warning", label: "Pending", dot: "solid" },
  processing: { variant: "info", label: "Processing", dot: "pulse" },
  ready: { variant: "success", label: "Ready", dot: "solid" },
  error: { variant: "danger", label: "Error" },
};

export function StatusBadge({ status }: { status: DatasetStatus }) {
  const cfg = CONFIG[status];
  return (
    <Badge variant={cfg.variant} dot={cfg.dot}>
      {cfg.label}
    </Badge>
  );
}
