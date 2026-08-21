import { describe, expect, it } from "vitest";
import { parseSignupForm } from "@/lib/pharmacy-signup";

const NOW = new Date("2026-08-21T12:00:00Z");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const valid = {
  email: "owner@pharmacy.com",
  password: "supersecret1",
  full_name: "Ahmed Hassan",
  pharmacy_name: "El-Nasr Pharmacy",
  license_no: "PH-12345",
  license_expiry: "2027-01-31",
  phone: "+20 100 123 4567",
  address: "12 Talaat Harb St, Cairo",
};

describe("parseSignupForm", () => {
  it("parses a complete signup with pharmacy details", () => {
    const result = parseSignupForm(form(valid), NOW);
    expect(result).toEqual({
      ok: true,
      email: "owner@pharmacy.com",
      password: "supersecret1",
      pharmacy: {
        fullName: "Ahmed Hassan",
        pharmacyName: "El-Nasr Pharmacy",
        licenseNo: "PH-12345",
        licenseExpiry: "2027-01-31",
        phone: "+20 100 123 4567",
        address: "12 Talaat Harb St, Cairo",
      },
    });
  });

  it("trims values and drops empty optional fields", () => {
    const result = parseSignupForm(
      form({ ...valid, full_name: "  Ahmed  ", phone: "  ", address: "" }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pharmacy.fullName).toBe("Ahmed");
      expect(result.pharmacy.phone).toBeUndefined();
      expect(result.pharmacy.address).toBeUndefined();
    }
  });

  it("rejects an invalid email", () => {
    const result = parseSignupForm(form({ ...valid, email: "nope" }), NOW);
    expect(result).toEqual({ ok: false, error: "A valid email address is required." });
  });

  it("rejects short passwords", () => {
    const result = parseSignupForm(form({ ...valid, password: "short" }), NOW);
    expect(result).toEqual({
      ok: false,
      error: "Password must be at least 8 characters long.",
    });
  });

  it("requires a pharmacy name", () => {
    const result = parseSignupForm(form({ ...valid, pharmacy_name: "" }), NOW);
    expect(result).toEqual({ ok: false, error: "Pharmacy name is required." });
  });

  it("requires a license number", () => {
    const result = parseSignupForm(form({ ...valid, license_no: " " }), NOW);
    expect(result).toEqual({ ok: false, error: "License number is required." });
  });

  it("requires a license expiry date", () => {
    const result = parseSignupForm(form({ ...valid, license_expiry: "" }), NOW);
    expect(result).toEqual({ ok: false, error: "License expiry date is required." });
  });

  it("rejects malformed expiry dates", () => {
    const result = parseSignupForm(form({ ...valid, license_expiry: "31/01/2027" }), NOW);
    expect(result).toEqual({ ok: false, error: "License expiry must be a valid date." });
  });

  it("rejects expiry dates in the past", () => {
    const result = parseSignupForm(
      form({ ...valid, license_expiry: "2026-08-20" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "License expiry cannot be in the past." });
  });

  it("accepts an expiry date of today", () => {
    const result = parseSignupForm(
      form({ ...valid, license_expiry: "2026-08-21" }),
      NOW,
    );
    expect(result.ok).toBe(true);
  });
});
