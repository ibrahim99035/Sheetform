import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/admin";
import type { OrgRole } from "@/lib/org";

/**
 * Server-side role context for the current request.
 *
 * Mirrors the DB roles (org_members + admin_users) and is used for route
 * gating/navigation. Enforcement always lives in the DB (RLS + SECURITY
 * DEFINER RPCs); this is a convenience mirror, not the security boundary.
 */
export interface RoleContext {
  userId: string | null;
  isSuperadmin: boolean;
  orgId: string | null;
  role: OrgRole | null;
  branchScope: string[];
}

export const getRoleContext = cache(async (): Promise<RoleContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, isSuperadmin: false, orgId: null, role: null, branchScope: [] };
  }

  const [superadmin, member] = await Promise.all([
    isSuperAdmin(),
    supabase
      .from("org_members")
      .select("organization_id, role, branch_scope")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    userId: user.id,
    isSuperadmin: superadmin,
    orgId: member.data?.organization_id ?? null,
    role: (member.data?.role as OrgRole | undefined) ?? null,
    branchScope: (member.data?.branch_scope as string[] | undefined) ?? [],
  };
});

/** All capabilities an org owner/manager has within their organization. */
export function isOrgManager(ctx: RoleContext): boolean {
  return (
    ctx.isSuperadmin || ctx.role === "owner" || ctx.role === "manager"
  );
}

/** The user belongs to the given organization (operator included). */
export function canAccessOrg(ctx: RoleContext, orgId: string): boolean {
  return ctx.isSuperadmin || ctx.orgId === orgId;
}

/** Pharmacists never reach restricted items and need an active membership. */
export function isOrgMember(ctx: RoleContext): boolean {
  return ctx.role !== null;
}