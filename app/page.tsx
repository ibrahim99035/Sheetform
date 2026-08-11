import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BarChart3, FileSpreadsheet, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClasses } from "@/components/ui/button";

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Upload & preview",
    description: "Drop a CSV or Excel file and confirm column types before anything imports.",
  },
  {
    icon: BarChart3,
    title: "Analyze",
    description: "Column statistics, group-by aggregations, and charts — computed in seconds.",
  },
  {
    icon: Undo2,
    title: "Transform safely",
    description: "Edit, filter, rename, and dedupe in place, with full undo and redo.",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/datasets");

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-background px-6 py-20 text-center">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Sheetform">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute bottom-[-12%] right-[-5%] h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
      </div>

      <div className="relative flex max-w-2xl animate-slide-up flex-col items-center">
        <div className="mb-7">
          <Logo />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          Your spreadsheets,
          <br className="hidden sm:block" />{" "}
          <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 bg-clip-text text-transparent">
            made instantly useful.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Upload a CSV or Excel file, browse it in a fast virtualized table, analyze it
          with stats and charts, and transform it in place with full undo/redo.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className={buttonClasses("primary", "md")}>
            Create account
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className={buttonClasses("secondary", "md")}>
            Sign in
          </Link>
        </div>
      </div>

      <div className="relative mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className="group animate-slide-up rounded-2xl border border-border bg-surface p-5 text-left shadow-sm shadow-black/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md hover:shadow-black/[0.05]"
            style={{ animationDelay: `${300 + i * 90}ms` }}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand transition-transform duration-200 group-hover:scale-110">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
            <p className="mt-1 text-sm text-muted">{f.description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
