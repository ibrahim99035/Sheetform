#!/usr/bin/env node
/**
 * End-to-end smoke test of the Phase 4 delivery queue:
 * org lifecycle + branch licensing + sales submit + import +
 * publish_report + snapshot_report_kpis +
 * queue_report_deliveries → deliver-reports worker (dry-run) →
 * deliveries delivered; RLS (pharmacist cannot write deliveries);
 * retry_deliveries idempotence on a skipped row.
 *
 * Run the delivery worker mirror in dry-run mode (default).
 * Usage: node scripts/e2e-deliveries.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now().toString(36);
const ownerEmail = `owner-${stamp}@siroq-e2e.test`;
const pharmEmail = `pharm-${stamp}@siroq-e2e.test`;
const ownerPassword = `Pw${randomBytes(9).toString("base64url")}!`;
const pharmPassword = `Pw${randomBytes(9).toString("base64url")}!`;
const fixture = "test/fixtures/sales.csv";
const colDefs = [
  { key: "date", label: "Date", type: "date" },
  { key: "transaction_id", label: "Transaction ID", type: "string" },
  { key: "product", label: "Product", type: "string" },
  { key: "category", label: "Category", type: "string" },
  { key: "qty", label: "Quantity", type: "numeric" },
  { key: "unit_price", label: "Unit price", type: "numeric" },
  { key: "cost", label: "Unit cost", type: "numeric" },
  { key: "refund", label: "Refund", type: "numeric" },
];

let fail = 0;
const ok = (label) => console.log(`  ok  ${label}`);
const bad = (label, extra) => { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); };

async function signIn(email, password) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

console.log("0) provision users");
const { data: ownerUser } = await SERVICE.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
const { data: pharmUser } = await SERVICE.auth.admin.createUser({ email: pharmEmail, password: pharmPassword, email_confirm: true });
await SERVICE.from("admin_users").insert({ user_id: ownerUser.user.id });

const owner = await signIn(ownerEmail, ownerPassword);
const pharm = await signIn(pharmEmail, pharmPassword);

console.log("1) org + branch + license");
const { data: org } = await owner.rpc("create_owner", { p_org_name: `E2E Delivery ${stamp}` });
const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
await owner.rpc("submit_org_profile", { p_org_id: org, p_pharmacy_name: "Delivery LLC", p_license_no: "LIC-E2E", p_license_expiry: expiry, p_address: "1 S", p_phone: "+1000000000" });
await owner.rpc("approve_organization", { p_org_id: org });
const b1 = (await owner.from("branches").insert({ organization_id: org, name: "Main" }).select("id").single()).data.id;
await owner.rpc("submit_branch_profile", {
  p_org_id: org, p_branch_id: b1, p_pharmacy_name: "Main Pharmacy", p_license_no: "LIC-MAIN",
  p_license_expiry: expiry, p_address: "1 Main", p_phone: "+1000000001",
  p_delivery_email: "main@example.com", p_whatsapp: "+10000000001",
});
await owner.rpc("approve_pharmacy", { p_org_id: org, p_branch_id: b1 });
ok("org active, branch b1 licensed");

console.log("2) submissions");
await owner.rpc("create_pharmacist", { p_org_id: org, p_user_id: pharmUser.user.id, p_branch_ids: [b1] });
const path = `${pharmUser.user.id}/e2e-delivery/${stamp}-sales.csv`;
await pharm.storage.from("uploads").upload(path, readFileSync(fixture), { contentType: "text/csv", upsert: true });
const { data: appRes } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: `Deliv Sales ${stamp}`, p_original_filename: "sales.csv",
  p_storage_path: path, p_column_defs: colDefs, p_branch_id: b1, p_template_code: "sales",
});
const { application_id, dataset_id } = appRes[0];
let final;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data: d } = await SERVICE.from("datasets").select("status").eq("id", dataset_id).single();
  if (d?.status === "ready" || d?.status === "error") { final = d; break; }
}
final?.status === "ready" ? ok("dataset ready") : bad("import", final?.status);

console.log("3) publish + snapshot");
const { data: reportId } = await owner.rpc("publish_report", {
  p_org_id: org, p_title: "Delivery report", p_summary: "s",
  p_components: [{ kind: "text", title: "Note", body: null }],
  p_items: [{ visibility: "org", title: "note", body: null }],
  p_application_ids: [application_id],
});
const { data: snapCount } = await owner.rpc("snapshot_report_kpis", { p_report_id: reportId, p_metric: "revenue" });
Number(snapCount) >= 2 ? ok("KPI snapshot written") : bad("snapshot", snapCount);

console.log("4) queue_report_deliveries");
await SERVICE.from("branch_profiles").update({ email_delivery: true, whatsapp_delivery: false }).eq("branch_id", b1);

const { data: queued, error: qErr } = await owner.rpc("queue_report_deliveries", { p_report_id: reportId, p_kind: "email" });
if (qErr) { console.error("queue failed:", qErr.message); process.exit(1); }
Number(queued) === 1 ? ok(`queued ${queued} email delivery`) : bad("queue count", queued);

const { data: qRows } = await SERVICE.from("deliveries").select("id, kind, to_address, status").eq("report_id", reportId);
qRows?.length === 1 && qRows[0].status === "queued" && qRows[0].to_address === "main@example.com"
  ? ok("delivery row queued with address + status queued")
  : bad("row state", JSON.stringify(qRows));

console.log("5) worker (dry-run)");
const { fileURLToPath } = await import("node:url");
const workerPath = fileURLToPath(new URL("./deliver-reports.mjs", import.meta.url));
const { execFileSync } = await import("node:child_process");
const runWorker = (dry) =>
  execFileSync(process.execPath, [workerPath], { stdio: "pipe", env: { ...process.env, DRY_RUN: dry } });
runWorker("1");
const { data: afterWork } = await SERVICE.from("deliveries").select("id, status, body, delivered_at").eq("report_id", reportId);
afterWork?.[0]?.status === "delivered" ? ok("delivery delivered by worker") : bad("worker result", JSON.stringify(afterWork));
const kpiBody = afterWork?.[0]?.body?.kpi;
kpiBody?.revenue === 42 ? ok("rendered KPI revenue 42") : bad("rendered body kpi", JSON.stringify(kpiBody));
afterWork?.[0]?.delivered_at ? ok("delivered_at stamped") : bad("delivered_at");

console.log("6) no-provider path (queued → failed after 3 attempts)");
await SERVICE.from("deliveries").update({ status: "queued", attempt_count: 0, last_error: null }).eq("report_id", reportId);
for (let attempt = 1; attempt <= 3; attempt++) runWorker("0");
const { data: noProv } = await SERVICE.from("deliveries").select("status, last_error, attempt_count").eq("report_id", reportId);
noProv?.[0]?.status === "failed" ? ok(`delivery failed after 3 attempts (attempt_count=${noProv[0].attempt_count})`) : bad("no-provider path", JSON.stringify(noProv));
/NO_EMAIL_PROVIDER/.test(noProv?.[0]?.last_error ?? "") ? ok("last_error records missing provider") : bad("last_error", JSON.stringify(noProv?.[0]?.last_error));

console.log("6b) retry_deliveries re-queues failed");
const { data: requeued } = await owner.rpc("retry_deliveries", { p_report_id: reportId });
Number(requeued) >= 1 ? ok(`retry re-queued ${requeued}`) : bad("retry count", requeued);
const { data: afterRetry } = await SERVICE.from("deliveries").select("status").eq("report_id", reportId);
afterRetry?.[0]?.status === "queued" ? ok("status back to queued") : bad("retry status", afterRetry?.[0]?.status);

console.log("6c) deliver again (dry-run) to leave clean state");
runWorker("1");

console.log("7) RLS: pharmacist cannot write deliveries");
const { error: pharmWrite } = await pharm.from("deliveries").insert({ report_id: reportId, organization_id: org, branch_id: b1, kind: "email", to_address: "x" });
pharmWrite ? ok("pharmacist insert blocked") : bad("pharmacist should not insert deliveries");
const { data: pharmRead } = await pharm.from("deliveries").select("id").eq("report_id", reportId);
pharmRead?.length === 1 ? ok("pharmacist can read own org deliveries") : bad("pharm read", pharmRead?.length);

console.log("8) RLS: queue_reports as pharmacist fails");
const { error: pharmQueue } = await pharm.rpc("queue_report_deliveries", { p_report_id: reportId, p_kind: "email" });
pharmQueue ? ok("pharmacist queue blocked") : bad("pharmacist should not queue");

console.log("9) cleanup");
if (org) await SERVICE.from("organizations").delete().eq("id", org);
await SERVICE.auth.admin.deleteUser(ownerUser.user.id).catch(() => {});
await SERVICE.auth.admin.deleteUser(pharmUser.user.id).catch(() => {});

console.log(fail === 0 ? "\nPASS — all delivery checks succeeded." : `\nFAIL — ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);