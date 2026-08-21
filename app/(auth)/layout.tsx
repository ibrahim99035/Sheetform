import Link from "next/link";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-15%] h-[400px] w-[640px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" aria-label="SiroQ home">
            <Logo />
          </Link>
          <p className="mt-2 text-sm text-muted">CSV &amp; Excel analytics</p>
        </div>
        <div className="animate-scale-in rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-black/[0.04]">
          {children}
        </div>
        <div className="mt-4 text-center text-sm text-muted">
          <Link href="/" className="transition hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
