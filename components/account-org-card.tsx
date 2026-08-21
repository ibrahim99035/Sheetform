import Link from "next/link";
import { Building2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trans } from "@/components/trans";

export type OrgSummary = {
  id: string;
  name: string;
  status: string;
};

export type OrgProfileSummary = {
  pharmacy_name: string;
  address: string | null;
  phone: string | null;
  license_no: string;
  license_expiry: string;
  rejection_reason: string | null;
} | null;

const STATUS_CFG: Record<string, { variant: "warning" | "success" | "danger"; label: string }> = {
  pending: { variant: "warning", label: "Pending review" },
  active: { variant: "success", label: "Active" },
  rejected: { variant: "danger", label: "Rejected" },
  suspended: { variant: "danger", label: "Suspended" },
};

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function AccountOrgCard({
  org,
  profile,
}: {
  org: OrgSummary | null;
  profile: OrgProfileSummary;
}) {
  if (!org) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans k="settings.orgCard.title" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">
            You are not part of an organization yet. Create one to register your
            pharmacy and unlock org-level dashboards.
          </p>
          <Link
            href="/org/new"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Building2 className="h-4 w-4" />
            Create your organization
          </Link>
        </CardContent>
      </Card>
    );
  }

  const statusCfg = STATUS_CFG[org.status] ?? STATUS_CFG.pending;
  const todayIso = new Date().toISOString().slice(0, 10);
  const licenseExpired = Boolean(profile?.license_expiry && profile.license_expiry < todayIso);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <Trans k="settings.orgCard.title" />
          </CardTitle>
          <Badge variant={statusCfg.variant} dot={org.status === "pending" ? "solid" : undefined}>
            {statusCfg.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-foreground">{org.name}</p>

        {org.status === "rejected" && (
          <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            Your pharmacy profile was rejected
            {profile?.rejection_reason ? `: ${profile.rejection_reason}` : "."}{" "}
            Update the details below and resubmit for review.
          </p>
        )}
        {licenseExpired && (
          <p className="rounded-lg border border-warning/25 bg-warning-subtle px-3 py-2 text-sm text-warning-text">
            The pharmacy license expired on {formatDate(profile!.license_expiry)}. Renew it to keep
            your account in good standing.
          </p>
        )}

        {profile ? (
          <dl>
            <ProfileRow label="Pharmacy name" value={profile.pharmacy_name} />
            <ProfileRow label="License number" value={profile.license_no} />
            <ProfileRow label="License expiry" value={formatDate(profile.license_expiry)} />
            <ProfileRow label="Phone" value={profile.phone ?? "—"} />
            <ProfileRow label="Address" value={profile.address ?? "—"} />
          </dl>
        ) : (
          <p className="rounded-lg border border-warning/25 bg-warning-subtle px-3 py-2 text-sm text-warning-text">
            Pharmacy details have not been submitted yet. Add them so the team can review your
            organization.
          </p>
        )}

        <Link
          href={`/org/${org.id}/settings`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          Manage organization
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
