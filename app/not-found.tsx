import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-subtle text-brand">
        <FileQuestion className="h-8 w-8" />
      </div>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
      <p className="mt-2 text-lg text-muted">This page could not be found.</p>
      <div className="mt-8 flex items-center gap-3">
        <Link href="/" className={buttonClasses("primary", "md")}>
          Go home
        </Link>
        <Link href="/login" className={buttonClasses("secondary", "md")}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
