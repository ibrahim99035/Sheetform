import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Globe,
  GraduationCap,
  MapPin,
  Package,
  Shield,
  TrendingUp,
  Trophy,
  Truck,
  Undo2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClasses } from "@/components/ui/button";

const SERVICES = [
  {
    icon: BarChart3,
    nameEn: "Sales Analysis",
    nameAr: "تحليل البيع",
    descriptionEn: "Revenue, units, category mix, periods and product performance.",
    descriptionAr: "الإيرادات، الوحدات، مزيج التصنيفات، الفترات وأداء المنتجات.",
  },
  {
    icon: Package,
    nameEn: "Inventory Analysis",
    nameAr: "تحليل المخزون",
    descriptionEn: "ABC/XYZ classification, safety stock, expiry risk, dead stock, reorder.",
    descriptionAr: "تصنيف ABC/XYZ، مخزون الأمان، خطر انتهاء الصلاحية، المخزون الراكد.",
  },
  {
    icon: Users,
    nameEn: "Customer Analysis",
    nameAr: "تحليل العملاء",
    descriptionEn: "RFM segmentation, revenue concentration and repeat-purchase behaviour.",
    descriptionAr: "تقسيم RFM، تركيز الإيرادات وسلوك الشراء المتكرر.",
  },
  {
    icon: Truck,
    nameEn: "Supplier Analysis",
    nameAr: "تحليل الموردين",
    descriptionEn: "Spend by supplier, purchase history, price paid and concentration risk.",
    descriptionAr: "الإنفاق حسب المورد، سجل المشتريات، الأسعار المدفوعة وتركيز المخاطر.",
  },
  {
    icon: MapPin,
    nameEn: "Geographic Analysis",
    nameAr: "تحليل جغرافي",
    descriptionEn: "Sales, customers and stock by city / region / country on a map.",
    descriptionAr: "المبيعات والعملاء والمخزون حسب المدينة / المنطقة / الدولة على الخريطة.",
  },
  {
    icon: Trophy,
    nameEn: "Benchmarking",
    nameAr: "المقارنات المرجعية",
    descriptionEn: "Your pharmacy vs market averages — daily revenue, transactions, margins.",
    descriptionAr: "صيدليتك مقابل متوسطات السوق — الإيرادات اليومية، المعاملات، هوامش الربح.",
  },
  {
    icon: TrendingUp,
    nameEn: "Forecasting",
    nameAr: "التنبؤ بالمبيعات",
    descriptionEn: "Daily demand forecast with horizon and confidence band.",
    descriptionAr: "تنبؤ الطلب اليومي مع الأفق ونطاق الثقة.",
  },
  {
    icon: Globe,
    nameEn: "Financial Budgeting",
    nameAr: "الموازنات المالية",
    descriptionEn: "Budget vs actual by category and month: variance, burn rate, attainment.",
    descriptionAr: "الميزانية مقابل الفعلي حسب التصنيف والشهر: التباين، معدل الاستهلاك.",
  },
  {
    icon: ClipboardList,
    nameEn: "Training",
    nameAr: "التدريب",
    descriptionEn: "In-app lessons for every service — what data to send and how to read results.",
    descriptionAr: "دروس داخل التطبيق لكل خدمة — أي بيانات ترسلها وكيف تقرأ النتائج.",
  },
];

const FEATURES = [
  {
    icon: FileSpreadsheet,
    titleEn: "Upload & preview",
    titleAr: "رفع ومعاينة",
    descriptionEn: "Drop a CSV or Excel file and confirm column types before anything imports.",
    descriptionAr: "ارفع ملف CSV أو Excel وأكد أنواع الأعمدة قبل الاستيراد.",
  },
  {
    icon: BarChart3,
    titleEn: "Analyze",
    titleAr: "تحليل",
    descriptionEn: "Column statistics, group-by aggregations, and charts — computed in seconds.",
    descriptionAr: "إحصائيات الأعمدة، تجميعات حسب المجموعة، ورسوم بيانية — في ثوانٍ.",
  },
  {
    icon: Undo2,
    titleEn: "Transform safely",
    titleAr: "تحويل بأمان",
    descriptionEn: "Edit, filter, rename, and dedupe in place, with full undo and redo.",
    descriptionAr: "تعديل وتصفية وإعادة تسمية وإزالة التكرار مع التراجع والإعادة.",
  },
];

const HOW_STEPS = [
  {
    icon: Upload,
    stepEn: "1. Upload your data",
    stepAr: "١. ارفع بياناتك",
    descriptionEn: "Import CSV or Excel files from your pharmacy — sales, purchases, inventory, budgets, or stock counts.",
    descriptionAr: "استيراد ملفات CSV أو Excel من صيدليتك — مبيعات، مشتريات، مخزون، ميزانيات، أو جرد.",
  },
  {
    icon: CheckCircle2,
    stepEn: "2. Confirm column roles",
    stepAr: "٢. أكد أدوار الأعمدة",
    descriptionEn: "SiroQ detects column types automatically. You review and confirm — then the 9 services unlock.",
    descriptionAr: "يكتشف SiroQ أنواع الأعمدة تلقائياً. تراجع وتأكد — ثم تُفتح الخدمات التسع.",
  },
  {
    icon: Zap,
    stepEn: "3. Get actionable insights",
    stepAr: "٣. احصل على رؤى عملية",
    descriptionEn: "Dashboards, charts, forecasts, and benchmarks — ready in seconds, exportable to PDF.",
    descriptionAr: "لوحات معلومات، رسوم بيانية، تنبؤات، ومقارنات مرجعية — جاهزة في ثوانٍ.",
  },
];

const BENEFITS = [
  {
    icon: Zap,
    titleEn: "Instant analytics",
    titleAr: "تحليل فوري",
    descriptionEn: "From raw spreadsheet to insights in under a minute. No SQL, no setup.",
    descriptionAr: "من جدول بيانات خام إلى رؤى في أقل من دقيقة. لا SQL، لا إعداد.",
  },
  {
    icon: Shield,
    titleEn: "Your data stays local",
    titleAr: "بياناتك تبقى محلية",
    descriptionEn: "Files are processed in your browser with DuckDB-WASM. Nothing leaves your device unless you choose to export.",
    descriptionAr: "تتم معالجة الملفات في متصفحك باستخدام DuckDB-WASM. لا شيء يخرج من جهازك إلا إذا اخترت التصدير.",
  },
  {
    icon: GraduationCap,
    titleEn: "Built-in training",
    titleAr: "تدريب مدمج",
    descriptionEn: "Every service comes with lessons explaining what data to send, how to read the output, and common mistakes.",
    descriptionAr: "كل خدمة تأتي مع دروس تشرح أي بيانات ترسلها، كيف تقرأ النتائج، والأخطاء الشائعة.",
  },
];

const TESTIMONIALS_PLACEHOLDER = [
  {
    quoteEn: "SiroQ turned our raw pharmacy data into clear, actionable insights within minutes.",
    quoteAr: "حوّل SiroQ بيانات صيدلتنا الخام إلى رؤى واضحة وعملية في دقائق.",
    nameEn: "Pharmacy Manager",
    nameAr: "مدير الصيدلية",
  },
  {
    quoteEn: "The forecasting module helped us reduce waste by 30% in the first quarter.",
    quoteAr: "ساعد وحدة التنبؤ في تقليل الهدر بنسبة ٣٠٪ في الربع الأول.",
    nameEn: "Operations Lead",
    nameAr: "رئيس العمليات",
  },
  {
    quoteEn: "Finally a tool that understands pharmaceutical data out of the box.",
    quoteAr: "أخيراً أداة تفهم بيانات الأدوية من دون إعدادات معقدة.",
    nameEn: "Data Analyst",
    nameAr: "محلل بيانات",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-background text-center">
      {/* ── Header ── */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" aria-label="SiroQ">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login" className={buttonClasses("ghost", "sm")}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonClasses("primary", "sm")}>
            Get started
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center px-6 pb-16 pt-28 sm:pt-36">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-10%] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
          <div className="absolute bottom-[-12%] right-[-5%] h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="relative flex max-w-3xl animate-slide-up flex-col items-center">
          <div className="mb-7">
            <Logo />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            <span className="block">Pharmacy intelligence,</span>
            <span className="block bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 bg-clip-text text-transparent">
              powered by your data.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted sm:text-xl">
            Upload your spreadsheets. SiroQ turns them into dashboards,
            forecasts, and benchmarks — built for pharmaceutical consulting.
          </p>
          <div className="mt-4 max-w-xl text-base text-muted">
            <span className="block text-right leading-relaxed" dir="rtl">
              ارفع جداول بياناتك. حوّلها SiroQ إلى لوحات معلومات وتنبؤات ومقارنات مرجعية — مصممة لاستشارات الأدوية.
            </span>
          </div>
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
      </section>

      {/* ── Services ── */}
      <section className="relative px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            9 services. One platform.
          </h2>
          <p className="mt-3 text-lg text-muted">
            Consulting, operational, and technical analytics — from sales to training.
          </p>
          <p className="mt-1 text-base text-muted" dir="rtl">
            خدمات استشارية وتشغيلية وتقنية — من المبيعات إلى التدريب.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((svc, i) => (
              <div
                key={svc.nameEn}
                className="group animate-slide-up rounded-2xl border border-border bg-surface p-5 text-left shadow-sm shadow-black/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md hover:shadow-black/[0.05]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand transition-transform duration-200 group-hover:scale-110">
                  <svc.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{svc.nameEn}</h3>
                <p className="text-right text-sm font-medium text-brand" dir="rtl">
                  {svc.nameAr}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{svc.descriptionEn}</p>
                <p className="mt-1 text-right text-sm leading-relaxed text-muted" dir="rtl">
                  {svc.descriptionAr}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="relative border-t border-border bg-surface-subtle px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How it works
          </h2>
          <p className="mt-3 text-lg text-muted">Three steps from raw data to insight.</p>
          <p className="mt-1 text-base text-muted" dir="rtl">ثلاث خطوات من البيانات الخام إلى الرؤى.</p>

          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {HOW_STEPS.map((step, i) => (
              <div
                key={step.stepEn}
                className="animate-slide-up flex flex-col items-center text-center"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-brand-contrast shadow-md shadow-brand/20">
                  <step.icon className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-foreground">{step.stepEn}</h3>
                <p className="text-sm font-medium text-brand" dir="rtl">{step.stepAr}</p>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{step.descriptionEn}</p>
                <p className="mt-1 max-w-xs text-right text-sm leading-relaxed text-muted" dir="rtl">
                  {step.descriptionAr}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="relative px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Built for speed and safety
          </h2>
          <p className="mt-3 text-lg text-muted">
            Upload, explore, and transform — all without leaving your browser.
          </p>
          <p className="mt-1 text-base text-muted" dir="rtl">
            رفع واستكشاف وتحويل — كل ذلك من متصفحك.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.titleEn}
                className="group animate-slide-up rounded-2xl border border-border bg-surface p-5 text-left shadow-sm shadow-black/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md hover:shadow-black/[0.05]"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand transition-transform duration-200 group-hover:scale-110">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{f.titleEn}</h3>
                <p className="text-right text-sm font-medium text-brand" dir="rtl">{f.titleAr}</p>
                <p className="mt-1 text-sm text-muted">{f.descriptionEn}</p>
                <p className="mt-1 text-right text-sm leading-relaxed text-muted" dir="rtl">
                  {f.descriptionAr}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="relative border-t border-border bg-surface-subtle px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Why SiroQ?
          </h2>
          <p className="mt-3 text-lg text-muted">
            Designed for pharmaceutical consulting from day one.
          </p>
          <p className="mt-1 text-base text-muted" dir="rtl">
            مصمم لاستشارات الأدوية من اليوم الأول.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {BENEFITS.map((b, i) => (
              <div
                key={b.titleEn}
                className="animate-slide-up rounded-2xl border border-border bg-surface p-6 text-left shadow-sm"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                  <b.icon className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-foreground">{b.titleEn}</h3>
                <p className="text-right text-sm font-medium text-brand" dir="rtl">{b.titleAr}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b.descriptionEn}</p>
                <p className="mt-1 text-right text-sm leading-relaxed text-muted" dir="rtl">
                  {b.descriptionAr}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="relative px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Trusted by pharmacies
          </h2>
          <p className="mt-3 text-lg text-muted">
            What our clients say about SiroQ.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {TESTIMONIALS_PLACEHOLDER.map((t, i) => (
              <div
                key={i}
                className="animate-slide-up rounded-2xl border border-border bg-surface p-6 text-left shadow-sm"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <p className="text-sm leading-relaxed text-muted">&ldquo;{t.quoteEn}&rdquo;</p>
                <p className="mt-2 text-right text-sm leading-relaxed text-muted" dir="rtl">
                  &ldquo;{t.quoteAr}&rdquo;
                </p>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-sm font-medium text-foreground">{t.nameEn}</p>
                  <p className="text-right text-xs text-brand" dir="rtl">{t.nameAr}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative border-t border-border bg-surface-subtle px-6 py-20 sm:py-28">
        <div className="mx-auto flex max-w-2xl flex-col items-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to get started?
          </h2>
          <p className="mt-3 text-lg text-muted">
            Upload your first file in minutes. No credit card required.
          </p>
          <p className="mt-1 text-base text-muted" dir="rtl">
            ارفع ملفك الأول في دقائق. لا حاجة لبطاقة ائتمان.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className={buttonClasses("primary", "md")}>
              Create account
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className={buttonClasses("secondary", "md")}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 sm:flex-row sm:justify-between">
          <Link href="/" aria-label="SiroQ">
            <Logo />
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted">
            <Link href="/about" className="transition hover:text-foreground">About</Link>
            <Link href="/contact" className="transition hover:text-foreground">Contact</Link>
            <Link href="/privacy" className="transition hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="transition hover:text-foreground">Terms</Link>
            <Link href="/login" className="transition hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="transition hover:text-foreground">Get started</Link>
          </div>
          <p className="text-xs text-muted">
            &copy; {new Date().getFullYear()} SiroQ. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}
