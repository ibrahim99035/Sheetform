"use client";

import { Languages } from "lucide-react";
import { useLang } from "@/components/language-provider";
import { cn } from "@/lib/cn";

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
      title={lang === "en" ? "التبديل إلى العربية" : "Switch to English"}
      aria-label={lang === "en" ? "Switch to Arabic" : "Switch to English"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5" />
      <span>{lang === "en" ? "العربية" : "EN"}</span>
    </button>
  );
}
