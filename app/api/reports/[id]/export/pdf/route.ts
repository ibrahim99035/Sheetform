import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { createClient } from "@/lib/supabase/server";
import type { ReportDetail } from "@/lib/reports";
import { richTextToText } from "@/lib/rich-text";

export const dynamic = "force-dynamic";

const visibilityLabel: Record<string, string> = {
  org: "Full access",
  restricted: "Exclusive",
  branch: "Branch",
};

async function getDetail(reportId: string): Promise<ReportDetail | null> {
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return null;

  const [orgRes, branchRes, compRes, itemRes, appRes, delRes] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", report.organization_id).maybeSingle(),
    report.branch_id
      ? supabase.from("branches").select("name").eq("id", report.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("report_components").select("*").eq("report_id", reportId).order("sort_order"),
    supabase.from("report_items").select("*").eq("report_id", reportId).order("sort_order"),
    supabase.from("report_applications").select("application_id").eq("report_id", reportId),
    supabase.from("deliveries").select("*").eq("report_id", reportId).order("created_at", { ascending: false }),
  ]);

  return {
    report: {
      ...report,
      org_name: ((orgRes.data as { name: string } | null)?.name ?? "—"),
      branch_name: (branchRes.data as { name: string } | null)?.name ?? null,
    },
    components: (compRes.data ?? []) as ReportDetail["components"],
    items: (itemRes.data ?? []) as ReportDetail["items"],
    applications: (((appRes.data ?? []) as { application_id: string }[]).map((a) => ({
      application_id: a.application_id,
      title: "",
      status: "",
    }))) as ReportDetail["applications"],
    deliveries: (delRes.data ?? []) as ReportDetail["deliveries"],
  };
}

function textOf(body: Record<string, unknown> | null | undefined): string {
  if (!body) return "";
  if ("text" in body) return richTextToText(body.text);
  return "";
}

/** Render the same visual blocks the web viewer shows, into a PDF. */
function renderBody(
  doc: PDFKit.PDFDocument,
  body: Record<string, unknown> | null | undefined,
  y: { value: number },
  maxWidth: number,
) {
  if (!body) return;
  if ("text" in body) {
    const text = textOf(body);
    if (!text.trim()) return;
    y.value += 6;
    doc.fontSize(10).fillColor("#333333").text(text, 72, y.value, { width: maxWidth, lineGap: 3 });
    y.value = doc.y + 8;
    return;
  }
  if (Array.isArray(body.series)) {
    const series = body.series as { bucket?: string; value?: number | null }[];
    const max = Math.max(...series.map((s) => Number(s.value ?? 0)), 1);
    y.value += 6;
    for (const s of series) {
      const label = String(s.bucket ?? "");
      const value = Number(s.value ?? 0);
      doc.fontSize(8).fillColor("#666666").text(label, 72, y.value, { width: 110 });
      const barW = (value / max) * (maxWidth - 150);
      doc.roundedRect(190, y.value + 1, Math.max(1, barW), 9, 2).fill("#6c8ebf");
      doc.fontSize(8).fillColor("#333333").text(value.toLocaleString(), 190 + barW + 4, y.value, { width: 60 });
      y.value += 14;
    }
    y.value += 4;
    return;
  }
  // Table rendering (columns + rows)
  if (Array.isArray(body.columns) && Array.isArray(body.rows)) {
    const columns = body.columns as { key: string; label: string }[];
    const rows = body.rows as Record<string, unknown>[];
    if (columns.length === 0 || rows.length === 0) return;

    const colWidth = Math.floor(maxWidth / columns.length);
    y.value += 6;

    // Header row
    doc.fontSize(8).fillColor("#666666");
    for (let i = 0; i < columns.length; i++) {
      doc.text(columns[i].label, 72 + i * colWidth, y.value, { width: colWidth - 4, lineGap: 1 });
    }
    y.value = doc.y + 2;

    // Divider line
    doc.moveTo(72, y.value).lineTo(72 + maxWidth, y.value).strokeColor("#cccccc").lineWidth(0.5).stroke();
    y.value += 4;

    // Data rows
    doc.fontSize(8).fillColor("#333333");
    for (const row of rows.slice(0, 50)) {
      for (let i = 0; i < columns.length; i++) {
        const val = row[columns[i].key];
        doc.text(
          val == null ? "—" : typeof val === "number" ? val.toLocaleString() : String(val),
          72 + i * colWidth,
          y.value,
          { width: colWidth - 4, lineGap: 1 },
        );
      }
      y.value = doc.y + 2;

      if (y.value > 720) {
        doc.addPage();
        y.value = 64;
        // Repeat header on new page
        doc.fontSize(8).fillColor("#666666");
        for (let i = 0; i < columns.length; i++) {
          doc.text(columns[i].label, 72 + i * colWidth, y.value, { width: colWidth - 4, lineGap: 1 });
        }
        y.value = doc.y + 2;
        doc.moveTo(72, y.value).lineTo(72 + maxWidth, y.value).strokeColor("#cccccc").lineWidth(0.5).stroke();
        y.value += 4;
        doc.fontSize(8).fillColor("#333333");
      }
    }
    if (rows.length > 50) {
      doc.fontSize(7).fillColor("#888888").text(`… and ${rows.length - 50} more rows`, 72, y.value);
      y.value = doc.y + 4;
    }
    y.value += 4;
    return;
  }
  // Generic key/value grid (insight bodies).
  const entries = Object.entries(body).filter(([, v]) => typeof v !== "object");
  if (entries.length === 0) return;
  y.value += 6;
  doc.fontSize(9).fillColor("#333333");
  for (const [k, v] of entries) {
    doc.text(`${k}: ${String(v)}`, 72, y.value, { width: maxWidth, lineGap: 2 });
    y.value = doc.y + 2;
  }
  y.value += 4;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const detail = await getDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { report, components, items, applications } = detail;

  const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 72, right: 72 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(Buffer.from(c)));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  // Header
  doc.fontSize(20).fillColor("#111111").text(report.title, { width: 456 });
  doc.moveDown(0.4);
  doc
    .fontSize(9)
    .fillColor("#666666")
    .text(
      `${report.org_name}${report.branch_name ? ` · ${report.branch_name}` : " · org-wide"} · ${report.status}` +
        `${report.published_at ? ` · published ${new Date(report.published_at).toLocaleDateString()}` : ""}`,
      { width: 456 },
    );
  if (report.summary) {
    doc.moveDown(0.6);
    doc.fontSize(11).fillColor("#333333").text(report.summary, { width: 456 });
  }
  doc.moveDown(0.8);

  const y = { value: doc.y };
  const maxWidth = 456;

  for (const c of components) {
    doc.fontSize(12).fillColor("#111111").text(c.title ?? "(untitled component)", 72, y.value);
    y.value = doc.y + 2;
    doc
      .fontSize(7)
      .fillColor("#888888")
      .text(
        `${c.kind} · ${visibilityLabel[c.visibility] ?? c.visibility}${c.branch_ids.length > 0 ? ` · ${c.branch_ids.length} branch(es)` : ""}`,
        72,
        y.value,
      );
    y.value = doc.y + 2;
    renderBody(doc, c.body, y, maxWidth);
    y.value += 10;
    if (y.value > 720) {
      doc.addPage();
      y.value = 64;
    }
  }

  if (items.length > 0) {
    doc.moveDown(0.4);
    doc.fontSize(14).fillColor("#111111").text("Insight items", 72, y.value);
    y.value = doc.y + 4;
    for (const it of items) {
      doc.fontSize(11).fillColor("#111111").text(it.title ?? "(untitled item)", 72, y.value);
      y.value = doc.y + 1;
      doc
        .fontSize(7)
        .fillColor("#888888")
        .text(
          `${visibilityLabel[it.visibility] ?? it.visibility}${it.branch_ids.length > 0 ? ` · ${it.branch_ids.length} branch(es)` : ""}`,
          72,
          y.value,
        );
      y.value = doc.y + 2;
      renderBody(doc, it.body, y, maxWidth);
      y.value += 8;
      if (y.value > 720) {
        doc.addPage();
        y.value = 64;
      }
    }
  }

  if (applications.length > 0) {
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#666666").text(`Linked applications: ${applications.length}`, 72, y.value);
  }

  doc.end();
  await done;
  const pdf = Buffer.concat(chunks);

  const safeName = report.title.replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-").slice(0, 80);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName || "report"}.pdf"`,
    },
  });
}