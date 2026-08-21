"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SettingsState = { error?: string; success?: string } | undefined;

export async function updateEmail(
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const email = String(formData.get("email") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) {
    return { error: error.message };
  }

  return { success: "Confirmation email sent. Check your inbox." };
}

export async function updatePassword(
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!currentPassword) {
    return { error: "Current password is required." };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (newPassword !== confirm) {
    return { error: "New passwords do not match." };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user?.email) {
    return { error: "Could not verify current user." };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: "Current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { error: error.message };
  }

  return { success: "Password updated successfully." };
}

export async function updateDisplayName(
  _: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const displayName = String(formData.get("display_name") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { success: "Display name updated." };
}
