#!/usr/bin/env node
/**
 * deliver-reports — local/Staging worker mirror.
 *
 * Does in Node exactly what supabase/functions/deliver-reports/index.ts
 * does in Deno (claim queued → render KPI body → send via provider →
 * mark delivered/failed). Kept provider-agnostic and dependency-free
 * (uses global fetch), so it runs locally and in CI:
 *   * email    -> Resend REST API when RESEND_API_KEY is set
 *   * whatsapp -> Meta WhatsApp Cloud API when WHATSAPP_TOKEN/WHATSAPP_PHONE_ID set
 *   * DRY_RUN=1 (default)  -> marks delivered without sending
 *
 * Usage:
 *   DRY_RUN=1 node scripts/deliver-reports.mjs            # dry-run claim+batch
 *   RESEND_API_KEY=... node scripts/deliver-reports.mjs   # real email
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM ?? env.RESEND_FROM ?? "SiroQ <no-reply@siroq.local>";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN ?? env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID ?? env.WHATSAPP_PHONE_ID;
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function renderBody(delivery) {
  const subject = delivery.subject ?? "SiroQ report";
  const { data: report } = await SERVICE
    .from("reports")
    .select("title, summary, branch_id:branches(name)")
    .eq("id", delivery.report_id)
    .single();
  const { data: components } = await SERVICE
    .from("report_components")
    .select("kind, title, body")
    .eq("report_id", delivery.report_id)
    .order("sort_order");
  const kpi = {};
  const series = [];
  let metric = "";
  for (const c of components ?? []) {
    if (c.kind === "insight" && c.body) Object.assign(kpi, c.body);
    if (c.kind === "chart" && c.body?.series) {
      series.push(...c.body.series);
      metric = c.body.metric ?? metric;
    }
  }
  const lines = [report?.title ?? subject];
  if (report?.summary) lines.push(report.summary);
  for (const [k, v] of Object.entries(kpi)) if (v !== null && v !== undefined) lines.push(`${k}: ${v}`);
  if (series.length) lines.push(`${metric}: ${series.map((s) => `${s.bucket}=${s.value}`).join(", ")}`);
  const text = lines.join("\n");
  const html = [
    "<div style=\"font-family:system-ui,sans-serif;max-width:560px\">",
    `<h2>${escapeHtml(report?.title ?? subject)}</h2>`,
    report?.summary ? `<p>${escapeHtml(report.summary)}</p>` : "",
    "<table>",
    ...Object.entries(kpi)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${k}</td><td>${escapeHtml(v)}</td></tr>`),
    "</table>",
    series.length ? `<p><b>${escapeHtml(metric)}</b>: ${series.map((s) => `${escapeHtml(s.bucket)}=${s.value}`).join(", ")}</p>` : "",
    "</div>",
  ].join("");
  return { subject, text, html, body: { kpi, series, metric, branch: report?.branch_id?.name ?? null } };
}

async function sendEmail(to, subject, html) {
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

async function sendWhatsApp(to, text) {
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

async function main() {
  const { data: batch, error } = await SERVICE
    .from("deliveries")
    .select("id, report_id, kind, to_address, subject, body, status, attempt_count")
    .eq("status", "queued")
    .order("created_at")
    .limit(25);
  if (error) { console.error("claim failed:", error.message); process.exit(1); }
  if (!batch?.length) { console.log("no queued deliveries"); return; }

  for (const delivery of batch) {
    const claim = await SERVICE
      .from("deliveries")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", delivery.id)
      .eq("status", "queued");
    if (claim.error || claim.count === 0) continue;

    const attempts = delivery.attempt_count + 1;
    try {
      const rendered = await renderBody(delivery);
      const send = delivery.kind === "email"
        ? await sendEmail(delivery.to_address, rendered.subject, rendered.html)
        : await sendWhatsApp(delivery.to_address, rendered.text);
      await SERVICE.from("deliveries").update({
        status: "delivered",
        body: rendered.body,
        attempt_count: attempts,
        delivered_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      console.log(`ok  delivered ${delivery.kind} #${delivery.id} -> ${delivery.to_address} (${JSON.stringify(send)})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const next = attempts >= 3 ? "failed" : "queued";
      await SERVICE.from("deliveries").update({
        status: next,
        attempt_count: attempts,
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      console.log(`ret ${delivery.id} -> ${next}: ${message}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });