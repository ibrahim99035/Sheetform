import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function PrivacyPage() {
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

      <div className="flex flex-1 flex-col px-6 py-16">
        <article className="mx-auto max-w-2xl prose prose-sm prose-headings:text-foreground prose-p:text-muted prose-li:text-muted">
          <h1>Privacy Policy</h1>
          <p className="lead">Last updated: August 2026</p>

          <h2>1. Data processing</h2>
          <p>
            SiroQ processes your uploaded spreadsheet files entirely in your web browser
            using DuckDB-WASM. No file data is transmitted to our servers during analysis.
            Files are stored in your Supabase project&apos;s storage bucket, accessible only
            to your authenticated account.
          </p>

          <h2>2. Data storage</h2>
          <p>
            Your data is stored in your own Supabase project database. We do not have
            access to your Supabase project unless you explicitly grant it. Row-level
            security (RLS) ensures that only you can access your datasets.
          </p>

          <h2>3. Authentication</h2>
          <p>
            Authentication is handled by Supabase Auth. We store your email address and
            a hashed password. We never see or store your password in plain text.
          </p>

          <h2>4. Analytics and tracking</h2>
          <p>
            We use Sentry for error monitoring. Sentry may collect browser metadata
            (browser type, OS, page URL) when an error occurs. No personal data or
            spreadsheet content is sent to Sentry.
          </p>

          <h2>5. Third-party services</h2>
          <ul>
            <li><strong>Supabase</strong> — database, authentication, and file storage</li>
            <li><strong>Sentry</strong> — error monitoring</li>
          </ul>

          <h2>6. Your rights</h2>
          <p>
            You can delete your account and all associated data at any time by contacting
            us. You can also export your data at any time using the built-in export feature.
          </p>

          <h2>7. Contact</h2>
          <p>
            For privacy-related inquiries, contact us at{" "}
            <a href="mailto:support@siroq.com">support@siroq.com</a>.
          </p>
        </article>

        <div className="mt-10 text-center text-sm text-muted">
          <Link href="/" className="transition hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
