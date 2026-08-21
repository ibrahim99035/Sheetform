"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";

export type NavItem = {
  href: string;
  labelKey: TKey;
  icon: ReactNode;
  /** Icon-only on mobile */
  mobileIconOnly?: boolean;
};

// Active when the current path falls under href, unless a longer nav
// prefix is an even better match (e.g. /datasets/new beats /datasets).
function isActive(href: string, pathname: string, hrefs: string[]): boolean {
  if (!pathname.startsWith(href)) return false;
  return !hrefs.some((other) => other.length > href.length && pathname.startsWith(other));
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const { t } = useLang();
  const hrefs = items.map((i) => i.href);

  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((item) => {
        const active = isActive(item.href, pathname, hrefs);
        const iconOnly = item.mobileIconOnly ?? true;
        const label = t(item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              iconOnly
                ? `flex h-10 w-10 items-center justify-center rounded-md transition sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 ${
                    active
                      ? "bg-brand-subtle text-brand"
                      : "text-muted hover:bg-surface-subtle hover:text-foreground"
                  }`
                : `rounded-md px-3 py-2 transition hover:bg-surface-subtle hover:text-foreground sm:py-1.5 ${
                    active ? "bg-brand-subtle font-medium text-brand" : "text-muted"
                  }`
            }
          >
            <span
              className={
                iconOnly
                  ? "[&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-3.5 sm:[&>svg]:w-3.5"
                  : "sm:hidden [&>svg]:h-4 [&>svg]:w-4"
              }
            >
              {item.icon}
            </span>
            <span className={iconOnly ? "hidden sm:inline" : ""}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
