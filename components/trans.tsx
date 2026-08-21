"use client";

import { useLang } from "@/components/language-provider";
import type { TKey } from "@/lib/i18n";

// Translated text for server-component trees: the page stays a server
// component and embeds <Trans k="..."/> where a string is needed.
export function Trans({ k }: { k: TKey }) {
  const { t } = useLang();
  return <>{t(k)}</>;
}
