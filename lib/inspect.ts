import Papa from "papaparse";
import * as XLSX from "xlsx";
import { MAX_ROWS } from "./constants";
import type { InspectResult, InspectSheetInfo } from "./types";

function countCsvRows(buffer: Uint8Array): number {
  let lines = 1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) lines++;
  }
  const nonEmpty = buffer.length > 0 ? lines - 1 : 0;
  return Math.max(nonEmpty - 1, 0);
}

function inspectCsv(buffer: Uint8Array): InspectResult {
  const text = new TextDecoder("utf-8").decode(buffer);
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    preview: 3,
  });
  const rows = parsed.data;
  if (rows.length === 0 || rows[0].length === 0) {
    return { decision: { kind: "error", error: "EMPTY_SHEET", message: "The CSV file appears to be empty." } };
  }
  const headers = rows[0].map((h) => h?.trim() ?? "");
  if (headers.every((h) => h === "")) {
    return { decision: { kind: "error", error: "EMPTY_SHEET", message: "The CSV has no usable header row." } };
  }
  const hasData = rows.length > 1;
  const rowEstimate = countCsvRows(buffer);
  if (rowEstimate > MAX_ROWS) {
    return {
      decision: {
        kind: "error",
        error: "TOO_MANY_ROWS",
        message: `This file has an estimated ${rowEstimate.toLocaleString()} data rows, exceeding the ${MAX_ROWS.toLocaleString()} row limit.`,
      },
    };
  }
  const sheet: InspectSheetInfo = { name: "Sheet1", header: headers, hasData, rowEstimate };
  if (!hasData) {
    return { decision: { kind: "error", error: "NO_DATA", message: "The CSV contains only a header row with no data." } };
  }
  return { decision: { kind: "single", sheet } };
}

function inspectXlsx(buffer: Uint8Array): InspectResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { sheetRows: 3, cellDates: true });
  } catch {
    return { decision: { kind: "error", error: "UNSUPPORTED", message: "Could not read this Excel file." } };
  }

  if (workbook.SheetNames.length === 0) {
    return { decision: { kind: "error", error: "EMPTY_SHEET", message: "The workbook has no sheets." } };
  }

  const sheets: InspectSheetInfo[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const rows = raw.map((r) => (Array.isArray(r) ? r : []));
    const header = (rows[0] ?? []).map((v) => (v === null || v === undefined ? "" : String(v)));
    const ref = sheet["!ref"];
    const lastRow = ref ? parseInt(ref.split(":")[1]?.replace(/[^0-9]/g, "") ?? "0", 10) : 0;
    return {
      name,
      header,
      hasData: rows.length > 1,
      rowEstimate: isNaN(lastRow) ? Math.max(rows.length - 1, 0) : Math.max(lastRow - 1, 0),
    };
  });

  const withData = sheets.filter((s) => s.hasData);

  if (withData.length === 0) {
    const message = sheets.some((s) => s.header.length === 0)
      ? "The workbook has no usable sheets."
      : "None of the sheets contain data beyond a header row.";
    return { decision: { kind: "error", error: "NO_DATA", message } };
  }

  const empty = sheets.filter((s) => !s.hasData);
  const overLimit = withData.find((s) => s.rowEstimate > MAX_ROWS);
  if (overLimit) {
    return {
      decision: {
        kind: "error",
        error: "TOO_MANY_ROWS",
        message: `Sheet "${overLimit.name}" has an estimated ${overLimit.rowEstimate.toLocaleString()} data rows, exceeding the ${MAX_ROWS.toLocaleString()} row limit.`,
      },
    };
  }

  if (sheets.length === 1) {
    return { decision: { kind: "single", sheet: sheets[0] } };
  }

  if (withData.length === 1) {
    return {
      decision: {
        kind: "auto_populated",
        sheet: withData[0],
        skipped: empty.map((s) => s.name),
      },
    };
  }

  return { decision: { kind: "picker", sheets: withData } };
}

export function inspectFile(buffer: Uint8Array, fileName: string): InspectResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return inspectCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return inspectXlsx(buffer);
  return { decision: { kind: "error", error: "UNSUPPORTED", message: "Unsupported file type." } };
}
