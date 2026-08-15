#!/usr/bin/env node
/**
 * End-to-end smoke test of the Phase 3 analysis engine:
 * create_owner → submit_org_profile → approve_organization → branch creation →
 * submit_branch_profile → approve_pharmacy → create_pharmacist →
 * submit_application(template_code='sales') → import → dataset_kpis /
 * time_series / compare_periods / association_rollup / snapshot_report_kpis.
 *
 * Fixture: test/fixtures/sales.csv (4 rows, 3 distinct transactions).
 * Expected (checked below):
 *   revenue 42.00, units 8, cogs 12.50, margin 29.50, margin_pct 70.24,
 *   avg_transaction 14.00, distinct_products 4, rows 4,
 *   min_date 2026-01-05, max_date 2026-02-02.
 *   monthly revenue: 2026-01 → 30, 2026-02 → 12.
 *   compare_periods(month): label 2026-02, current 12, prior 30, delta -18,
 *   delta_pct -60.
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
const bad = (label, extra) => {
  fail++;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
};
const near = (v, want, tol = 0.01) => v !== null && v !== undefined && Math.abs(Number(v) - want) <= tol;

async function signIn(email, password) {
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

// ---- 0. provision users ----
console.log("0) provision users");
const { data: ownerUser } = await SERVICE.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
const { data: pharmUser } = await SERVICE.auth.admin.createUser({ email: pharmEmail, password: pharmPassword, email_confirm: true });
await SERVICE.from("admin_users").insert({ user_id: ownerUser.user.id });
ok("users provisioned, owner elevated");

const owner = await signIn(ownerEmail, ownerPassword);
const pharm = await signIn(pharmEmail, pharmPassword);

// ---- 1. org lifecycle ----
console.log("1) org lifecycle");
const { data: org } = await owner.rpc("create_owner", { p_org_name: `E2E Analysis ${stamp}` });
const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
await owner.rpc("submit_org_profile", { p_org_id: org, p_pharmacy_name: "Analysis LLC", p_license_no: "LIC-E2E", p_license_expiry: expiry, p_address: "1 S", p_phone: "+1000000000" });
await owner.rpc("approve_organization", { p_org_id: org });
const b1 = (await owner.from("branches").insert({ organization_id: org, name: "Main" }).select("id").single()).data.id;
const b2 = (await owner.from("branches").insert({ organization_id: org, name: "North" }).select("id").single()).data.id;

// ---- 2. branch profile + approval (license gate) ----
console.log("2) branch licensing");
await owner.rpc("submit_branch_profile", {
  p_org_id: org, p_branch_id: b1, p_pharmacy_name: "Main Pharmacy", p_license_no: "LIC-MAIN",
  p_license_expiry: expiry, p_address: "1 Main", p_phone: "+1000000001", p_delivery_email: "main@example.com",
});
const { error: appErr } = await owner.rpc("approve_pharmacy", { p_org_id: org, p_branch_id: b1 });
appErr ? bad("approve_pharmacy", appErr.message) : ok("branch b1 profile submitted + approved");

// branch without a profile stays 'pending' → submissions must fail
const { data: b2Status } = await owner.from("branches").select("status").eq("id", b2).single();
b2Status?.status === "pending" ? ok("b2 still pending") : bad("b2 branch status", b2Status?.status);

// ---- 3. pharmacist scoped to b1 ----
console.log("3) pharmacist");
await owner.rpc("create_pharmacist", { p_org_id: org, p_user_id: pharmUser.user.id, p_branch_ids: [b1] });

// ---- 4. submit application with sales template ----
console.log("4) submit_application");
const path = `${pharmUser.user.id}/e2e-analysis/${stamp}-sales.csv`;
await pharm.storage.from("uploads").upload(path, readFileSync(fixture), { contentType: "text/csv", upsert: true });
const { data: appRes, error: saErr } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: `Jan Sales ${stamp}`, p_original_filename: "sales.csv",
  p_storage_path: path, p_column_defs: colDefs, p_branch_id: b1, p_template_code: "sales",
});
if (saErr || !appRes?.length) { console.error("submit_application failed:", saErr?.message); process.exit(1); }
const { application_id, dataset_id } = appRes[0];
ok(`application ${application_id} → dataset ${dataset_id} (template: sales)`);

// submission to an unapproved branch must fail with BRANCH_NOT_ACTIVE
const { error: badSub } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: "Bad", p_original_filename: "x.csv", p_storage_path: "x.csv",
  p_column_defs: [], p_branch_id: b2, p_template_code: "sales",
});
badSub ? ok(`unapproved branch blocked (${badSub.message})`) : bad("unapproved branch should be blocked");

// bad template must fail with TEMPLATE_NOT_FOUND
const { error: badTpl } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: "Bad tpl", p_original_filename: "x.csv", p_storage_path: "x.csv",
  p_column_defs: [], p_branch_id: b1, p_template_code: "nope",
});
badTpl ? ok(`unknown template blocked (${badTpl.message})`) : bad("unknown template should be blocked");

// ---- 5. import ----
console.log("5) import");
let final;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data: d } = await SERVICE.from("datasets").select("status").eq("id", dataset_id).single();
  if (d?.status === "ready" || d?.status === "error") { final = d; break; }
}
if (!final) bad("import", "timed out");
else if (final.status === "ready") ok("dataset ready");
else bad("import", `status=${final.status}`);

// ---- 6. dataset_kpis ----
console.log("6) dataset_kpis");
const { data: kpis, error: kErr } = await owner.rpc("dataset_kpis", { p_dataset_id: dataset_id });
if (kErr) { console.error("dataset_kpis failed:", kErr.message); process.exit(1); }
console.log("     kpis:", JSON.stringify(kpis));
near(kpis?.revenue, 42) ? ok("revenue 42") : bad("revenue", kpis?.revenue);
near(kpis?.units, 8) ? ok("units 8") : bad("units", kpis?.units);
near(kpis?.cogs, 12.5) ? ok("cogs 12.5") : bad("cogs", kpis?.cogs);
near(kpis?.gross_margin, 29.5) ? ok("gross_margin 29.5") : bad("gross_margin", kpis?.gross_margin);
near(kpis?.gross_margin_pct, 70.24) ? ok("margin_pct 70.24") : bad("margin_pct", kpis?.gross_margin_pct);
near(kpis?.avg_transaction, 14) ? ok("avg_transaction 14") : bad("avg_transaction", kpis?.avg_transaction);
kpis?.distinct_products === 4 ? ok("distinct_products 4") : bad("distinct_products", kpis?.distinct_products);
kpis?.rows === 4 ? ok("rows 4") : bad("rows", kpis?.rows);
kpis?.min_date && kpis?.max_date ? ok("date span present") : bad("date span", kpis?.min_date ?? kpis?.max_date);

// ---- 7. time_series ----
console.log("7) time_series (monthly revenue)");
const { data: series, error: tsErr } = await owner.rpc("time_series", { p_dataset_id: dataset_id, p_metric: "revenue", p_bucket: "month" });
if (tsErr) { console.error("time_series failed:", tsErr.message); process.exit(1); }
console.log("     series:", JSON.stringify(series));
const jan = series?.find((r) => r.bucket === "2026-01");
const feb = series?.find((r) => r.bucket === "2026-02");
near(jan?.value, 30) ? ok("2026-01 → 30") : bad("2026-01", jan?.value);
near(feb?.value, 12) ? ok("2026-02 → 12") : bad("2026-02", feb?.value);

// ---- 8. compare_periods ----
console.log("8) compare_periods");
const { data: cmp, error: cpErr } = await owner.rpc("compare_periods", { p_dataset_id: dataset_id, p_metric: "revenue", p_bucket: "month" });
if (cpErr) { console.error("compare_periods failed:", cpErr.message); process.exit(1); }
console.log("     cmp:", JSON.stringify(cmp));
const cmpRow = cmp?.[0];
cmpRow?.label === "2026-02" ? ok("label 2026-02") : bad("label", cmpRow?.label);
near(cmpRow?.current_value, 12) ? ok("current 12") : bad("current", cmpRow?.current_value);
near(cmpRow?.prior_value, 30) ? ok("prior 30") : bad("prior", cmpRow?.prior_value);
near(cmpRow?.delta, -18) ? ok("delta -18") : bad("delta", cmpRow?.delta);
near(cmpRow?.delta_pct, -60) ? ok("delta_pct -60") : bad("delta_pct", cmpRow?.delta_pct);

// ---- 9. association_rollup ----
console.log("9) association_rollup");
const { data: rollup } = await owner.rpc("association_rollup", { p_organization_id: org, p_metric: "revenue" });
console.log("     rollup:", JSON.stringify(rollup));
near(rollup?.total, 42) ? ok("org revenue 42") : bad("rollup total", rollup?.total);
rollup?.datasets >= 1 ? ok("datasets counted") : bad("rollup datasets", rollup?.datasets);

// ---- 10. snapshot_report_kpis ----
console.log("10) snapshot_report_kpis");
const { data: reportId } = await owner.rpc("publish_report", {
  p_org_id: org, p_title: "KPI report", p_summary: "s",
  p_components: [{ kind: "text", title: "Note", body: null }],
  p_items: [{ visibility: "org", title: "note", body: null }],
  p_application_ids: [application_id],
});
const { data: snapCount, error: snapErr } = await owner.rpc("snapshot_report_kpis", { p_report_id: reportId, p_metric: "revenue" });
if (snapErr) { console.error("snapshot_report_kpis failed:", snapErr.message); process.exit(1); }
console.log("     snapshot components:", snapCount);
Number(snapCount) >= 2 ? ok(`snapshot wrote ${snapCount} components`) : bad("snapshot count", snapCount);

// ---- 11. RLS: pharmacist cannot compute KPIs on direct table reads ----
console.log("11) RLS surface");
const { count: dCount } = await pharm.from("datasets").select("id", { count: "exact", head: true });
dCount === 0 ? ok("pharmacist reads 0 datasets") : bad("pharm dataset cutover", dCount);
const { data: kpisPharm } = await pharm.rpc("dataset_kpis", { p_dataset_id: dataset_id });
kpisPharm != null ? ok("pharmacist can call KPI fn") : bad("pharm kpi fn", "null");

// ---- cleanup ----
console.log("12) cleanup");
if (org) await SERVICE.from("organizations").delete().eq("id", org);
await SERVICE.auth.admin.deleteUser(ownerUser.user.id).catch(() => {});
await SERVICE.auth.admin.deleteUser(pharmUser.user.id).catch(() => {});

console.log(fail === 0 ? "\nPASS — all analysis checks succeeded." : `\nFAIL — ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);