import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function buttonClasses(variant: Variant = "secondary", size: Size = "md") {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-150",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
  );
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-contrast shadow-sm shadow-brand/25 hover:bg-brand-hover",
  secondary:
    "border border-border bg-surface text-muted hover:bg-surface-subtle hover:text-foreground",
  ghost: "text-muted hover:bg-surface-subtle hover:text-foreground",
  danger:
    "border border-danger/20 bg-danger-subtle text-danger-text hover:bg-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-9 gap-2 rounded-lg px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClasses(variant, size), className)}
      {...props}
    />
  );
});
