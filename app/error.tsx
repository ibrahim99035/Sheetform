"use client";

import { AlertTriangle } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-danger-subtle text-danger">
        <AlertTriangle className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-muted">
        An unexpected error occurred. Please try again.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-faint">{error.digest}</p>
      )}
      <div className="mt-8">
        <button onClick={reset} className={buttonClasses("primary", "md")}>
          Try again
        </button>
      </div>
    </main>
  );
}
