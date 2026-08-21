"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createOrganization, type OrgState } from "@/lib/actions/org";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OrgCreateForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<OrgState, FormData>(
    createOrganization,
    undefined,
  );

  if (state?.orgId) {
    router.push(`/org/${state.orgId}`);
    return null;
  }

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Organization name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          autoFocus
          placeholder="e.g. Pharma Plus"
        />
        <p className="text-xs text-faint">
          This is your organization&apos;s display name within SiroQ.
        </p>
      </div>
      {state?.error && (
        <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
