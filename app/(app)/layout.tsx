import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/datasets" className="text-lg font-semibold text-neutral-900">
              Sheetform
            </Link>
            <nav className="flex items-center gap-4 text-sm text-neutral-600">
              <Link href="/datasets" className="hover:text-neutral-900">
                Datasets
              </Link>
              <Link href="/datasets/new" className="hover:text-neutral-900">
                + New dataset
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-500 sm:inline">
              {user?.email}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}