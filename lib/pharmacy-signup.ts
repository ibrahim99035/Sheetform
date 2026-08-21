// Pure parsing/validation for the pharmacy signup fields.
//
// The signup form collects the same details the org profile stores
// (pharmacy name, license number/expiry, address, phone) so registration
// can create the organization + profile in one pass. Mirrors the
// server-side rules of `submit_org_profile` (required name/license,
// expiry not in the past).

export type PharmacySignupValues = {
  fullName: string;
  pharmacyName: string;
  licenseNo: string;
  licenseExpiry: string; // yyyy-mm-dd
  phone?: string;
  address?: string;
};

export type ParsedSignup =
  | { ok: true; email: string; password: string; pharmacy: PharmacySignupValues }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseSignupForm(formData: FormData, now: Date = new Date()): ParsedSignup {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !email.includes("@")) {
    return { ok: false, error: "A valid email address is required." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters long." };
  }

  const fullName = String(formData.get("full_name") ?? "").trim();
  const pharmacyName = String(formData.get("pharmacy_name") ?? "").trim();
  const licenseNo = String(formData.get("license_no") ?? "").trim();
  const licenseExpiry = String(formData.get("license_expiry") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  const address = String(formData.get("address") ?? "").trim() || undefined;

  if (!pharmacyName) {
    return { ok: false, error: "Pharmacy name is required." };
  }
  if (!licenseNo) {
    return { ok: false, error: "License number is required." };
  }
  if (!licenseExpiry) {
    return { ok: false, error: "License expiry date is required." };
  }
  if (!ISO_DATE.test(licenseExpiry) || Number.isNaN(Date.parse(licenseExpiry))) {
    return { ok: false, error: "License expiry must be a valid date." };
  }
  if (licenseExpiry < todayIso(now)) {
    return { ok: false, error: "License expiry cannot be in the past." };
  }

  return {
    ok: true,
    email,
    password,
    pharmacy: { fullName, pharmacyName, licenseNo, licenseExpiry, phone, address },
  };
}
