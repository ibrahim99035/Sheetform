"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/file-dropzone";
import { PreviewTable } from "@/components/preview-table";
import { parseFileForPreview, type PreviewSheet } from "@/lib/parse";
import { useSupabase } from "@/lib/supabase/provider";
import type { InferredColumn } from "@/lib/types";
import { createDataset } from "@/lib/actions/datasets";

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

  const populatedSheets = useMemo(
    () => sheets.filter((s) => s.hasData && s.headers.length > 0),
    [sheets],
  );

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

      const chosen = populated.length === 1 ? populated[0] : populated[0];
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
        columns: columns.map((c) => ({ label: c.label, type: c.type })),
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
  };

  return (
    <div className="space-y-4">
      {stage === "select" && (
        <>
          <FileDropzone onFile={handleFile} disabled={busy} />
          {busy && <p className="text-sm text-neutral-500">Parsing preview…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}

      {stage === "ready" && activeSheet && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-neutral-900">{file?.name}</h2>
              <p className="text-sm text-neutral-500">
                Sheet “{activeSheet.name}” · {activeSheet.rowEstimate.toLocaleString()} rows (est.)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                disabled={busy}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-60"
              >
                Choose another file
              </button>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
              >
                {busy ? "Uploading…" : "Import dataset"}
              </button>
            </div>
          </div>

          {populatedSheets.length > 1 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <label className="mb-2 block text-sm font-medium text-neutral-700">
                This file has {sheets.length} sheets with data. Which one do you want to import?
              </label>
              <select
                value={activeSheet.name}
                onChange={(e) => {
                  const next = populatedSheets.find((s) => s.name === e.target.value);
                  if (next) {
                    setActiveSheet(next);
                    setColumns(next.inferred);
                  }
                }}
                className="w-full max-w-md rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              >
                {populatedSheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} — {s.rowEstimate.toLocaleString()} rows (est.)
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-sm text-neutral-600">
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

          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}