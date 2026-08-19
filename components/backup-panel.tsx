"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CloudUpload,
  Download,
  FileUp,
  HardDriveDownload,
  Loader2,
  RefreshCcw,
  DatabaseBackup,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSupabase } from "@/lib/supabase/provider";
import {
  downloadLocalJsonBackup,
  downloadParquetBackup,
  listParquetBackups,
  restoreFromJsonFile,
  restoreLatestBackup,
  uploadParquetBackup,
  type ParquetBackupInfo,
} from "@/lib/actions/dataset-backup";
import type { ColumnDef } from "@/lib/types";

interface BackupPanelProps {
  datasetId: string;
  fileName: string;
  columns: ColumnDef[];
}

export function BackupPanel({ datasetId, fileName, columns }: BackupPanelProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const { refresh } = useRouter();
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState<string | null>(null);
  const [backups, setBackups] = useState<ParquetBackupInfo[]>([]);
  const [listed, setListed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const base = fileName.replace(/\.[^/.]+$/, "") || "dataset";

  const refreshBackups = useCallback(async () => {
    const res = await listParquetBackups(supabase, datasetId);
    if (res.ok) {
      setBackups(res.backups);
      setListed(true);
    }
  }, [supabase, datasetId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await listParquetBackups(supabase, datasetId);
      if (!alive) return;
      if (res.ok) {
        setBackups(res.backups);
        setListed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase, datasetId]);

  const invalidate = useCallback(() => {
    refresh();
    queryClient.invalidateQueries({ queryKey: ["local-rows", datasetId] });
    queryClient.invalidateQueries({ queryKey: ["rows", datasetId] });
    queryClient.invalidateQueries({ queryKey: ["row-count", datasetId] });
    queryClient.invalidateQueries({ queryKey: ["stats", datasetId] });
  }, [queryClient, datasetId, refresh]);

  const run = useCallback(
    async (key: string, task: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(key);
      try {
        const res = await task();
        if (res && typeof res === "object" && "ok" in res && !(res as { ok: boolean }).ok) {
          const err = (res as { error?: string }).error ?? "Operation failed";
          toast({ kind: "error", text: err });
          return;
        }
        if (key === "restore-file" || key === "restore-latest") {
          invalidate();
          toast({ kind: "success", text: "Restored — the table now shows the backup." });
        } else {
          toast({ text: "Done." });
        }
      } catch (e) {
        toast({ kind: "error", text: e instanceof Error ? e.message : "Operation failed" });
      } finally {
        setBusy(null);
      }
    },
    [busy, toast, invalidate],
  );

  const handleRestoreFile = async (file: File | null) => {
    if (!file) return;
    await run("restore-file", () => restoreFromJsonFile(datasetId, file));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-foreground">Backup & sync</h3>
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-faint">
              OPFS is evictable — keep a portable copy
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                run("export-parquet", () =>
                  downloadParquetBackup(datasetId, `${base}${columns.length > 0 ? "_backup" : ""}.parquet`),
                )
              }
              title="Export the current rows as a real columnar .parquet file (via DuckDB)"
            >
              {busy === "export-parquet" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="h-3.5 w-3.5" />
              )}
              Export .parquet
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                run("export-json", () =>
                  downloadLocalJsonBackup(datasetId, `${base}_snapshot.json`),
                )
              }
              title="Export the full OPFS snapshot (rows + columns) as JSON"
            >
              {busy === "export-json" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export JSON snapshot
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                run("upload", () =>
                  uploadParquetBackup(supabase, datasetId, `${base}_${Date.now()}.parquet`),
                )
              }
              title="Encrypted-at-rest cloud sync for another device (private to you)"
            >
              {busy === "upload" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5" />
              )}
              Sync to cloud
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              title="Restore this dataset from a JSON snapshot file you exported elsewhere"
            >
              {busy === "restore-file" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileUp className="h-3.5 w-3.5" />
              )}
              Restore from file…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => handleRestoreFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-faint">
                Cloud backups{listed ? ` · ${backups.length} stored` : ""}
              </p>
              <Button size="sm" variant="ghost" onClick={refreshBackups} disabled={busy !== null}>
                <RefreshCcw className="h-3 w-3" />
                Refresh
              </Button>
            </div>
            {listed && backups.length === 0 && (
              <p className="text-xs text-faint">
                Nothing synced yet — use “Sync to cloud” to store a portable parquet.
              </p>
            )}
            {backups.slice(0, 5).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{b.name}</p>
                  <p className="text-xs text-faint">
                    {(b.size / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {backups.length > 0 && (
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() =>
                    run("restore-latest", () => restoreLatestBackup(supabase, datasetId, columns))
                  }
                  title="Replace the local data plane with the most recent cloud backup"
                >
                  {busy === "restore-latest" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  Restore latest
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}