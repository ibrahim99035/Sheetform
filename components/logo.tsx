import { Table2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Logo({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-700 text-brand-contrast shadow-sm shadow-brand/30">
        <Table2 className="h-4 w-4" />
      </span>
      {!iconOnly && (
        <span className="hidden min-[360px]:inline text-[15px] font-semibold tracking-tight text-foreground">
          Sheetform
        </span>
      )}
    </span>
  );
}
