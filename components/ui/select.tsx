import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className={cn("relative", className)}>
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground",
          "transition-colors hover:border-border-strong focus:border-brand focus:outline-none",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
    </div>
  );
});
