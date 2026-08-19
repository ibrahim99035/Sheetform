"use client";

import Link from "next/link";
import { CheckCircle2, BookOpen, ArrowRight } from "lucide-react";
import type { TrainingLesson } from "@/lib/actions/training";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const SERVICE_LABELS: Record<string, { label: string; labelAr: string }> = {
  sales: { label: "Sales", labelAr: "المبيعات" },
  inventory: { label: "Inventory", labelAr: "المخزون" },
  customers: { label: "Customers", labelAr: "العملاء" },
  suppliers: { label: "Suppliers", labelAr: "الموردين" },
  geography: { label: "Geography", labelAr: "الجغرافيا" },
  benchmarks: { label: "Benchmarks", labelAr: "المقارنات" },
  forecasting: { label: "Forecasting", labelAr: "التنبؤ" },
  budgets: { label: "Budgets", labelAr: "الموازنات" },
  stocktake: { label: "Stock Count", labelAr: "الجرد" },
};

function LessonRow({ lesson }: { lesson: TrainingLesson }) {
  const svc = SERVICE_LABELS[lesson.service_id] ?? {
    label: lesson.service_id,
    labelAr: lesson.service_id,
  };
  return (
    <Link href={`/training/${lesson.slug}`} className="block">
      <Card className="group cursor-pointer transition hover:border-brand/30 hover:bg-surface-subtle/40">
        <CardContent className="flex items-center gap-4 p-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
              lesson.completed
                ? "bg-success-subtle text-success"
                : "bg-brand-subtle text-brand group-hover:bg-brand group-hover:text-white"
            }`}
          >
            {lesson.completed ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <BookOpen className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{lesson.title_en}</span>
              <span className="text-sm text-muted">{lesson.title_ar}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <Badge variant={lesson.completed ? "success" : "neutral"} className="text-[10px]">
                {svc.label}
              </Badge>
              <span className="text-faint">·</span>
              <span className="text-faint">{svc.labelAr}</span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function TrainingList({ lessons }: { lessons: TrainingLesson[] }) {
  const completed = lessons.filter((l) => l.completed).length;
  const total = lessons.length;

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Training / التدريب</h1>
        <p className="mt-0.5 text-sm text-muted">
          {completed} of {total} lessons completed
        </p>
        {total > 0 && (
          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${(completed / total) * 100}%` }}
            />
          </div>
        )}
      </div>

      {lessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <BookOpen className="h-8 w-8 text-faint" />
            <p className="text-sm text-muted">
              No training lessons available yet. Run the migration to seed content.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.slug} lesson={lesson} />
          ))}
        </div>
      )}
    </div>
  );
}
