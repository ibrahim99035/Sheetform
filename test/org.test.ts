import { describe, expect, it } from "vitest";
import {
  branchScopeIncludes,
  canPharmacistSubmitFor,
  effectiveReportAccess,
  formatLicenseExpiry,
  isLicenseExpiryValid,
  type ReportAccessContext,
} from "@/lib/org";

const member = (over: Partial<ReportAccessContext> = {}): ReportAccessContext => ({
  isSuperadmin: false,
  role: "owner",
  branchScope: [],
  reportStatus: "published",
  ...over,
});

describe("effectiveReportAccess", () => {
  it("grants superadmins everything, including restricted items", () => {
    const ctx = member({ isSuperadmin: true, role: null });
    expect(effectiveReportAccess(ctx, "restricted")).toBe(true);
    expect(effectiveReportAccess(ctx, "org")).toBe(true);
    expect(effectiveReportAccess(ctx, "branch", ["x"])).toBe(true);
  });

  it("grants owners/managers everything regardless of status or visibility", () => {
    const ctx = member({ role: "owner", reportStatus: "draft" });
    expect(effectiveReportAccess(ctx, "restricted")).toBe(true);
    const manager = member({ role: "manager", reportStatus: "revoked" });
    expect(effectiveReportAccess(manager, "restricted")).toBe(true);
  });

  it("denies non-members", () => {
    expect(effectiveReportAccess(member({ role: null }))).toBe(false);
    expect(effectiveReportAccess(member({ role: null }), "org")).toBe(false);
  });

  it("denies pharmacists access to non-published reports", () => {
    const ctx = member({ role: "pharmacist", branchScope: ["b1"], reportStatus: "draft" });
    expect(effectiveReportAccess(ctx)).toBe(false);
    expect(effectiveReportAccess(member({ ...ctx, reportStatus: "revoked" }))).toBe(false);
  });

  it("gives pharmacists org-wide and in-scope branch items", () => {
    const ctx = member({ role: "pharmacist", branchScope: ["b1"] });
    expect(effectiveReportAccess(ctx, "org")).toBe(true);
    expect(effectiveReportAccess(ctx, "branch", ["b1"])).toBe(true);
  });

  it("blocks out-of-scope branch items and restricted items for pharmacists", () => {
    const ctx = member({ role: "pharmacist", branchScope: ["b1"] });
    expect(effectiveReportAccess(ctx, "branch", ["b2"])).toBe(false);
    expect(effectiveReportAccess(ctx, "branch", ["b1", "b2"])).toBe(true);
    expect(effectiveReportAccess(ctx, "restricted")).toBe(false);
  });
});

describe("isLicenseExpiryValid", () => {
  const today = new Date("2026-08-14T12:00:00Z");

  it("accepts future and today", () => {
    expect(isLicenseExpiryValid("2026-08-14", today)).toBe(true);
    expect(isLicenseExpiryValid("2027-01-01", today)).toBe(true);
    expect(isLicenseExpiryValid(new Date("2027-01-01"), today)).toBe(true);
  });

  it("rejects past, missing, and unparseable values", () => {
    expect(isLicenseExpiryValid("2026-08-13", today)).toBe(false);
    expect(isLicenseExpiryValid("2020-01-01", today)).toBe(false);
    expect(isLicenseExpiryValid(null, today)).toBe(false);
    expect(isLicenseExpiryValid(undefined, today)).toBe(false);
    expect(isLicenseExpiryValid("", today)).toBe(false);
    expect(isLicenseExpiryValid("not-a-date", today)).toBe(false);
  });
});

describe("formatLicenseExpiry", () => {
  it("normalizes to YYYY-MM-DD", () => {
    expect(formatLicenseExpiry("2027-03-05")).toBe("2027-03-05");
    expect(formatLicenseExpiry(new Date("2027-03-05T00:00:00Z"))).toBe("2027-03-05");
  });

  it("returns null for missing/invalid input", () => {
    expect(formatLicenseExpiry(null)).toBeNull();
    expect(formatLicenseExpiry(undefined)).toBeNull();
    expect(formatLicenseExpiry("junk")).toBeNull();
    expect(formatLicenseExpiry("")).toBeNull();
  });
});

describe("canPharmacistSubmitFor", () => {
  it("lets owners/managers submit anywhere", () => {
    expect(canPharmacistSubmitFor("owner", [], "b1")).toBe(true);
    expect(canPharmacistSubmitFor("manager", [], null)).toBe(true);
  });

  it("requires pharmacists to stay within their scope", () => {
    expect(canPharmacistSubmitFor("pharmacist", ["b1"], "b1")).toBe(true);
    expect(canPharmacistSubmitFor("pharmacist", ["b1"], "b2")).toBe(false);
    expect(canPharmacistSubmitFor("pharmacist", [], "b1")).toBe(false);
    expect(canPharmacistSubmitFor("pharmacist", ["b1"], null)).toBe(false);
  });
});

describe("branchScopeIncludes", () => {
  it("handles null/empty scope and null ids", () => {
    expect(branchScopeIncludes(["b1"], "b1")).toBe(true);
    expect(branchScopeIncludes(["b1"], "b2")).toBe(false);
    expect(branchScopeIncludes([], "b1")).toBe(false);
    expect(branchScopeIncludes(null, "b1")).toBe(false);
    expect(branchScopeIncludes(["b1"], null)).toBe(false);
    expect(branchScopeIncludes(undefined, undefined)).toBe(false);
  });
});