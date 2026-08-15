import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const VARIANTS: Record<Variant, string> = {
  neutral: "border-border bg-surface-subtle text-muted",
  brand: "border-brand/25 bg-brand-subtle text-brand",
  success: "border-success/25 bg-success-subtle text-success-text",
  warning: "border-warning/25 bg-warning-subtle text-warning-text",
  danger: "border-danger/25 bg-danger-subtle text-danger-text",
  info: "border-info/25 bg-info-subtle text-info-text",
};

export interface BadgeProps {
  variant?: Variant;
  dot?: "solid" | "pulse";
  className?: string;
  title?: string;
  children: ReactNode;
}

export function Badge({ variant = "neutral", dot, className, title, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            dot === "pulse" && "animate-pulse",
          )}
        />
      )}
      {children}
    </span>
  );
}
