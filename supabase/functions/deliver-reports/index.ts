// deliver-reports — Supabase Edge Function
//
// Pulls queued `deliveries` rows, renders the report's KPI snapshot into
// a message body, and sends it through a provider:
//   * email    -> Resend REST API (RESEND_API_KEY / RESEND_FROM)
//   * whatsapp -> Meta WhatsApp Cloud API (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)
// Statuses: queued -> processing -> delivered | failed | skipped.
//
// Invoked by DB webhook or directly with `{ "deliveries": [...] }` id list.
// No provider configured + DRY_RUN=1 marks rows delivered without sending
// (used by staging e2e); otherwise they end up `skipped` with last_error.
//
// Deploy (ops, requires supabase CLI login):
//   export SUPABASE_PROJECT_REF=...
//   npx supabase secrets set RESEND_API_KEY=... RESEND_FROM=SiroQ <noreply@...>
//   npx supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=...
//   npx supabase functions deploy deliver-reports

import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "SiroQ <no-reply@siroq.local>";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID");
const DRY_RUN = Deno.env.get("DRY_RUN") === "1" || Deno.env.get("DRY_RUN") === "true";
const BATCH = Number(Deno.env.get("BATCH") ?? "25");
const APP_CURRENCY = Deno.env.get("APP_CURRENCY") ?? "EGP";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function renderBody(delivery: {
  report_id: string;
  kind: string;
  subject: string | null;
  body: Record<string, unknown>;
}): Promise<{ subject: string; text: string; html: string; body: Record<string, unknown> }> {
  const subject = delivery.subject ?? "SiroQ report";

  const { data: report } = await supabase
    .from("reports")
    .select("title, summary, organization_id, branch_id:branches(name)")
    .eq("id", delivery.report_id)
    .single();

  const { data: components } = await supabase
    .from("report_components")
    .select("kind, title, body")
    .eq("report_id", delivery.report_id)
    .order("sort_order");

  const kpi: Record<string, unknown> = {};
  const series: Array<{ bucket: string; value: number }> = [];
  let metric = "";
  const textBlocks: string[] = [];
  for (const c of components ?? []) {
    if (c.kind === "insight" && c.body) Object.assign(kpi, c.body);
    if (c.kind === "chart" && c.body?.series) {
      series.push(...c.body.series);
      metric = c.body.metric ?? metric;
    }
    if (c.kind === "text" && c.body) {
      const t = richToText(c.body.text);
      if (t) textBlocks.push(t);
    }
  }

  const lines: string[] = [];
  lines.push(report?.title ?? delivery.subject ?? "SiroQ report");
  if (report?.summary) lines.push(report.summary);
  if (kpi.revenue !== undefined) lines.push(`Revenue: ${kpi.revenue}`);
  if (kpi.units !== undefined) lines.push(`Units: ${kpi.units}`);
  if (kpi.gross_margin_pct !== undefined) lines.push(`Gross margin: ${kpi.gross_margin_pct}%`);
  if (kpi.gross_margin !== undefined) lines.push(`Gross margin (${APP_CURRENCY}): ${kpi.gross_margin}`);
  if (series.length) {
    lines.push(`${metric}: ${series.map((s) => `${s.bucket}=${s.value}`).join(", ")}`);
  }
  if (textBlocks.length) lines.push("", ...textBlocks);
  const text = lines.join("\n");
  const html = [
    "<div style=\"font-family:system-ui,sans-serif;max-width:560px\">",
    `<h2>${escapeHtml(report?.title ?? subject)}</h2>`,
    report?.summary ? `<p>${escapeHtml(report.summary)}</p>` : "",
    "<table style=\"border-collapse:collapse\">",
    ...Object.entries(kpi).map(
      ([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${k}</td><td>${escapeHtml(String(v))}</td></tr>`,
    ),
    "</table>",
    series.length
      ? `<p><b>${escapeHtml(metric)}</b>: ${series.map((s) => `${escapeHtml(s.bucket)}=${s.value}`).join(", ")}</p>`
      : "",
    ...textBlocks.map((t) => `<p style="white-space:pre-wrap">${escapeHtml(t)}</p>`),
    "</div>",
  ].join("");
  return { subject, text, html, body: { kpi, series, metric, branch: report?.branch_id?.name ?? null } };
}

/** Minimal TipTap-JSON -> plain-text extractor (kept in-file for the Deno runtime). */
function richToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const doc = value as { type?: string; text?: string; content?: unknown[] };
  if (typeof doc.text === "string") return doc.text;
  if (!Array.isArray(doc.content)) return "";
  const parts: string[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const n = node as { type?: string; content?: unknown[]; text?: string };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) parts.push(richToText(n));
    if (n.type === "paragraph" || n.type === "heading") parts.push("\n");
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function sendEmail(to: string, subject: string, html: string) {
  if (DRY_RUN) return { dryRun: true };
  if (!RESEND_API_KEY) throw new Error("NO_EMAIL_PROVIDER (set RESEND_API_KEY)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`RESEND_HTTP_${res.status}: ${await res.text()}`);
  return { provider: "resend" };
}

async function sendWhatsApp(to: string, text: string) {
  if (DRY_RUN) return { dryRun: true };
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) throw new Error("NO_WHATSAPP_PROVIDER (set WHATSAPP_TOKEN/WHATSAPP_PHONE_ID)");
  const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) throw new Error(`WHATSAPP_HTTP_${res.status}: ${await res.text()}`);
  return { provider: "whatsapp" };
}

async function processDelivery(id: number): Promise<void> {
  const { data: delivery } = await supabase
    .from("deliveries")
    .select("id, report_id, kind, to_address, subject, body, status, attempt_count")
    .eq("id", id)
    .single();
  if (!delivery) return;
  if (delivery.status !== "queued") return;

  const claim = await supabase
    .from("deliveries")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued");
  if (claim.error || claim.count === 0) return;

  const attempts = delivery.attempt_count + 1;
  try {
    const rendered = await renderBody(delivery);
    const send = delivery.kind === "email"
      ? await sendEmail(delivery.to_address, rendered.subject, rendered.html)
      : await sendWhatsApp(delivery.to_address, rendered.text);
    await supabase.from("deliveries").update({
      status: "delivered",
      body: rendered.body,
      attempt_count: attempts,
      delivered_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    console.log(`delivered ${delivery.kind} ${id} -> ${delivery.to_address}`, send);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = attempts >= 3 ? "failed" : "queued";
    await supabase.from("deliveries").update({
      status: next,
      attempt_count: attempts,
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    console.log(`delivery ${id} ${next}: ${message}`);
  }
}

Deno.serve(async (req: Request) => {
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get("x-supabase-webhook-secret");
    if (secret !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
  }

  const body = await req.json().catch(() => ({}));
  let ids: number[] = body?.deliveries ?? [];
  if (!ids.length) {
    const { data } = await supabase
      .from("deliveries")
      .select("id")
      .eq("status", "queued")
      .order("created_at")
      .limit(BATCH);
    ids = (data ?? []).map((d) => d.id);
  }
  for (const id of ids) {
    await processDelivery(Number(id));
  }
  return new Response(JSON.stringify({ processed: ids.length }), { status: 200, headers: { "Content-Type": "application/json" } });
});