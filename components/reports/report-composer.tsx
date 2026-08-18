"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type {
  ApplicationWithOrg,
  BranchOption,
  ComponentKind,
  ItemVisibility,
  OrganizationOption,
} from "@/lib/reports";
import { publishReport, reviseReport, type PublishReportInput } from "@/lib/actions/reports";
import { RichTextEditor, emptyRichTextDoc, type RichTextDoc } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

const COMPONENT_KINDS: ComponentKind[] = ["text", "chart", "table", "insight"];
const VISIBILITIES: ItemVisibility[] = ["org", "restricted", "branch"];
const VISIBILITY_LABEL: Record<ItemVisibility, string> = {
  org: "Full access",
  restricted: "Exclusive",
  branch: "Branch",
};

interface ComponentDraft {
  key: number;
  kind: ComponentKind;
  title: string;
  visibility: ItemVisibility;
  branchIds: string[];
  bodyJson: string;
  textDoc: RichTextDoc | null;
  chartType: "bar" | "line" | "area" | "pie" | null;
}

interface ItemDraft {
  key: number;
  visibility: ItemVisibility;
  branchIds: string[];
  title: string;
  bodyJson: string;
}

let keySeq = 0;

function defaultBody(kind: ComponentKind): string {
  switch (kind) {
    case "chart":
      return "{\n  \"series\": [],\n  \"metric\": \"revenue\"\n}";
    case "table":
      return "{\n  \"rows\": []\n}";
    case "insight":
      return "{}";
    default:
      return "";
  }
}

function toJson(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { value: v };
  } catch {
    return { text };
  }
}

function isRichBody(body: Record<string, unknown> | null | undefined): RichTextDoc | null {
  const t = body?.text;
  if (t && typeof t === "object" && (t as { type?: string }).type === "doc") {
    return t as RichTextDoc;
  }
  return null;
}

const textareaClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint transition-colors hover:border-border-strong focus:border-brand focus:outline-none";

export function ReportComposer({
  organizations,
  branches,
  apps,
  reportId,
  initial,
}: {
  organizations: OrganizationOption[];
  branches: BranchOption[];
  apps: ApplicationWithOrg[];
  reportId?: string;
  initial?: {
    orgId: string | null;
    branchId: string | null;
    title: string;
    summary: string | null;
    applicationIds: string[];
    components: {
      kind: ComponentKind;
      title: string | null;
      body: Record<string, unknown> | null;
      visibility?: ItemVisibility;
      branch_ids?: string[];
    }[];
    items: {
      visibility: ItemVisibility;
      branch_ids: string[];
      title: string | null;
      body: Record<string, unknown> | null;
    }[];
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const orgs = organizations.filter((o) => o.status === "active" || o.status === "pending");
  const [orgId, setOrgId] = useState<string>(initial?.orgId ?? orgs[0]?.id ?? "");
  const [branchId, setBranchId] = useState<string>(initial?.branchId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [selectedApps, setSelectedApps] = useState<string[]>(initial?.applicationIds ?? []);

  const [components, setComponents] = useState<ComponentDraft[]>(() =>
    (initial?.components ?? []).map((c) => ({
      key: keySeq++,
      kind: c.kind,
      title: c.title ?? "",
      visibility: c.visibility ?? "org",
      branchIds: c.branch_ids ?? [],
      bodyJson: JSON.stringify(c.body ?? {}, null, 2),
      textDoc: isRichBody(c.body),
      chartType: typeof (c.body as { chart_type?: string } | null)?.chart_type === "string"
        ? ((c.body as { chart_type: string }).chart_type as "bar" | "line" | "area" | "pie")
        : c.kind === "chart"
          ? "bar"
          : null,
    })),
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    (initial?.items ?? []).map((it) => ({
      key: keySeq++,
      visibility: it.visibility,
      branchIds: it.branch_ids,
      title: it.title ?? "",
      bodyJson: JSON.stringify(it.body ?? {}, null, 2),
    })),
  );

  const orgBranches = useMemo(
    () => branches.filter((b) => b.organization_id === orgId),
    [branches, orgId],
  );

  const orgApps = useMemo(
    () => apps.filter((a) => a.organization_id === orgId),
    [apps, orgId],
  );

  const canSubmit = title.trim().length > 0 && (components.length > 0 || items.length > 0);

  const submit = () => {
    if (!canSubmit || pending) return;
    const input: PublishReportInput = {
      orgId,
      branchId: branchId || null,
      title: title.trim(),
      summary: summary.trim() || null,
      components: components.map((c) => ({
        kind: c.kind,
        title: c.title.trim(),
        body:
          c.kind === "text" && c.textDoc
            ? { text: c.textDoc }
            : c.kind === "chart"
              ? { ...toJson(c.bodyJson), chart_type: c.chartType ?? "bar" }
              : toJson(c.bodyJson),
        visibility: c.visibility,
        branchIds: c.branchIds.length > 0 ? c.branchIds : undefined,
      })),
      items: items.map((it) => ({
        visibility: it.visibility,
        branchIds: it.branchIds,
        title: it.title.trim(),
        body: toJson(it.bodyJson),
      })),
      applicationIds: selectedApps,
    };
    startTransition(async () => {
      const res = reportId
        ? await reviseReport(reportId, input)
        : await publishReport(input);
      if (!res.ok) {
        toast({ kind: "error", text: res.error });
        return;
      }
      toast({ kind: "success", text: "Report published." });
      router.push(`/reports/${res.reportId}`);
      router.refresh();
    });
  };

  const patchComponent = (key: number, patch: Partial<ComponentDraft>) =>
    setComponents((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const patchItem = (key: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addComponent = (kind: ComponentKind = "text") =>
    setComponents((p) => [
      ...p,
      { key: keySeq++, kind, title: "", visibility: "org", branchIds: [], bodyJson: defaultBody(kind), textDoc: kind === "text" ? emptyRichTextDoc() : null, chartType: kind === "chart" ? "bar" : null },
    ]);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Organization</Label>
              <Select value={orgId} onChange={(e) => { setOrgId(e.target.value); setBranchId(""); }}>
                <option value="" disabled>
                  Choose…
                </option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.status}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Branch (optional — org-wide when empty)</Label>
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Org-wide</option>
                {orgBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q1 Insights for North Branch" />
          </div>
          <div className="space-y-1.5">
            <Label>Summary</Label>
            <textarea
              className={textareaClass}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A one-paragraph overview shown at the top of the report."
            />
          </div>
          <div className="space-y-2">
            <Label>Linked applications</Label>
            {orgApps.length === 0 ? (
              <p className="text-sm text-faint">No applications for this organization yet.</p>
            ) : (
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-border p-3">
                {orgApps.map((a) => {
                  const checked = selectedApps.includes(a.application_id);
                  return (
                    <label key={a.application_id} className="flex cursor-pointer items-start gap-2.5">
                      <Checkbox
                        checked={checked}
                        onChange={() =>
                          setSelectedApps((prev) =>
                            checked ? prev.filter((id) => id !== a.application_id) : [...prev, a.application_id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{a.title}</span>
                        <span className="block text-xs text-faint">{a.status}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Components</h3>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => addComponent("text")}>
                <Plus className="h-3.5 w-3.5" />
                Text
              </Button>
              <Button size="sm" variant="secondary" onClick={() => addComponent("chart")}>
                <Plus className="h-3.5 w-3.5" />
                Chart
              </Button>
              <Button size="sm" variant="secondary" onClick={() => addComponent("table")}>
                <Plus className="h-3.5 w-3.5" />
                Table
              </Button>
              <Button size="sm" variant="secondary" onClick={() => addComponent("insight")}>
                <Plus className="h-3.5 w-3.5" />
                Insight
              </Button>
            </div>
          </div>
          {components.length === 0 && <p className="text-sm text-faint">No components — reports need at least one component or insight item.</p>}
          {components.map((c) => (
            <div key={c.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select className="w-32" value={c.kind} onChange={(e) => patchComponent(c.key, { kind: e.target.value as ComponentKind })}>
                  {COMPONENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
                <Input className="h-9 flex-1" value={c.title} onChange={(e) => patchComponent(c.key, { title: e.target.value })} placeholder="Component title" />
                <Select
                  className="w-36"
                  value={c.visibility}
                  onChange={(e) =>
                    patchComponent(c.key, {
                      visibility: e.target.value as ItemVisibility,
                      ...(e.target.value === "branch" ? {} : { branchIds: [] }),
                    })
                  }
                  aria-label="Access"
                >
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABEL[v]}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setComponents((p) => p.filter((x) => x.key !== c.key))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {c.kind === "text" ? (
                <RichTextEditor
                  value={c.textDoc ?? emptyRichTextDoc()}
                  onChange={(doc) => patchComponent(c.key, { textDoc: doc })}
                  placeholder="Write the component body…"
                />
              ) : (
                <div className="space-y-2">
                  {c.kind === "chart" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted">Chart type</Label>
                      <Select
                        className="w-32"
                        value={c.chartType ?? "bar"}
                        onChange={(e) => patchComponent(c.key, { chartType: e.target.value as "bar" | "line" | "area" | "pie" })}
                        aria-label="Chart type"
                      >
                        {(["bar", "line", "area", "pie"] as const).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <textarea className={textareaClass} rows={4} value={c.bodyJson} onChange={(e) => patchComponent(c.key, { bodyJson: e.target.value })} placeholder={defaultBody(c.kind)} />
                </div>
              )}
              {c.visibility === "branch" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {orgBranches.map((b) => {
                    const on = c.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() =>
                          patchComponent(c.key, {
                            branchIds: on ? c.branchIds.filter((id) => id !== b.id) : [...c.branchIds, b.id],
                          })
                        }
                        className={on ? "rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white" : "rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-foreground"}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                  {orgBranches.length === 0 && <span className="text-xs text-faint">No branches for this organization.</span>}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Insight items</h3>
            <Button size="sm" variant="secondary" onClick={() => setItems((p) => [...p, { key: keySeq++, visibility: "org", branchIds: [], title: "", bodyJson: "{}" }])}>
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </div>
          {items.length === 0 && <p className="text-sm text-faint">No insight items — per-member or per-branch lines go here.</p>}
          {items.map((it) => (
            <div key={it.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select className="w-32" value={it.visibility} onChange={(e) => patchItem(it.key, { visibility: e.target.value as ItemVisibility })}>
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABEL[v]}
                    </option>
                  ))}
                </Select>
                <Input className="h-9 flex-1" value={it.title} onChange={(e) => patchItem(it.key, { title: e.target.value })} placeholder="Item title" />
                <Button size="sm" variant="ghost" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {it.visibility === "branch" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {orgBranches.map((b) => {
                    const on = it.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() =>
                          patchItem(it.key, {
                            branchIds: on ? it.branchIds.filter((id) => id !== b.id) : [...it.branchIds, b.id],
                          })
                        }
                        className={on ? "rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white" : "rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-foreground"}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                  {orgBranches.length === 0 && <span className="text-xs text-faint">No branches for this organization.</span>}
                </div>
              )}
              <textarea className={textareaClass} rows={4} value={it.bodyJson} onChange={(e) => patchItem(it.key, { bodyJson: e.target.value })} placeholder='{ "text": "…" }' />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {components.length} component{components.length === 1 ? "" : "s"} · {items.length} item{items.length === 1 ? "" : "s"}
          {selectedApps.length > 0 && (
            <Badge className="ml-2">
              {selectedApps.length} linked app{selectedApps.length === 1 ? "" : "s"}
            </Badge>
          )}
        </p>
        <Button variant="primary" onClick={submit} disabled={!canSubmit || pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {reportId ? "Revise report" : "Publish report"}
        </Button>
      </div>
    </div>
  );
}