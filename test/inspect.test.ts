import { describe, expect, it } from "vitest";
import { inspectFile } from "@/lib/inspect";

function csvBuffer(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("inspectFile CSV", () => {
  it("single populated sheet proceeds automatically", () => {
    const result = inspectFile(
      csvBuffer("name,amount\nAlice,10\nBob,20\n"),
      "data.csv",
    );
    expect(result.decision.kind).toBe("single");
    if (result.decision.kind === "single") {
      expect(result.decision.sheet.header).toEqual(["name", "amount"]);
      expect(result.decision.sheet.hasData).toBe(true);
    }
  });

  it("rejects header-only files", () => {
    const result = inspectFile(csvBuffer("name,amount\n"), "data.csv");
    const decision = result.decision as {
      kind: "error";
      error: string;
      message: string;
    };
    expect(decision.kind).toBe("error");
    expect(decision.error).toBe("NO_DATA");
  });

  it("rejects empty files", () => {
    const result = inspectFile(csvBuffer(""), "data.csv");
    expect(result.decision.kind).toBe("error");
  });
});

describe("inspectFile XLSX", () => {
  it("handles multiple populated sheets via picker", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["id", "value"],
        [1, 10],
        [2, 20],
      ]),
      "First",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["a"],
        ["x"],
      ]),
      "Second",
    );
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = inspectFile(new Uint8Array(buffer), "multi.xlsx");
    expect(result.decision.kind).toBe("picker");
    if (result.decision.kind === "picker") {
      expect(result.decision.sheets.map((s) => s.name)).toEqual(["First", "Second"]);
    }
  });

  it("auto-selects the single populated sheet, skipping empty ones", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["only", "header"]]),
      "HeaderOnly",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["x"],
        [1],
      ]),
      "Data",
    );
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = inspectFile(new Uint8Array(buffer), "multi.xlsx");
    expect(result.decision.kind).toBe("auto_populated");
    if (result.decision.kind === "auto_populated") {
      expect(result.decision.sheet.name).toBe("Data");
      expect(result.decision.skipped).toEqual(["Empty", "HeaderOnly"]);
    }
  });

  it("rejects when no sheet has data", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["h1", "h2"]]), "Only");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = inspectFile(new Uint8Array(buffer), "empty.xlsx");
    const decision = result.decision as {
      kind: "error";
      error: string;
      message: string;
    };
    expect(decision.kind).toBe("error");
    expect(decision.error).toBe("NO_DATA");
  });
});