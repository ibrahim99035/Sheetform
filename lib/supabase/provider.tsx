"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createClient(), []);
  return (
    <SupabaseContext.Provider value={client}>{children}</SupabaseContext.Provider>
  );
}

export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) {
    throw new Error("useSupabase must be used within a SupabaseProvider");
  }
  return client;
}
