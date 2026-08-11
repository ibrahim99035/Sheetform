import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  dataset_count: number;
}

export interface AdminDatasetRow {
  id: string;
  name: string;
  status: string;
  row_count: number | null;
  sheet_name: string | null;
  created_at: string;
  updated_at: string;
}

export const isSuperAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();
  return !!data;
});

export async function listUsers(): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminUserRow[];
}