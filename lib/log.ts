// Structured JSON-line logger.
//
// Emits one JSON object per record to stdout (info/debug) or stderr
// (warn/error); ingest the stream as-is in Vercel logs or Supabase Log
// Shuttle. Each request carries a requestId for correlation across logs.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogMeta {
  [key: string]: unknown;
}

let requestId: string | undefined;

export function setRequestId(id: string | undefined): void {
  requestId = id;
}

export function getRequestId(): string | undefined {
  return requestId;
}

export function newRequestId(): string {
  requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return requestId;
}

function emit(level: LogLevel, message: string, meta: LogMeta = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    requestId: requestId ?? null,
    ...meta,
  };
  const line = JSON.stringify(record);
  if (level === "warn" || level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (message: string, meta?: LogMeta) => emit("debug", message, meta),
  info: (message: string, meta?: LogMeta) => emit("info", message, meta),
  warn: (message: string, meta?: LogMeta) => emit("warn", message, meta),
  error: (message: string, meta?: LogMeta) => emit("error", message, meta),
};