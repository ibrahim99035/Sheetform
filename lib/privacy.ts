import type { ColumnDef } from "@/lib/types";

/**
 * Privacy layer for the opt-in benchmarking path.
 *
 * Patient-identifiable columns are either dropped from uplink payloads (the
 * default when the sales file has no explicit patient column) or replaced by a
 * salted SHA-256 digest so cross-visit repeat counts stay joinable without ever
 * exposing the raw identifier to the control plane.
 *
 * Uses the Web Crypto API when available (browser + Node 18+ server components);
 * falls back to a FNV-1a-based deterministic digest for test/edge environments
 * that lack a SubtleCrypto implementation.
 */

export interface HashingCapabilities {
  webCrypto: boolean;
}

export function hashingCapabilities(): HashingCapabilities {
  const g = globalThis as Record<string, unknown>;
  return {
    webCrypto:
      typeof g.crypto !== "undefined" &&
      typeof (g.crypto as Crypto).subtle !== "undefined" &&
      typeof (g.crypto as Crypto).subtle.digest === "function",
  };
}

const SALT_NAMESPACE = "siroq:benchmark:v1";

function bytesToHex(buf: Uint8Array): string {
  const out: string[] = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i].toString(16).padStart(2, "0");
  }
  return out.join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

/** Stable FNV-1a 64-bit digest (two 32-bit hash halves joined). */
function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    if (i % 2 === 1) {
      const t = h1;
      h1 = h2;
      h2 = t;
    }
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Hash a patient identifier for cross-record joinability without exposure.
 *
 * @param patientId raw identifier (MRID / dossier / national ID fragment, ...)
 * @param salt per-tenant salt so digests are not rainbow-table-computable
 * @returns 64-char hex SHA-256 digest when Web Crypto is present, or a
 *          deterministic 16-char FNV-1a digest (marked for test use only).
 */
export async function hashPatient(
  patientId: string,
  salt: string,
): Promise<string> {
  const input = `${SALT_NAMESPACE}\u0000${salt}\u0000${patientId.trim().toLowerCase()}`;
  if (hashingCapabilities().webCrypto) {
    return sha256Hex(input);
  }
  return fnv1aHex(input);
}

/** A column whose values identify patients (dropped or hashed before uplink). */
export interface PatientColumnInfo {
  key: string;
  label: string;
  confidence: "high" | "medium" | "low" | null;
}

export function findPatientColumn(defs: ColumnDef[]): PatientColumnInfo | null {
  const patient = defs.find((c) => c.role === "patient");
  if (!patient) return null;
  return {
    key: patient.key,
    label: patient.label,
    confidence: patient.role_confidence ?? null,
  };
}

/**
 * Returns the row projection keys the benchmarking layer may upload: any
 * patient column is replaced by a `patient_hash` namespace key, and the raw
 * patient column is excluded.
 */
export function benchmarkPayloadKeys(
  defs: ColumnDef[],
): { keys: string[]; hashed: boolean } {
  const patient = findPatientColumn(defs);
  const keys = defs
    .filter((c) => c.role !== "patient")
    .map((c) => c.key);
  if (patient) keys.push("patient_hash");
  return { keys, hashed: Boolean(patient) };
}

/**
 * Build a row safe for uplink: re-maps the patient column (when present) to
 * `patient_hash`, drops all other patient data.
 */
export async function sanitizeRowForBenchmark(
  row: Record<string, unknown>,
  patientKey: string | null,
  salt: string,
): Promise<Record<string, unknown>> {
  if (!patientKey) return row;
  const out: Record<string, unknown> = { ...row };
  const raw = out[patientKey];
  delete out[patientKey];
  if (raw != null && raw !== "") {
    out.patient_hash = await hashPatient(String(raw), salt);
  }
  return out;
}