"use client";

import { useActionState, useState } from "react";
import {
  Building2,
  GitBranch,
  Users,
} from "lucide-react";
import {
  updateOrgProfile,
  addBranch,
  type OrgState,
} from "@/lib/actions/org";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";

type Tab = "profile" | "members" | "branches";

function ProfileTab({ orgId, profile }: { orgId: string; profile: Record<string, string> | null }) {
  const [state, action, pending] = useActionState<OrgState, FormData>(
    updateOrgProfile,
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="org_id" value={orgId} />
          <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pharmacy_name">Pharmacy name</Label>
              <Input id="pharmacy_name" name="pharmacy_name" defaultValue={profile?.pharmacy_name ?? ""} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="license_no">License number</Label>
              <Input id="license_no" name="license_no" defaultValue={profile?.license_no ?? ""} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="license_expiry">License expiry</Label>
              <Input id="license_expiry" name="license_expiry" type="date" defaultValue={profile?.license_expiry ?? ""} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={profile?.phone ?? ""} />
            </div>
          </div>
          <div className="max-w-lg space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" defaultValue={profile?.address ?? ""} />
          </div>
          {state?.error && (
            <p className="max-w-lg rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {state.error}
            </p>
          )}
          {state?.success && (
            <p className="max-w-lg rounded-lg border border-success/25 bg-success-subtle px-3 py-2 text-sm text-success-text">
              {state.success}
            </p>
          )}
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MembersTab({ members }: { members: { user_id: string; role: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members ({members.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">User ID</th>
                <th className="px-4 py-2.5">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {members.map((m) => (
                <tr key={m.user_id} className="transition-colors hover:bg-surface-subtle/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{m.user_id}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand capitalize">
                      {m.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BranchesTab({ orgId, branches }: { orgId: string; branches: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<OrgState, FormData>(
    addBranch,
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches ({branches.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="flex items-end gap-3">
          <input type="hidden" name="org_id" value={orgId} />
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="branch_name">New branch</Label>
            <Input id="branch_name" name="name" placeholder="e.g. Branch 1 - Downtown" />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </form>
        {state?.error && (
          <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {state.error}
          </p>
        )}
        {state?.success && (
          <p className="rounded-lg border border-success/25 bg-success-subtle px-3 py-2 text-sm text-success-text">
            {state.success}
          </p>
        )}
        {branches.length === 0 ? (
          <p className="text-sm text-muted">No branches yet.</p>
        ) : (
          <div className="space-y-1">
            {branches.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <GitBranch className="h-4 w-4 text-muted" />
                <span className="font-medium text-foreground">{b.name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OrgSettings({
  orgId,
  profile,
  members,
  branches,
}: {
  orgId: string;
  profile: Record<string, string> | null;
  members: { user_id: string; role: string }[];
  branches: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>("profile");

  const tabs = [
    { value: "profile" as const, label: "Profile", icon: <Building2 className="h-3.5 w-3.5" /> },
    { value: "members" as const, label: "Members", icon: <Users className="h-3.5 w-3.5" /> },
    { value: "branches" as const, label: "Branches", icon: <GitBranch className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="animate-slide-up space-y-5">
      <h1 className="text-xl font-semibold text-foreground">Organization settings</h1>
      <Tabs value={tab} onChange={(v) => setTab(v)} items={tabs} />
      {tab === "profile" && <ProfileTab orgId={orgId} profile={profile} />}
      {tab === "members" && <MembersTab members={members} />}
      {tab === "branches" && <BranchesTab orgId={orgId} branches={branches} />}
    </div>
  );
}
