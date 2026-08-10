import Papa from "papaparse";
import * as XLSX from "xlsx";
import { PREVIEW_ROWS } from "./constants";
import { inferType, makeUniqueKeys } from "./coerce";
import type { InferredColumn, ColumnType } from "./types";

export interface PreviewSheet {
  name: string;
  headers: string[];
  sampleRows: string[][];
  inferred: InferredColumn[];
  rowEstimate: number;
  hasData: boolean;
}

export interface PreviewResult {
  fileName: string;
  fileKind: "csv" | "xlsx";
  sheets: PreviewSheet[];
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function inferColumns(headers: string[], sampleRows: string[][]): InferredColumn[] {
  const keys = makeUniqueKeys(headers);
  const columnCount = headers.length;

  return Array.from({ length: columnCount }, (_, colIndex) => {
    const values = sampleRows.map((row) => row[colIndex]);
    const type: ColumnType = inferType(values);
    return {
      key: keys[colIndex],
      label: headers[colIndex],
      type,
    };
  });
}

export async function parseFileForPreview(file: File): Promise<PreviewResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
      preview: PREVIEW_ROWS + 1,
    });
    const rows = parsed.data;
    const headers = (rows[0] ?? []).map(toText);
    const sampleRows = rows.slice(1).map((row) => row.map(toText));
    const inferred = inferColumns(headers, sampleRows);
    const roughEstimate = Math.max(sampleRows.length, Math.floor(file.size / 24));
    return {
      fileName: file.name,
      fileKind: "csv",
      sheets: [
        {
          name: "Sheet1",
          headers,
          sampleRows,
          inferred,
          rowEstimate: roughEstimate,
          hasData: sampleRows.length > 0,
        },
      ],
    };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      sheetRows: PREVIEW_ROWS + 2,
      cellDates: true,
    });
    const sheets: PreviewSheet[] = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
      });
      const rows = raw.map((row) => (Array.isArray(row) ? row.map(toText) : []));
      const headers = rows[0] ?? [];
      const sampleRows = rows.slice(1, PREVIEW_ROWS + 1);
      const ref = sheet["!ref"];
      const estimatedRows = ref ? parseInt(ref.split(":")[1].replace(/[^0-9]/g, ""), 10) : sampleRows.length;
      return {
        name: sheetName,
        headers,
        sampleRows,
        inferred: inferColumns(headers, sampleRows),
        rowEstimate: isNaN(estimatedRows) ? sampleRows.length : estimatedRows,
        hasData: rows.length > 1,
      };
    });
    return { fileName: file.name, fileKind: "xlsx", sheets };
  }

  throw new Error("Unsupported file type. Please upload a .csv or .xlsx file.");
}
