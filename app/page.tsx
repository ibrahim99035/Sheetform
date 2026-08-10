import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/datasets");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-neutral-50 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
        Sheetform
      </h1>
      <p className="mt-4 max-w-xl text-lg text-neutral-600">
        Upload a CSV or Excel file, browse it in a fast virtualized table,
        analyze it with stats and charts, and transform it in place with full
        undo/redo.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}