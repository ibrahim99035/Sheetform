"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { FileDropzone } from "@/components/file-dropzone";
import { PreviewTable } from "@/components/preview-table";
import { parseFileForPreview, type PreviewSheet } from "@/lib/parse";
import { useSupabase } from "@/lib/supabase/provider";
import type { InferredColumn } from "@/lib/types";
import { submitApplication } from "@/lib/actions/applications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export interface TemplateOption {
  code: string;
  name: string;
  type: string;
  description: string | null;
}

interface OrgOption {
  id: string;
  name: string;
  status: string;
}

interface BranchOption {
  id: string;
  organization_id: string;
  name: string;
}

interface PreparedFile {
  key: number;
  file: File;
  sheetName: string;
  sheets: PreviewSheet[];
  columns: InferredColumn[];
  templateCode: string | null;
}

let keySeq = 0;

export function ApplicationSubmit({
  organizations,
  branches,
  templates,
}: {
  organizations: OrgOption[];
  branches: BranchOption[];
  templates: TemplateOption[];
}) {
  const supabase = useSupabase();
  const router = useRouter();

  const orgs = organizations.filter((o) => o.status === "active");
  const [orgId, setOrgId] = useState<string>(orgs[0]?.id ?? "");
  const [branchId, setBranchId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsingKey, setParsingKey] = useState<number | null>(null);

  const orgBranches = useMemo(
    () => branches.filter((b) => b.organization_id === orgId),
    [branches, orgId],
  );

  const canSubmit =
    orgId && title.trim().length > 0 && files.length > 0 && !busy;

  const handleFile = async (selected: File) => {
    setError(null);
    setParsingKey(files.length);
    try {
      const result = await parseFileForPreview(selected);
      const populated = result.sheets.filter((s) => s.hasData);
      if (populated.length === 0) {
        setError("This file has no data rows beyond a header. Nothing to import.");
        return;
      }
      setFiles((prev) => [
        ...prev,
        {
          key: keySeq++,
          file: selected,
          sheets: populated,
          sheetName: populated[0].name,
          columns: populated[0].inferred,
          templateCode: null,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse this file.");
    } finally {
      setParsingKey(null);
    }
  };

  const patchFile = (key: number, patch: Partial<PreparedFile>) =>
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const removeFile = (key: number) => setFiles((prev) => prev.filter((f) => f.key !== key));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const uploaded: { fileName: string; storagePath: string; sheetName: string | null; columns: { label: string; type: InferredColumn["type"] }[]; templateCode: string | null }[] = [];
      for (const f of files) {
        const objectPath = `${user.id}/${crypto.randomUUID()}/${f.file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(objectPath, f.file, { cacheControl: "3600", upsert: false });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        uploaded.push({
          fileName: f.file.name,
          storagePath: objectPath,
          sheetName: f.sheetName,
          columns: f.columns.map((c) => ({ label: c.label, type: c.type })),
          templateCode: f.templateCode,
        });
      }

      const result = await submitApplication({
        orgId,
        branchId: branchId || null,
        title: title.trim(),
        note: note.trim() || null,
        files: uploaded,
      });
      if (!result.ok) throw new Error(result.error);

      router.push(`/applications/${result.applicationId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Organization</Label>
              <Select value={orgId} onChange={(e) => { setOrgId(e.target.value); setBranchId(""); }}>
                <option value="" disabled>Choose…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
              {orgs.length === 0 && (
                <p className="text-xs text-faint">No active organizations — submit a profile first.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Branch (optional — org-wide when empty)</Label>
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Org-wide</option>
                {orgBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Application title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q3 sales data for Main Pharmacy"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <textarea
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint transition-colors hover:border-border-strong focus:border-brand focus:outline-none"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the analyst should know."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Files</h3>
              <p className="mt-0.5 text-sm text-muted">
                One or several Excel/CSV files. Each file becomes its own datasource for analysis.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => document.getElementById("app-file")?.click()} disabled={busy}>
              <Plus className="h-3.5 w-3.5" />
              Add file
            </Button>
          </div>

          <input
            id="app-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {parsingKey !== null && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
              Parsing file…
            </p>
          )}

          {files.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-center">
              <FileText className="mx-auto mb-2 h-6 w-6 text-faint" />
              <p className="text-sm text-faint">No files added yet. Add at least one .csv or .xlsx file.</p>
            </div>
          )}

          {files.map((f) => (
            <div key={f.key} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                    <FileCheck2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{f.file.name}</p>
                    <p className="text-xs text-muted">
                      {(f.file.size / 1024 / 1024).toFixed(2)} MB · {f.sheets.find((s) => s.name === f.sheetName)?.rowEstimate.toLocaleString() ?? 0} rows (est.)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    className="w-44"
                    value={f.templateCode ?? ""}
                    onChange={(e) => patchFile(f.key, { templateCode: e.target.value || null })}
                    aria-label="Analysis template"
                  >
                    <option value="">No template</option>
                    {templates.map((t) => (
                      <option key={t.code} value={t.code}>{t.name}</option>
                    ))}
                  </Select>
                  {f.sheets.length > 1 && (
                    <Select
                      className="w-40"
                      value={f.sheetName}
                      onChange={(e) => {
                        const next = f.sheets.find((s) => s.name === e.target.value);
                        if (next) patchFile(f.key, { sheetName: next.name, columns: next.inferred });
                      }}
                      aria-label="Sheet"
                    >
                      {f.sheets.map((s) => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                    </Select>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => removeFile(f.key)} title="Remove file">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <PreviewTable
                headers={f.sheets.find((s) => s.name === f.sheetName)?.headers ?? []}
                sampleRows={f.sheets.find((s) => s.name === f.sheetName)?.sampleRows ?? []}
                columns={f.columns}
                onColumnsChange={(cols) => patchFile(f.key, { columns: cols })}
                rowHint="Confirm the column types — the file is parsed server-side with these types."
              />
            </div>
          ))}

          <FileDropzone onFile={handleFile} disabled={busy} />
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {files.length} file{files.length === 1 ? "" : "s"} ready
          {branchId && <Badge className="ml-2">branch-scoped</Badge>}
        </p>
        <Button variant="primary" onClick={submit} disabled={!canSubmit}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Submitting…" : "Submit application"}
        </Button>
      </div>
    </div>
  );
}