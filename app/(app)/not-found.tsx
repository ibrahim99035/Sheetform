import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-subtle text-brand">
        <FileQuestion className="h-8 w-8" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
      <p className="mt-2 text-lg text-muted">This page could not be found.</p>
      <div className="mt-8 flex items-center gap-3">
        <Link href="/datasets" className={buttonClasses("primary", "md")}>
          Go to datasets
        </Link>
        <Link href="/" className={buttonClasses("secondary", "md")}>
          Home
        </Link>
      </div>
    </div>
  );
}
