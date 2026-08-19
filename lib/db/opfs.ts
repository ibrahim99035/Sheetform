import type { ColumnDef, Operation } from "@/lib/types";

/**
 * OPFS-backed persistence for the local (DuckDB) data plane.
 *
 * OPFS is evicted under storage pressure and wiped by incognito / "clear site
 * data", so callers must treat `downloadBackup`/cloud sync as first-class —
 * this layer is durability for the current device, not the backup.
 */

export interface DatasetSnapshot {
  columnDefs: ColumnDef[];
  rows: Record<string, unknown>[];
  sourceFile: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface DatasetMeta {
  id: string;
  name: string;
  kind: "sales" | "inventory";
  snapshotVersion: number;
  updatedAt: string;
}

export interface OpsSnapshot {
  operations: Operation[];
}

const VERSION_DIR = "v1";
const DATASETS_DIR = "datasets";
const META_DIR = "meta";
const OPS_DIR = "ops";

let rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

export function isOpfsAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsAvailable()) {
    throw new Error("OPFS is not available in this browser");
  }
  if (!rootPromise) {
    rootPromise = navigator.storage.getDirectory().then(async (root) => {
      const version = await root.getDirectoryHandle(VERSION_DIR, { create: true });
      return version;
    });
  }
  return rootPromise;
}

async function getDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  return root.getDirectoryHandle(name, { create: true });
}

async function writeFile(
  dirName: string,
  fileName: string,
  text: string,
): Promise<void> {
  const dir = await getDir(dirName);
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readFile(
  dirName: string,
  fileName: string,
): Promise<string | null> {
  try {
    const dir = await getDir(dirName);
    const handle = await dir.getFileHandle(fileName);
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function listFiles(dirName: string): Promise<string[]> {
  try {
    const dir = await getDir(dirName);
    const out: string[] = [];
    const iterable = dir as FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemHandle>;
    };
    for await (const entry of iterable.values()) {
      if (entry.kind === "file") out.push(entry.name);
    }
    return out;
  } catch {
    return [];
  }
}

async function removeFile(dirName: string, fileName: string): Promise<void> {
  try {
    const dir = await getDir(dirName);
    await dir.removeEntry(fileName);
  } catch {
    // nothing to remove
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---- dataset snapshots ----

export async function persistDataset(
  datasetId: string,
  snapshot: DatasetSnapshot,
): Promise<void> {
  const safe = sanitizeId(datasetId);
  await writeFile(DATASETS_DIR, `${safe}.json`, JSON.stringify(snapshot));
}

export async function loadDataset(
  datasetId: string,
): Promise<DatasetSnapshot | null> {
  const safe = sanitizeId(datasetId);
  const text = await readFile(DATASETS_DIR, `${safe}.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as DatasetSnapshot;
  } catch {
    return null;
  }
}

export async function removeDataset(datasetId: string): Promise<void> {
  const safe = sanitizeId(datasetId);
  await removeFile(DATASETS_DIR, `${safe}.json`);
  await removeFile(META_DIR, `${safe}.json`);
  await removeFile(OPS_DIR, `${safe}.json`);
}

export async function listDatasetIds(): Promise<string[]> {
  const files = await listFiles(DATASETS_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

// ---- meta ----

export async function persistMeta(meta: DatasetMeta): Promise<void> {
  await writeFile(META_DIR, `${sanitizeId(meta.id)}.json`, JSON.stringify(meta));
}

export async function loadMeta(datasetId: string): Promise<DatasetMeta | null> {
  const text = await readFile(META_DIR, `${sanitizeId(datasetId)}.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as DatasetMeta;
  } catch {
    return null;
  }
}

// ---- operations (op queue + undo stack) ----

export async function persistOps(
  datasetId: string,
  snapshot: OpsSnapshot,
): Promise<void> {
  await writeFile(OPS_DIR, `${sanitizeId(datasetId)}.json`, JSON.stringify(snapshot));
}

export async function loadOps(datasetId: string): Promise<OpsSnapshot | null> {
  const text = await readFile(OPS_DIR, `${sanitizeId(datasetId)}.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as OpsSnapshot;
  } catch {
    return null;
  }
}

// ---- backup / restore (portability) ----

export async function exportDatasetAsJson(
  datasetId: string,
  fileName: string,
): Promise<boolean> {
  const snapshot = await loadDataset(datasetId);
  if (!snapshot) return false;
  downloadBlob(fileName, JSON.stringify(snapshot, null, 2));
  return true;
}

export function downloadBlob(fileName: string, content: string | Blob): void {
  const blob = typeof content === "string" ? new Blob([content]) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearAll(): Promise<FileSystemDirectoryHandle[]> {
  return Promise.all([getDir(DATASETS_DIR), getDir(META_DIR), getDir(OPS_DIR)].map((p) => p));
}

export { sanitizeId };