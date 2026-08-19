import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

export interface DuckDBBundlePaths {
  mainModule: string;
  mainWorker: string;
  pthreadWorker: string | null;
  coi: boolean;
}

export interface DuckDBPlatformFeatures {
  crossOriginIsolated: boolean;
  wasmThreads: boolean;
  wasmSIMD: boolean;
  wasmExceptions: boolean;
  bigInt64Array: boolean;
}

export interface DuckDBInstanceOptions {
  maximumThreads?: number;
  onProgress?: (pct: number) => void;
}

let platformFeaturesPromise: Promise<DuckDBPlatformFeatures> | null = null;

export async function getPlatformFeatures(): Promise<DuckDBPlatformFeatures> {
  if (!platformFeaturesPromise) {
    const { getPlatformFeatures: f } = await import("@duckdb/duckdb-wasm");
    platformFeaturesPromise = f().then((p) => ({
      crossOriginIsolated: p.crossOriginIsolated,
      wasmThreads: p.wasmThreads,
      wasmSIMD: p.wasmSIMD,
      wasmExceptions: p.wasmExceptions,
      bigInt64Array: p.bigInt64Array,
    }));
  }
  return platformFeaturesPromise;
}

/**
 * Select the DuckDB bundle for the current browser. The fast COI bundle
 * (SIMD + threads) requires Cross-Origin Isolation; otherwise we fall back
 * to the EH bundle (single-threaded). Assets live in public/duckdb/ — see
 * scripts/copy-duckdb-assets.mjs.
 */
export async function selectBundle(): Promise<DuckDBBundlePaths> {
  const features = await getPlatformFeatures();
  if (features.crossOriginIsolated && features.wasmThreads && features.wasmSIMD) {
    return {
      mainModule: "/duckdb/duckdb-coi.wasm",
      mainWorker: "/duckdb/duckdb-browser-coi.worker.js",
      pthreadWorker: "/duckdb/duckdb-browser-coi.pthread.worker.js",
      coi: true,
    };
  }
  return {
    mainModule: "/duckdb/duckdb-eh.wasm",
    mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
    pthreadWorker: null,
    coi: false,
  };
}

let dbPromise: Promise<DuckDBSession> | null = null;

export interface DuckDBSession {
  db: AsyncDuckDB;
  connection: AsyncDuckDBConnection;
  bundle: DuckDBBundlePaths;
}

async function buildSession(options: DuckDBInstanceOptions): Promise<DuckDBSession> {
  const [{ ConsoleLogger }, { AsyncDuckDB }, bundle] = await Promise.all([
    import("@duckdb/duckdb-wasm"),
    import("@duckdb/duckdb-wasm"),
    selectBundle(),
  ]);

  const worker = new Worker(bundle.mainWorker);
  const db = new AsyncDuckDB(new ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({
    path: ":memory:",
    maximumThreads: bundle.coi ? (options.maximumThreads ?? navigator.hardwareConcurrency) : 1,
  });
  const connection = await db.connect();
  return { db, connection, bundle };
}

export async function getDuckDB(options?: DuckDBInstanceOptions): Promise<DuckDBSession> {
  if (typeof window === "undefined") {
    throw new Error("DuckDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = buildSession(options ?? {});
  }
  return dbPromise;
}

export async function queryRows<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const session = await getDuckDB();
  const arrow = await session.connection.query(sql);
  const out: T[] = [];
  for (let i = 0; i < arrow.numRows; i++) {
    const row = arrow.get(i);
    if (row) out.push((row.toJSON() as unknown) as T);
  }
  return out;
}

export async function executeSql(sql: string): Promise<void> {
  const session = await getDuckDB();
  await session.connection.query(sql);
}

/** Register a File/Buffer from the browser into DuckDB's virtual FS. */
export async function registerFileHandle(
  name: string,
  handle: File | Uint8Array,
  directIO = true,
): Promise<void> {
  const session = await getDuckDB();
  const { DuckDBDataProtocol } = await import("@duckdb/duckdb-wasm");
  await session.db.registerFileHandle(
    name,
    handle,
    DuckDBDataProtocol.BROWSER_FILEREADER,
    directIO,
  );
}

export async function dropFile(name: string): Promise<void> {
  const session = await getDuckDB();
  await session.db.dropFile(name);
}

export async function terminateDuckDB(): Promise<void> {
  if (!dbPromise) return;
  const session = await dbPromise;
  await session.connection.close();
  await session.db.terminate();
  dbPromise = null;
}

