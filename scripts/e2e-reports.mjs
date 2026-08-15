#!/usr/bin/env node
/**
 * End-to-end test of the operator Reports workflow (Phase "reports UI"):
 * create_owner → profile → approve → branches → pharmacist →
 * submit_application → (import) → publish_report → RLS read side →
 * snapshot_report_kpis → queue_report_deliveries → retry_deliveries →
 * revise_report, plus FORBIDDEN asserts for a non-superadmin on every
 * operator RPC.
 *
 * Requires the import webhook (scripts/create-webhook.mjs) for the
 * application's dataset to reach `ready` so the KPI snapshot can compute.
 *
 * Usage:
 *   node scripts/e2e-reports.mjs
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
const ownerEmail = `rpt-owner-${stamp}@siroq-e2e.test`;
const pharmEmail = `rpt-pharm-${stamp}@siroq-e2e.test`;
const ownerPassword = `Pw${randomBytes(9).toString("base64url")}!`;
const pharmPassword = `Pw${randomBytes(9).toString("base64url")}!`;
const fixture = "test/fixtures/sample.csv";
const salesTemplate = "sales";
const column_defs = [
  { key: "name", label: "Name", type: "string" },
  { key: "amount", label: "Amount", type: "numeric" },
  { key: "category", label: "Category", type: "string" },
  { key: "created", label: "Created", type: "date" },
  { key: "active", label: "Active", type: "boolean" },
];

let fail = 0;
const ok = (label) => console.log(`  ok  ${label}`);
const bad = (label, extra) => {
  fail++;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
};

async function signIn(email, password) {
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

// ---- 0. provision auth users + elevate operator ----
console.log("0) provision users");
const { data: ownerUser, error: oErr } = await SERVICE.auth.admin.createUser({
  email: ownerEmail, password: ownerPassword, email_confirm: true,
});
if (oErr) { console.error("create operator failed:", oErr.message); process.exit(1); }
const { data: pharmUser, error: pErr } = await SERVICE.auth.admin.createUser({
  email: pharmEmail, password: pharmPassword, email_confirm: true,
});
if (pErr) { console.error("create pharmacist failed:", pErr.message); process.exit(1); }
const { error: elevErr } = await SERVICE.from("admin_users").insert({ user_id: ownerUser.user.id });
if (elevErr) { console.error("elevation failed:", elevErr.message); process.exit(1); }
ok("operator + pharmacist users created, operator elevated");

const owner = await signIn(ownerEmail, ownerPassword);
const pharm = await signIn(pharmEmail, pharmPassword);

// ---- 1. org + profile + approve ----
console.log("1) org + approval");
const { data: org, error: coErr } = await owner.rpc("create_owner", { p_org_name: `Rpt Org ${stamp}` });
if (coErr || !org) { console.error("create_owner failed:", coErr?.message); process.exit(1); }
const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
const { error: spErr } = await owner.rpc("submit_org_profile", {
  p_org_id: org, p_pharmacy_name: "Rpt Pharmacy LLC", p_license_no: "LIC-RPT",
  p_license_expiry: expiry, p_address: "1 Test St", p_phone: "+1000000000",
});
if (spErr) { console.error("submit_org_profile failed:", spErr.message); process.exit(1); }
const { error: apErr } = await owner.rpc("approve_organization", { p_org_id: org });
if (apErr) { console.error("approve_organization failed:", apErr.message); process.exit(1); }
ok(`org ${org} active`);

// ---- 2. branches + pharmacist + enabled delivery profile ----
console.log("2) branches + pharmacist");
const b1 = (await owner.from("branches").insert({ organization_id: org, name: "Main" }).select("id").single()).data.id;
const b2 = (await owner.from("branches").insert({ organization_id: org, name: "North" }).select("id").single()).data.id;
const { error: cpErr } = await owner.rpc("create_pharmacist", {
  p_org_id: org, p_user_id: pharmUser.user.id, p_branch_ids: [b1],
});
if (cpErr) { console.error("create_pharmacist failed:", cpErr.message); process.exit(1); }
const { error: sbpErr } = await owner.rpc("submit_branch_profile", {
  p_org_id: org, p_branch_id: b1, p_pharmacy_name: "Main Pharmacy", p_license_no: "LIC-B1",
  p_license_expiry: expiry, p_address: "1 Main", p_phone: "+1000000001",
  p_delivery_email: `main-${stamp}@siroq-e2e.test`,
});
if (sbpErr) { console.error("submit_branch_profile failed:", sbpErr.message); process.exit(1); }
const { error: appPharmErr } = await owner.rpc("approve_pharmacy", { p_org_id: org, p_branch_id: b1 });
if (appPharmErr) { console.error("approve_pharmacy failed:", appPharmErr.message); process.exit(1); }
await SERVICE
  .from("branch_profiles")
  .update({ email_delivery: true, whatsapp_delivery: false })
  .eq("branch_id", b1);
ok(`pharmacist scoped to [Main], main@… delivery email enabled`);

// ---- 3. application + import ----
console.log("3) submit_application + import");
const path = `${pharmUser.user.id}/e2e-report/${stamp}-sample.csv`;
const { error: upErr } = await pharm.storage.from("uploads").upload(path, readFileSync(fixture), {
  contentType: "text/csv", upsert: true,
});
if (upErr) { console.error("upload failed:", upErr.message); process.exit(1); }
const { data: app, error: saErr } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: `March Sales ${stamp}`, p_original_filename: "sample.csv",
  p_storage_path: path, p_column_defs: column_defs, p_template_code: salesTemplate, p_branch_id: b1,
});
if (saErr || !app?.length) { console.error("submit_application failed:", saErr?.message); process.exit(1); }
const { application_id, dataset_id } = app[0];
let final;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data: d } = await SERVICE.from("datasets").select("status, row_count").eq("id", dataset_id).single();
  if (d?.status === "ready" || d?.status === "error") { final = d; break; }
}
if (!final) bad("import", "timed out");
else if (final.status === "ready") ok(`dataset ready (${final.row_count} rows)`);
else bad("import", `status=${final.status}`);
if (final?.status !== "ready") {
  console.log("  skip snapshot/delivery sections — dataset not ready");
} else {
  // ---- 4. publish_report ----
  console.log("4) publish_report");
  const { data: reportId, error: prErr } = await owner.rpc("publish_report", {
    p_org_id: org,
    p_title: "March Insights",
    p_summary: "Monthly overview for the association.",
    p_components: [
      { kind: "chart", title: "Revenue trend", body: { x: "amount" } },
      { kind: "text", title: "Overview", body: { text: "Solid month." } },
    ],
    p_items: [
      { visibility: "org", title: "Org-wide note", body: { text: "all" } },
      { visibility: "branch", branch_ids: [b1], title: "Main insight", body: { text: "main" } },
      { visibility: "branch", branch_ids: [b2], title: "North insight", body: { text: "north" } },
      { visibility: "restricted", title: "Restricted", body: { text: "ops only" } },
    ],
    p_application_ids: [application_id],
  });
  if (prErr) { console.error("publish_report failed:", prErr.message); process.exit(1); }
  ok(`report ${reportId}`);

  // operator cannot link an application from another org
  const { error: badApp } = await owner.rpc("publish_report", {
    p_org_id: org, p_title: "Bad link", p_components: [{ kind: "text", title: "x", body: null }],
    p_application_ids: [randomBytes(16).toString("hex")],
  });
  badApp ? ok("foreign application link blocked") : bad("foreign app link should be blocked");

  // ---- 5. RLS read side (pharmacist) ----
  console.log("5) RLS read side");
  const { data: pharmItems } = await pharm.from("report_items").select("title").eq("report_id", reportId);
  const want = ["Main insight", "Org-wide note"];
  const got = (pharmItems ?? []).map((x) => x.title).sort();
  JSON.stringify(got) === JSON.stringify(want)
    ? ok(`pharmacist sees org + own-branch items: ${got.join(", ")}`)
    : bad("pharmacist item gating", got.join(", "));
  const { data: pharmComp } = await pharm.from("report_components").select("id").eq("report_id", reportId);
  (pharmComp?.length ?? 0) === 2 ? ok("pharmacist reads both components") : bad("pharm components", pharmComp?.length ?? 0);
  const { data: pharmRep } = await pharm.from("reports").select("title").eq("id", reportId);
  (pharmRep?.length ?? 0) === 1 ? ok("pharmacist reads the published report") : bad("pharm report read", pharmRep?.length ?? 0);

  // ---- 6. snapshot_report_kpis ----
  console.log("6) snapshot_report_kpis");
  const { data: snapCount, error: snapErr } = await owner.rpc("snapshot_report_kpis", {
    p_report_id: reportId, p_metric: "revenue",
  });
  if (snapErr) { console.error("snapshot_report_kpis failed:", snapErr.message); process.exit(1); }
  Number(snapCount) >= 2 ? ok(`snapshot wrote ${snapCount} KPI components`) : bad("snapshot count", snapCount);
  const { error: snapForb } = await pharm.rpc("snapshot_report_kpis", { p_report_id: reportId, p_metric: "revenue" });
  snapForb ? ok("pharmacist snapshot blocked") : bad("pharm snapshot should be blocked");

  // ---- 7. queue + retry deliveries ----
  console.log("7) queue_report_deliveries");
  const { data: qCount, error: qErr } = await owner.rpc("queue_report_deliveries", {
    p_report_id: reportId, p_kind: "email",
  });
  if (qErr) { console.error("queue_report_deliveries failed:", qErr.message); process.exit(1); }
  Number(qCount) >= 1 ? ok(`queued ${qCount} email delivery(ies)`) : bad("queue count", qCount);
  const { data: qRows } = await SERVICE.from("deliveries").select("kind, status, to_address").eq("report_id", reportId);
  (qRows?.length ?? 0) >= 1 ? ok("delivery rows exist") : bad("delivery rows", qRows?.length ?? 0);
  const { error: qForb } = await pharm.rpc("queue_report_deliveries", { p_report_id: reportId, p_kind: "email" });
  qForb ? ok("pharmacist queue blocked") : bad("pharm queue should be blocked");
  const { data: rCount, error: rErr } = await owner.rpc("retry_deliveries", { p_report_id: reportId });
  rErr ? bad("retry_deliveries", rErr.message) : ok(`retry scanned past rows (${Number(rCount)} requeued)`);
  const { error: rForb } = await pharm.rpc("retry_deliveries", { p_report_id: reportId });
  rForb ? ok("pharmacist retry blocked") : bad("pharm retry should be blocked");

  // ---- 8. revise_report ----
  console.log("8) revise_report");
  const { data: revId, error: rvErr } = await owner.rpc("revise_report", {
    p_report_id: reportId, p_title: "March Insights v2",
    p_components: [{ kind: "text", title: "Note", body: { text: "updated" } }],
    p_items: [{ visibility: "org", title: "Updated note", body: { text: "updated" } }],
  });
  if (rvErr) { console.error("revise_report failed:", rvErr.message); process.exit(1); }
  revId === reportId ? ok("revise_report in place") : bad("revise id", revId);
  const { data: rev } = await owner.from("reports").select("title, revised_at").eq("id", reportId).single();
  rev?.title === "March Insights v2" && rev?.revised_at ? ok("revised_at set") : bad("revise state", JSON.stringify(rev));
  const { error: rvForb } = await pharm.rpc("revise_report", {
    p_report_id: reportId, p_title: "nope", p_components: [{ kind: "text", title: "x", body: null }],
    p_items: [],
  });
  rvForb ? ok("pharmacist revise blocked") : bad("pharm revise should be blocked");
}

// ---- 9. operator-only gates on publish/queue shape ----
console.log("9) non-superadmin FORBIDDEN on operator RPCs");
const { error: pubForb } = await pharm.rpc("publish_report", {
  p_org_id: org, p_title: "x", p_components: [{ kind: "text", title: "x", body: null }], p_items: [],
});
pubForb ? ok("pharmacist publish blocked") : bad("pharm publish should be blocked");

// ---- cleanup ----
console.log("10) cleanup");
if (org) await SERVICE.from("organizations").delete().eq("id", org);
await SERVICE.auth.admin.deleteUser(ownerUser.user.id).catch(() => {});
await SERVICE.auth.admin.deleteUser(pharmUser.user.id).catch(() => {});

console.log(fail === 0 ? "\nPASS — all report-workflow checks succeeded." : `\nFAIL — ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);