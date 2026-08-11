import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-faint",
          "transition-colors hover:border-border-strong focus:border-brand focus:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
