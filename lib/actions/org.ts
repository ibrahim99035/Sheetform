"use server";

import { createClient } from "@/lib/supabase/server";

export type OrgState = { error?: string; success?: string; orgId?: string } | undefined;

export async function createOrganization(
  _: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Organization name is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_owner", { p_org_name: name });

  if (error) {
    const msg = error.message;
    if (msg.includes("ALREADY_MEMBER")) {
      return { error: "You already belong to an organization." };
    }
    return { error: msg || "Could not create organization." };
  }

  return { success: "Organization created.", orgId: data as string };
}

export async function updateOrgProfile(
  _: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const orgId = String(formData.get("org_id") ?? "");
  const pharmacyName = String(formData.get("pharmacy_name") ?? "").trim();
  const licenseNo = String(formData.get("license_no") ?? "").trim();
  const licenseExpiry = String(formData.get("license_expiry") ?? "");
  const address = String(formData.get("address") ?? "").trim() || undefined;
  const phone = String(formData.get("phone") ?? "").trim() || undefined;

  if (!pharmacyName || !licenseNo || !licenseExpiry) {
    return { error: "Pharmacy name, license number, and expiry are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_org_profile", {
    p_org_id: orgId,
    p_pharmacy_name: pharmacyName,
    p_license_no: licenseNo,
    p_license_expiry: licenseExpiry,
    p_address: address,
    p_phone: phone,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: "Profile submitted for review." };
}

export async function addBranch(
  _: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const orgId = String(formData.get("org_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Branch name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .insert({ organization_id: orgId, name });

  if (error) {
    return { error: error.message };
  }

  return { success: "Branch added." };
}
