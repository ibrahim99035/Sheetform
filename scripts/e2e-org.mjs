#!/usr/bin/env node
/**
 * End-to-end smoke test of the organization model (Phase 1):
 * create_owner → submit_org_profile → approve_organization →
 * create_pharmacist → submit_application → (import pipeline) →
 * publish_report, plus RLS assertions:
 *   * a pharmacist scoped to one branch sees org + their-branch report items
 *     but NOT other branches' or restricted items;
 *   * non-superadmins can no longer read datasets / dataset_rows directly;
 *   * application status mirrors the backing dataset's status.
 *
 * Requires the import webhook to be registered (scripts/create-webhook.mjs)
 * for the dataset to reach `ready`.
 *
 * Usage:
 *   node scripts/e2e-org.mjs
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
const fixture = "test/fixtures/sample.csv";
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

// ---- 0. provision auth users + elevate owner ----
console.log("0) provision users");
const { data: ownerUser, error: oErr } = await SERVICE.auth.admin.createUser({
  email: ownerEmail, password: ownerPassword, email_confirm: true,
});
if (oErr) { console.error("create owner failed:", oErr.message); process.exit(1); }
const { data: pharmUser, error: pErr } = await SERVICE.auth.admin.createUser({
  email: pharmEmail, password: pharmPassword, email_confirm: true,
});
if (pErr) { console.error("create pharmacist failed:", pErr.message); process.exit(1); }
const { error: elevErr } = await SERVICE.from("admin_users").insert({ user_id: ownerUser.user.id });
if (elevErr) { console.error("elevation failed:", elevErr.message); process.exit(1); }
ok("owner + pharmacist users created, owner elevated");

const owner = await signIn(ownerEmail, ownerPassword);
const pharm = await signIn(pharmEmail, pharmPassword);

// ---- 1. create_owner ----
console.log("1) create_owner");
const { data: org, error: coErr } = await owner.rpc("create_owner", { p_org_name: `E2E Pharmacy ${stamp}` });
if (coErr || !org) { console.error("create_owner failed:", coErr?.message); process.exit(1); }
ok(`org ${org}`);

// ---- 2. submit_org_profile ----
console.log("2) submit_org_profile");
const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
const { error: spErr } = await owner.rpc("submit_org_profile", {
  p_org_id: org, p_pharmacy_name: "E2E Pharmacy LLC", p_license_no: "LIC-E2E",
  p_license_expiry: expiry, p_address: "1 Test St", p_phone: "+1000000000",
});
if (spErr) { console.error("submit_org_profile failed:", spErr.message); process.exit(1); }
ok("profile submitted");

// ---- 3. reject / approve ----
console.log("3) review");
const { error: rjErr } = await owner.rpc("reject_organization", { p_org_id: org, p_reason: "temporary" });
if (rjErr) { console.error("reject_organization failed:", rjErr.message); process.exit(1); }
const { data: rejStatus } = await owner.from("organizations").select("status").eq("id", org).single();
rejStatus.status === "rejected" ? ok("rejected") : bad("reject_organization", rejStatus.status);
const { error: apErr } = await owner.rpc("approve_organization", { p_org_id: org });
if (apErr) { console.error("approve_organization failed:", apErr.message); process.exit(1); }
const { data: actStatus } = await owner.from("organizations").select("status").eq("id", org).single();
actStatus.status === "active" ? ok("approved → active") : bad("approve_organization", actStatus.status);

// ---- 4. branches + pharmacist ----
console.log("4) branches + pharmacist");
const b1 = (await owner.from("branches").insert({ organization_id: org, name: "Main" }).select("id").single()).data.id;
const b2 = (await owner.from("branches").insert({ organization_id: org, name: "North" }).select("id").single()).data.id;
const { error: cpErr } = await owner.rpc("create_pharmacist", {
  p_org_id: org, p_user_id: pharmUser.user.id, p_branch_ids: [b1],
});
if (cpErr) { console.error("create_pharmacist failed:", cpErr.message); process.exit(1); }
ok(`pharmacist scoped to [Main] (b2=${b2})`);

// ---- 5. pharmacist submits an application for their branch ----
console.log("5) submit_application");
const path = `${pharmUser.user.id}/e2e-org/${stamp}-sample.csv`;
const { error: upErr } = await pharm.storage.from("uploads").upload(path, readFileSync(fixture), {
  contentType: "text/csv", upsert: true,
});
if (upErr) { console.error("upload failed:", upErr.message); process.exit(1); }
const { data: app, error: saErr } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: `March Sales ${stamp}`, p_original_filename: "sample.csv",
  p_storage_path: path, p_column_defs: column_defs, p_branch_id: b1,
});
if (saErr || !app?.length) { console.error("submit_application failed:", saErr?.message); process.exit(1); }
const { application_id, dataset_id } = app[0];
ok(`application ${application_id} → dataset ${dataset_id}`);

// pharmacist cannot submit for an unscoped branch
const { error: badSub } = await pharm.rpc("submit_application", {
  p_org_id: org, p_title: "Bad", p_original_filename: "x.csv", p_storage_path: "x.csv",
  p_column_defs: [], p_branch_id: b2,
});
badSub ? ok("unscoped submission blocked") : bad("unscoped submission should be blocked");

// ---- 6. wait for the import pipeline ----
console.log("6) import");
let final;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data: d } = await SERVICE.from("datasets").select("status, row_count").eq("id", dataset_id).single();
  if (d?.status === "ready" || d?.status === "error") { final = d; break; }
}
if (!final) { bad("import", "timed out"); }
else if (final.status === "ready") ok(`dataset ready (${final.row_count} rows)`);
else bad("import", `status=${final.status}`);

// applications.status mirrors the dataset
const { data: appReady } = await SERVICE.from("applications").select("status").eq("id", application_id).single();
appReady?.status === "ready" ? ok("application mirrored → ready") : bad("application mirror", appReady?.status ?? "none");

// ---- 7. publish_report ----
console.log("7) publish_report");
const { data: reportId, error: prErr } = await owner.rpc("publish_report", {
  p_org_id: org,
  p_title: "Q1 Insights",
  p_summary: "summary",
  p_components: [{ kind: "chart", title: "Sales", body: { x: "amount" } }],
  p_items: [
    { visibility: "org", title: "Org-wide note", body: { t: "all" } },
    { visibility: "branch", branch_ids: [b1], title: "Main insight", body: { t: "main" } },
    { visibility: "branch", branch_ids: [b2], title: "North insight", body: { t: "north" } },
    { visibility: "restricted", title: "Restricted", body: { t: "restricted" } },
  ],
  p_application_ids: [application_id],
});
if (prErr) { console.error("publish_report failed:", prErr.message); process.exit(1); }
ok(`report ${reportId}`);

// ---- 8. RLS: report item visibility ----
console.log("8) report item visibility");
const { data: ownerItems } = await owner.from("report_items").select("title").eq("report_id", reportId);
const { data: pharmItems } = await pharm.from("report_items").select("title").eq("report_id", reportId);
ownerItems?.length === 4 ? ok(`owner sees all ${ownerItems.length} items`) : bad("owner item count", ownerItems?.length ?? 0);
const pTitles = (pharmItems ?? []).map((x) => x.title).sort();
const want = ["Main insight", "Org-wide note"];
JSON.stringify(pTitles) === JSON.stringify(want)
  ? ok(`pharmacist sees only org + Main: ${pTitles.join(", ")}`)
  : bad("pharmacist item gating", pTitles.join(", "));

// ---- 9. RLS: dataset cutover to superadmin-only ----
console.log("9) dataset RLS cutover");
const { count: ownCount } = await pharm.from("datasets").select("id", { count: "exact", head: true });
ownCount === 0 ? ok("pharmacist reads 0 datasets directly") : bad("dataset cutover", `pharmacist sees ${ownCount}`);
const { data: rows } = await pharm.rpc("get_dataset_rows", { p_dataset_id: dataset_id });
rows === null || rows?.length === 0 ? ok("pharmacist cannot fetch dataset rows") : bad("row cutover", "rows leaked");

// ---- 10. revise_report ----
console.log("10) revise_report");
const { error: rvErr } = await owner.rpc("revise_report", {
  p_report_id: reportId, p_title: "Q1 Insights v2", p_components: [{ kind: "text", title: "Note", body: null }],
  p_items: [{ visibility: "org", title: "Updated note", body: null }],
});
rvErr ? bad("revise_report", rvErr.message) : ok("revised");
const { data: rev } = await owner.from("reports").select("revised_at").eq("id", reportId).single();
rev?.revised_at ? ok("revised_at set") : bad("revised_at");

// ---- cleanup ----
// Delete the org first: it cascades org_members / applications / reports /
// datasets, releasing the FK RESTRICTs (organizations.created_by,
// applications.submitted_by) so the auth users can then be removed.
console.log("11) cleanup");
if (org) await SERVICE.from("organizations").delete().eq("id", org);
await SERVICE.auth.admin.deleteUser(ownerUser.user.id).catch(() => {});
await SERVICE.auth.admin.deleteUser(pharmUser.user.id).catch(() => {});

console.log(fail === 0 ? "\nPASS — all org-model checks succeeded." : `\nFAIL — ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);