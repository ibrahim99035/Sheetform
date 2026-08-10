import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">Sheetform</h1>
          <p className="mt-1 text-sm text-neutral-500">
            CSV &amp; Excel analytics
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          {children}
        </div>
        <div className="mt-4 text-center text-sm text-neutral-500">
          <Link href="/" className="hover:underline">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
