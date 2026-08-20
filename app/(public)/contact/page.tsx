import Link from "next/link";
import { Mail, MessageSquare } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ContactPage() {
  return (
    <main className="relative flex min-h-full flex-1 flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="SiroQ">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login" className="text-sm text-muted transition hover:text-foreground">
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center px-6 py-16">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-subtle text-brand">
          <MessageSquare className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Contact us</h1>
        <p className="mt-3 max-w-md text-center text-muted">
          Have a question about SiroQ or need help with your pharmacy analytics?
          Reach out and we&apos;ll get back to you.
        </p>

        <div className="mt-10 w-full max-w-md space-y-4">
          <a
            href="mailto:support@siroq.com"
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/30 hover:shadow-sm"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <Mail className="h-6 w-6" />
            </span>
            <div>
              <p className="font-medium text-foreground">Email us</p>
              <p className="text-sm text-muted">support@siroq.com</p>
            </div>
          </a>
        </div>

        <div className="mt-10 text-center text-sm text-muted">
          <Link href="/" className="transition hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
