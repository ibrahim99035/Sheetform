import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/admin";
import { STORAGE_BUCKET } from "@/lib/constants";
import type { Dataset, ViewState } from "@/lib/types";

async function signedOriginalUrl(user: { id: string }, datasetId: string) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  const { data: dataset } = await admin
    .from("datasets")
    .select("storage_path, owner_id")
    .eq("id", datasetId)
    .single();

  if (!dataset || (dataset.owner_id !== user.id && !(await isSuperAdmin()))) return null;

  const { data } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(dataset.storage_path, 600);

  return data?.signedUrl ?? null;
}

async function auditExport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  datasetId: string,
  format: string,
): Promise<void> {
  try {
    await supabase.rpc("append_audit", {
      p_action: "export",
      p_entity_type: "datasets",
      p_entity_id: datasetId,
      p_metadata: { format },
    });
  } catch {
    // Auditing must never break the export itself.
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  const viewParam = url.searchParams.get("view");

  if (format === "original") {
    const signed = await signedOriginalUrl(user, id);
    if (!signed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await auditExport(supabase, id, format);
    return new NextResponse("", {
      status: 302,
      headers: { Location: signed },
    });
  }

  let view: ViewState = { sort: null, filters: [] };
  if (viewParam) {
    try {
      view = JSON.parse(viewParam) as ViewState;
    } catch {
      return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    }
  }

  const { data: dataset } = await supabase
    .from("datasets")
    .select("id, name, original_filename, column_defs, row_count")
    .eq("id", id)
    .single();

  if (!dataset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await auditExport(supabase, id, format);

  const columns = (dataset.column_defs ?? []) as Dataset["column_defs"];
  const pageSize = 5000;
  const allRows: Array<Array<unknown>> = [];
  let offset = 0;

  // Download the full result of the current view (sorted + filtered).
  for (;;) {
    const { data: page, error } = await supabase.rpc("get_dataset_rows", {
      p_dataset_id: id,
      p_view: view,
      p_page_size: pageSize,
      p_page_offset: offset,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (page ?? []) as Array<{ row_index: number; data: Record<string, unknown> }>;
    for (const row of rows) {
      allRows.push(columns.map((c) => row.data[c.key]));
    }
    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  if (format === "xlsx") {
    const sheet = XLSX.utils.aoa_to_sheet([
      columns.map((c) => c.label),
      ...allRows,
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "data");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${dataset.original_filename.replace(/\.(csv|xlsx|xls)$/i, "")}-export.xlsx"`,
      },
    });
  }

  // CSV — streamed row by row.
  const csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headerLine = columns.map((c) => csvEscape(c.label)).join(",") + "\n";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("\uFEFF" + headerLine));
    },
    pull(controller) {
      const row = allRows.shift();
      if (row === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(row.map(csvEscape).join(",") + "\n"));
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataset.original_filename.replace(/\.(csv|xlsx|xls)$/i, "")}-export.csv"`,
    },
  });
}