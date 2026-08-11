import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link href="/datasets" aria-label="Sheetform home">
              <Logo />
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/datasets"
                className="rounded-md px-3 py-2 text-muted transition hover:bg-surface-subtle hover:text-foreground sm:py-1.5"
              >
                Datasets
              </Link>
              <Link
                href="/datasets/new"
                aria-label="New dataset"
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition hover:bg-surface-subtle hover:text-foreground sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5"
              >
                <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">New dataset</span>
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {user?.email && (
              <span className="hidden items-center gap-2.5 text-sm text-muted sm:flex">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand">
                  {initial}
                </span>
                <span className="max-w-[180px] truncate">{user.email}</span>
              </span>
            )}
            <ThemeToggle />
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground sm:h-8"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
