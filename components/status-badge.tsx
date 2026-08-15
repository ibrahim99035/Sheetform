import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { DatasetStatus } from "@/lib/types";
import type { ApplicationStatus } from "@/lib/applications";

export type StatusValue = DatasetStatus | ApplicationStatus;

const CONFIG: Record<StatusValue, { variant: NonNullable<BadgeProps["variant"]>; label: string; dot?: BadgeProps["dot"] }> = {
  pending: { variant: "warning", label: "Pending", dot: "solid" },
  processing: { variant: "info", label: "Processing", dot: "pulse" },
  ready: { variant: "success", label: "Ready", dot: "solid" },
  error: { variant: "danger", label: "Error" },
  submitted: { variant: "info", label: "Submitted", dot: "solid" },
  archived: { variant: "neutral", label: "Archived" },
};

export function StatusBadge({ status }: { status: StatusValue }) {
  const cfg = CONFIG[status] ?? CONFIG.pending;
  return (
    <Badge variant={cfg.variant} dot={cfg.dot}>
      {cfg.label}
    </Badge>
  );
}