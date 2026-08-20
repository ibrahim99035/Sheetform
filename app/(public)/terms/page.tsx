import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function TermsPage() {
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
          <h1>Terms of Service</h1>
          <p className="lead">Last updated: August 2026</p>

          <h2>1. Acceptance</h2>
          <p>
            By using SiroQ, you agree to these Terms of Service. If you do not agree,
            do not use the platform.
          </p>

          <h2>2. Service description</h2>
          <p>
            SiroQ is a pharmaceutical analytics platform that processes spreadsheet data
            to generate dashboards, forecasts, benchmarks, and reports. The platform is
            provided &quot;as is&quot; without warranties of any kind.
          </p>

          <h2>3. Your data</h2>
          <p>
            You retain full ownership of all data you upload to SiroQ. We do not sell,
            share, or use your data for any purpose other than providing the service to you.
          </p>

          <h2>4. Account responsibility</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account
            credentials and for all activities that occur under your account.
          </p>

          <h2>5. Acceptable use</h2>
          <p>
            You agree not to use SiroQ for any unlawful purpose, to attempt to gain
            unauthorized access to other accounts or systems, or to interfere with the
            platform&apos;s operation.
          </p>

          <h2>6. Limitation of liability</h2>
          <p>
            SiroQ and its operators shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from your use of the
            platform. Analytics outputs are for informational purposes and should not be
            the sole basis for business decisions.
          </p>

          <h2>7. Changes</h2>
          <p>
            We may update these terms from time to time. Continued use of the platform
            after changes constitutes acceptance of the updated terms.
          </p>

          <h2>8. Contact</h2>
          <p>
            For questions about these terms, contact us at{" "}
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
