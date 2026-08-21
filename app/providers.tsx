"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupabaseProvider } from "@/lib/supabase/provider";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <SupabaseProvider>{children}</SupabaseProvider>
          </QueryClientProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
