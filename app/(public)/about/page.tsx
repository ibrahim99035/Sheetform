import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  Globe,
  MapPin,
  Package,
  Shield,
  TrendingUp,
  Trophy,
  Truck,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const SERVICES = [
  { icon: BarChart3, en: "Sales Analysis", ar: "تحليل البيع" },
  { icon: Package, en: "Inventory Analysis", ar: "تحليل المخزون" },
  { icon: Users, en: "Customer Analysis", ar: "تحليل العملاء" },
  { icon: Truck, en: "Supplier Analysis", ar: "تحليل الموردين" },
  { icon: MapPin, en: "Geographic Analysis", ar: "تحليل جغرافي" },
  { icon: Trophy, en: "Benchmarking", ar: "المقارنات المرجعية" },
  { icon: TrendingUp, en: "Forecasting", ar: "التنبؤ بالمبيعات" },
  { icon: Globe, en: "Financial Budgeting", ar: "الموازنات المالية" },
  { icon: ClipboardList, en: "Training", ar: "التدريب" },
];

export default function AboutPage() {
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
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            About SiroQ
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            SiroQ is a pharmaceutical analytics platform designed for consulting firms
            and pharmacy operators. We turn raw spreadsheet data into actionable
            insights — sales trends, inventory health, customer behaviour, supplier
            performance, and financial budgets — all in one place.
          </p>
          <p className="mt-3 text-base text-muted" dir="rtl">
            SiroQ هو منصة تحليلات صيدلانية مصممة لشركات الاستشارات والمشغّلين الصيدليين.
            نحوّل بيانات الجداول الخام إلى رؤى عملية — اتجاهات المبيعات، صحة المخزون،
            سلوك العملاء، أداء الموردين، والميزانيات المالية — كل ذلك في مكان واحد.
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-4xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-foreground">
            Our 9 services
          </h2>
          <p className="mt-2 text-center text-muted">
            Consulting, operational, and technical analytics — from sales to training.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {SERVICES.map((svc) => (
              <div
                key={svc.en}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <svc.icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{svc.en}</p>
                  <p className="text-xs text-muted" dir="rtl">{svc.ar}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Built for privacy
          </h2>
          <p className="mt-3 text-muted">
            Files are processed in your browser using DuckDB-WASM. Nothing leaves your
            device unless you choose to export. Your pharmacy data stays yours.
          </p>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm text-brand">
            <Shield className="h-4 w-4" />
            <span>Client-side processing with DuckDB-WASM</span>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-muted">
          <Link href="/" className="transition hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
