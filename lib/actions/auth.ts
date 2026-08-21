"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import {
  parseSignupForm,
  type PharmacySignupValues,
} from "@/lib/pharmacy-signup";

export type AuthState = {
  error?: string;
  success?: string;
  warning?: string;
} | undefined;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type AuthUser = NonNullable<
  Awaited<ReturnType<SupabaseServerClient["auth"]["getUser"]>>["data"]["user"]
>;

// Finish organization setup from the pharmacy details captured at signup.
// Stored in user metadata so it also completes after an email-confirmation
// pause (first sign-in). Idempotent: ALREADY_MEMBER means the org exists
// and the existing one is left untouched.
async function completeOrgSetup(
  supabase: SupabaseServerClient,
  user: AuthUser | null,
): Promise<string | undefined> {
  const meta = (user?.user_metadata ?? {}) as {
    display_name?: string;
    pharmacy_signup?: Omit<PharmacySignupValues, "fullName">;
  };
  const pending = meta.pharmacy_signup;
  if (!pending?.pharmacyName || !pending.licenseNo || !pending.licenseExpiry) {
    return undefined;
  }

  const { data: orgId, error: orgError } = await supabase.rpc("create_owner", {
    p_org_name: pending.pharmacyName,
  });
  if (orgError) {
    if (!orgError.message.includes("ALREADY_MEMBER")) {
      const warning = `Account ready, but creating your organization failed (${orgError.message}). You can retry from Organization settings.`;
      log.warn("signup_org_setup_failed", { message: orgError.message });
      return warning;
    }
    return undefined;
  }
  if (!orgId) {
    return undefined;
  }

  const { error: profileError } = await supabase.rpc("submit_org_profile", {
    p_org_id: orgId,
    p_pharmacy_name: pending.pharmacyName,
    p_license_no: pending.licenseNo,
    p_license_expiry: pending.licenseExpiry,
    p_address: pending.address,
    p_phone: pending.phone,
  });
  if (profileError) {
    const warning = `Your organization was created, but the pharmacy profile needs review (${profileError.message}). Update it in Organization settings.`;
    log.warn("signup_profile_submit_failed", { message: profileError.message });
    return warning;
  }
  log.info("signup_org_setup_complete", { orgId });
  return undefined;
}

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Complete a signup that was interrupted by email confirmation.
  await completeOrgSetup(supabase, data.user);

  revalidatePath("/", "layout");
  redirect("/datasets");
}

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseSignupForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }
  const { email, password, pharmacy } = parsed;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${SITE_URL}/login`,
      data: {
        display_name: pharmacy.fullName || email.split("@")[0],
        pharmacy_signup: {
          pharmacyName: pharmacy.pharmacyName,
          licenseNo: pharmacy.licenseNo,
          licenseExpiry: pharmacy.licenseExpiry,
          phone: pharmacy.phone,
          address: pharmacy.address,
        },
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      success:
        "Check your email to confirm your account, then sign in — your pharmacy details will be applied automatically.",
    };
  }

  await completeOrgSetup(supabase, data.user);

  revalidatePath("/", "layout");
  redirect("/datasets");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function forgotPassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/reset-password`,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: "Check your email for the reset link." };
}

export async function resetPassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  return { success: "Password updated. You can now sign in." };
}
