import { describe, expect, it } from "vitest";
import { parseFileForPreview } from "@/lib/parse";

describe("parseFileForPreview", () => {
  it("parses a CSV preview and infers types", async () => {
    const csv = new File(
      ["name,amount,active\nAlice,10,true\nBob,20,false\nCarol,abc,true\n"],
      "sample.csv",
      { type: "text/csv" },
    );
    const result = await parseFileForPreview(csv);
    expect(result.fileKind).toBe("csv");
    const sheet = result.sheets[0];
    expect(sheet.headers).toEqual(["name", "amount", "active"]);
    expect(sheet.sampleRows).toHaveLength(3);
    const types = Object.fromEntries(sheet.inferred.map((c) => [c.key, c.type]));
    expect(types.amount).toBe("string"); // "abc" in row 3 forces string
    expect(types.active).toBe("boolean");
    expect(types.name).toBe("string");
  });

  it("parses an XLSX preview across sheets", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["id", "value"],
        [1, 100],
        [2, 200],
      ]),
      "Sheet1",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const xlsxFile = new File([bytes], "sample.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await parseFileForPreview(xlsxFile);
    expect(result.fileKind).toBe("xlsx");
    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.headers).toEqual(["id", "value"]);
    expect(sheet.sampleRows[0]).toEqual(["1", "100"]);
    const types = Object.fromEntries(sheet.inferred.map((c) => [c.key, c.type]));
    expect(types.id).toBe("numeric");
    expect(types.value).toBe("numeric");
  });

  it("throws on unsupported file types", async () => {
    const txt = new File(["hello"], "a.txt", { type: "text/plain" });
    await expect(parseFileForPreview(txt)).rejects.toThrow(/Unsupported/);
  });
});