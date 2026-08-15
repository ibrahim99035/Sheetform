// Pure, dependency-free helpers for the organization model.
//
// These mirror the access/validation rules enforced by the SECURITY DEFINER
// PostgreSQL functions in supabase/migrations/20260814120000_org_model.sql
// (effective_report_access, license checks, branch-scope gating). The real
// enforcement lives in the DB + RLS — this module only pre-validates/derives
// values for the UI and mirrors the decision logic (drift is a known
// constraint, verified against the DB by scripts/e2e-org.mjs).

export type OrgRole = "owner" | "manager" | "pharmacist" | "viewer";
export type ReportStatus = "draft" | "published" | "revoked";
export type ItemVisibility = "org" | "branch" | "restricted";

export interface ReportAccessContext {
  isSuperadmin: boolean;
  role: OrgRole | null; // null = not a member
  branchScope: string[]; // branch ids the pharmacist is scoped to
  reportStatus: ReportStatus | null; // null = report not found
}

/**
 * Mirror of public.effective_report_access(...). A user may read a report /
 * report item iff:
 *   - superadmin → everything;
 *   - owner/manager → everything (any status, any visibility);
 *   - pharmacist → only published reports, 'org' items, or 'branch' items
 *     whose branches intersect their scope; never 'restricted'.
 */
export function effectiveReportAccess(
  ctx: ReportAccessContext,
  visibility: ItemVisibility = "org",
  branchIds: string[] = [],
): boolean {
  if (ctx.isSuperadmin) return true;
  if (ctx.role === "owner" || ctx.role === "manager") return true;
  if (ctx.role !== "pharmacist") return false;
  if (ctx.reportStatus !== "published") return false;
  if (visibility === "org") return true;
  if (visibility === "branch") {
    return branchIds.some((id) => ctx.branchScope.includes(id));
  }
  return false; // 'restricted'
}

/**
 * License expiry validation, mirroring the DB rule
 * `p_license_expiry < current_date => LICENSE_EXPIRED`. A license is valid
 * through its expiry date (inclusive).
 */
export function isLicenseExpiryValid(
  expiry: string | Date | null | undefined,
  today: Date = new Date(),
): boolean {
  const d = toDateUTC(expiry);
  if (d === null) return false;
  const day = (dt: Date) => Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  return day(d) >= day(today);
}

/**
 * Normalizes a license expiry value to the `YYYY-MM-DD` string expected by
 * submit_org_profile / create_pharmacist RPC payloads. Returns null if the
 * input is missing or unparseable.
 */
export function formatLicenseExpiry(
  expiry: string | Date | null | undefined,
): string | null {
  const d = toDateUTC(expiry);
  return d === null ? null : d.toISOString().slice(0, 10);
}

/** Whether a branch id is in the given (possibly empty) member scope array. */
export function branchScopeIncludes(
  scope: string[] | null | undefined,
  branchId: string | null | undefined,
): boolean {
  return !!branchId && !!scope && scope.includes(branchId);
}

/**
 * Pharmacist submission rule (mirrors `BRANCH_REQUIRED` / `FORBIDDEN` in
 * submit_application): a pharmacist may only submit for a branch inside their
 * own scope. Owners/managers may submit org-wide or for any branch.
 */
export function canPharmacistSubmitFor(
  role: OrgRole,
  scope: string[],
  branchId: string | null | undefined,
): boolean {
  if (role === "owner" || role === "manager") return true;
  return branchScopeIncludes(scope, branchId);
}

function toDateUTC(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}