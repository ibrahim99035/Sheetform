"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Import, RefreshCw } from "lucide-react";
import { FileDropzone } from "@/components/file-dropzone";
import { PreviewTable } from "@/components/preview-table";
import { ServiceCoverageCard } from "@/components/service-coverage";
import { parseFileForPreview, type PreviewSheet } from "@/lib/parse";
import { assessServiceCoverage } from "@/lib/analysis/services";
import { useSupabase } from "@/lib/supabase/provider";
import type { ColumnRole, InferredColumn } from "@/lib/types";
import { createDataset } from "@/lib/actions/datasets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Stage = "select" | "ready";

export function UploadFlow() {
  const supabase = useSupabase();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<PreviewSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState<PreviewSheet | null>(null);
  const [columns, setColumns] = useState<InferredColumn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dataRequests, setDataRequests] = useState<
    { role: ColumnRole; label: string }[]
  >([]);

  const populatedSheets = useMemo(
    () => sheets.filter((s) => s.hasData && s.headers.length > 0),
    [sheets],
  );

  const roleMap = useMemo(() => {
    const map: Partial<Record<ColumnRole, string>> = {};
    for (const col of columns) {
      if (col.role) {
        map[col.role] = col.key;
      }
    }
    return map;
  }, [columns]);

  const handleFile = async (selected: File) => {
    setError(null);
    setBusy(true);
    try {
      const result = await parseFileForPreview(selected);
      setFile(selected);
      setSheets(result.sheets);
      const populated = result.sheets.filter((s) => s.hasData);

      if (populated.length === 0) {
        setError("This file has no data rows beyond a header. Nothing to import.");
        setStage("select");
        return;
      }

      const chosen = populated[0];
      setActiveSheet(chosen);
      setColumns(chosen.inferred);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse this file.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!file || !activeSheet) return;
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const objectPath = `${user.id}/${crypto.randomUUID()}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(objectPath, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const result = await createDataset({
        storagePath: objectPath,
        fileName: file.name,
        sheetName: activeSheet.name,
        columns: columns.map((c) => ({
          label: c.label,
          type: c.type,
          role: c.role,
          role_confidence: c.role_confidence,
        })),
        serviceCoverage: assessServiceCoverage(roleMap),
        dataRequests: dataRequests.length > 0 ? dataRequests : undefined,
      });

      if (!result.ok) throw new Error(result.error);

      router.push(`/datasets/${result.datasetId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStage("select");
    setFile(null);
    setSheets([]);
    setActiveSheet(null);
    setColumns([]);
    setError(null);
    setDataRequests([]);
  };

  const handleRequestMore = (missing: { role: ColumnRole; label: string }[]) => {
    setDataRequests((prev) => {
      const existingRoles = new Set(prev.map((r) => r.role));
      const newRequests = missing.filter((r) => !existingRoles.has(r.role));
      return [...prev, ...newRequests];
    });
  };

  return (
    <div className="space-y-5">
      {stage === "select" && (
        <>
          <FileDropzone onFile={handleFile} disabled={busy} />
          {busy && (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
              <div className="grid grid-cols-3 gap-3 pt-1">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            </div>
          )}
          {error && (
            <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
        </>
      )}

      {stage === "ready" && activeSheet && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-foreground">
                  {file?.name}
                </h2>
                <p className="text-sm text-muted">
                  Sheet “{activeSheet.name}” ·{" "}
                  {activeSheet.rowEstimate.toLocaleString()} rows (est.)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={reset} disabled={busy}>
                <RefreshCw className="h-4 w-4" />
                Choose another file
              </Button>
              <Button onClick={handleConfirm} disabled={busy} variant="primary">
                <Import className="h-4 w-4" />
                {busy ? "Uploading…" : "Import dataset"}
              </Button>
            </div>
          </div>

          {populatedSheets.length > 1 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="sheet-select">
                  This file has {sheets.length} sheets with data. Which one do you want
                  to import?
                </Label>
                <Select
                  id="sheet-select"
                  value={activeSheet.name}
                  onChange={(e) => {
                    const next = populatedSheets.find((s) => s.name === e.target.value);
                    if (next) {
                      setActiveSheet(next);
                      setColumns(next.inferred);
                    }
                  }}
                  className="max-w-md"
                >
                  {populatedSheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} — {s.rowEstimate.toLocaleString()} rows (est.)
                    </option>
                  ))}
                </Select>
              </CardContent>
            </Card>
          )}

          <p className="text-sm text-muted">
            Confirm the column types below. The full file will be parsed server-side
            using these types; values that don’t match a type are imported as empty.
          </p>

          <PreviewTable
            headers={activeSheet.headers}
            sampleRows={activeSheet.sampleRows}
            columns={columns}
            onColumnsChange={setColumns}
            rowHint={`Preview of the first ${Math.max(activeSheet.sampleRows.length, 0)} data rows.`}
          />

          <ServiceCoverageCard
            roleMap={roleMap}
            onRequestMore={handleRequestMore}
          />

          {dataRequests.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-medium text-foreground">
                  Data request summary
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-sm text-muted">
                  {dataRequests.map((r) => (
                    <li key={r.role}>
                      {r.label} <span className="text-faint">({r.role})</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  This checklist will be saved with the dataset so the operator can
                  follow up.
                </p>
              </CardContent>
            </Card>
          )}

          {error && (
            <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
