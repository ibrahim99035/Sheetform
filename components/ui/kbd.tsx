import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted">
      {children}
    </kbd>
  );
}
