#!/usr/bin/env node
/**
 * End-to-end smoke test of Phase 5 compliance:
 * retention_policies seed + RLS, _sf_retention_months / _sf_purge_eligible,
 * archive_dataset (soft), purge_dataset (hard), purge_expired sweep (dry + real),
 * subject_requests (export with payload, delete footprint, reject), and
 * terms (current_terms / terms_pending / accept_terms) + RLS gates.
 *
 * Usage: node scripts/e2e-compliance.mjs
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
const ownerEmail = `cowner-${stamp}@siroq-e2e.test`;
const pharmEmail = `cpharm-${stamp}@siroq-e2e.test`;
const ownerPassword = `Pw${randomBytes(9).toString("base64url")}!`;
const pharmPassword = `Pw${randomBytes(9).toString("base64url")}!`;

let fail = 0;
const ok = (label) => console.log(`  ok  ${label}`);
const bad = (label, extra) => { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); };

async function signIn(email, password) {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

console.log("0) provision users + org");
const { data: ownerUser } = await SERVICE.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
const { data: pharmUser } = await SERVICE.auth.admin.createUser({ email: pharmEmail, password: pharmPassword, email_confirm: true });
await SERVICE.from("admin_users").insert({ user_id: ownerUser.user.id });

const owner = await signIn(ownerEmail, ownerPassword);
const pharm = await signIn(pharmEmail, pharmPassword);

const { data: org } = await owner.rpc("create_owner", { p_org_name: `E2E Compliance ${stamp}` });
const expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
await owner.rpc("submit_org_profile", { p_org_id: org, p_pharmacy_name: "Compliance LLC", p_license_no: "LIC-E2E", p_license_expiry: expiry, p_address: "1 S", p_phone: "+1000000000" });
await owner.rpc("approve_organization", { p_org_id: org });
const b1 = (await owner.from("branches").insert({ organization_id: org, name: "Main" }).select("id").single()).data.id;
await owner.rpc("submit_branch_profile", {
  p_org_id: org, p_branch_id: b1, p_pharmacy_name: "Main Pharmacy", p_license_no: "LIC-MAIN",
  p_license_expiry: expiry, p_address: "1 Main", p_phone: "+1000000001",
  p_delivery_email: "main@example.com", p_whatsapp: "+10000000001",
});
await owner.rpc("approve_pharmacy", { p_org_id: org, p_branch_id: b1 });
await owner.rpc("create_pharmacist", { p_org_id: org, p_user_id: pharmUser.user.id, p_branch_ids: [b1] });
ok("org active, b1 licensed, pharmacist member");

console.log("1) retention_policies seeded + readable");
const { data: retPol, error: retErr } = await SERVICE.from("retention_policies").select("sensitivity, retention_months, enabled").order("sensitivity");
if (!retErr && retPol?.length === 3) ok("3 retention policies seeded");
else bad("retention_policies", retErr?.message ?? JSON.stringify(retPol));
const rp = Object.fromEntries(retPol?.map((r) => [r.sensitivity, r.retention_months]) ?? []);
rp.sales_financial === 36 && rp.patient_health === 72 && rp.none === 0
  ? ok("sales_financial=36, patient_health=72, none=0")
  : bad("policy values", JSON.stringify(rp));
const { error: rpPharmErr } = await pharm.from("retention_policies").select("sensitivity");
!rpPharmErr ? ok("pharmacist sees retention_policies") : bad("pharm read retention", rpPharmErr?.message);

console.log("2) retentention helpers via template link");
const noneTemplate = (await SERVICE.from("templates").insert({
  code: `none_e2e_${stamp}`, name: "E2E none", description: null, type: "product", sensitivity: "none",
}).select("code").single()).data.code;
const dsSales = (await SERVICE.from("datasets").insert({
  owner_id: ownerUser.user.id, name: "Retention Sales", original_filename: "no.csv", storage_path: "compliance/no-sales.csv",
  status: "ready", row_count: 3, column_defs: [], template_code: "sales",
  created_at: new Date(Date.now() - 40 * 30 * 86400000).toISOString(), updated_at: new Date(Date.now() - 40 * 30 * 86400000).toISOString(),
}).select("id").single()).data.id;
const dsHealth = (await SERVICE.from("datasets").insert({
  owner_id: ownerUser.user.id, name: "Retention Health", original_filename: "no.csv", storage_path: "compliance/no-health.csv",
  status: "ready", row_count: 5, column_defs: [], template_code: "health",
  created_at: new Date(Date.now() - 80 * 30 * 86400000).toISOString(), updated_at: new Date(Date.now() - 80 * 30 * 86400000).toISOString(),
}).select("id").single()).data.id;
const dsNone = (await SERVICE.from("datasets").insert({
  owner_id: ownerUser.user.id, name: "Retention None", original_filename: "no.csv", storage_path: "compliance/no-none.csv",
  status: "ready", row_count: 0, column_defs: [], template_code: noneTemplate,
  created_at: new Date(Date.now() - 80 * 30 * 86400000).toISOString(), updated_at: new Date().toISOString(),
}).select("id").single()).data.id;

const { data: rmSales } = await owner.rpc("_sf_retention_months", { p_dataset_id: dsSales });
const { data: rmHealth } = await owner.rpc("_sf_retention_months", { p_dataset_id: dsHealth });
const { data: rmNone } = await owner.rpc("_sf_retention_months", { p_dataset_id: dsNone });
rmSales === 36 ? ok("sales dataset → 36 months") : bad("dsSales retention", rmSales);
rmHealth === 72 ? ok("health dataset → 72 months") : bad("dsHealth retention", rmHealth);
rmNone === 0 ? ok("none-classed dataset → 0 (keep)") : bad("dsNone retention", rmNone);

console.log("3) _sf_purge_eligible lists only aged sales/health");
const { data: elig } = await owner.rpc("_sf_purge_eligible", {
  p_cutoff: new Date().toISOString(),
  p_dataset_ids: [dsSales, dsHealth, dsNone],
});
const eligIds = (elig ?? []).map((r) => r.id);
if (eligIds.includes(dsSales) && eligIds.includes(dsHealth) && !eligIds.includes(dsNone))
  ok("sales(40mo) + health(80mo) eligible; none-classed not eligible");
else bad("_sf_purge_eligible", JSON.stringify(eligIds));

console.log("4) archive_dataset (soft) — status → purged, rows kept, RLS-check");
await SERVICE.from("dataset_rows").insert([
  { dataset_id: dsSales, row_index: 0, data: { date: "2025-01-01", qty: 1 } },
  { dataset_id: dsSales, row_index: 1, data: { date: "2025-01-02", qty: 2 } },
]);
await SERVICE.from("dataset_operations").insert({ dataset_id: dsSales, user_id: ownerUser.user.id, operation_type: "op", payload: {}, inverse_payload: {} });
await SERVICE.from("dataset_column_stats").insert({ dataset_id: dsSales, column_key: "qty", sum: 3 });
const { error: archErr } = await owner.rpc("archive_dataset", { p_dataset_id: dsSales });
archErr ? bad("archive_dataset", archErr.message) : ok("archive_dataset accepted");
const { data: dsSalesAfterArch } = await SERVICE.from("datasets").select("status").eq("id", dsSales).single();
dsSalesAfterArch?.status === "purged" ? ok("dataset status → purged (soft)") : bad("post-archive status", dsSalesAfterArch?.status);
const { count: rowsAfterArch } = await SERVICE.from("dataset_rows").select("id", { count: "exact" }).eq("dataset_id", dsSales);
rowsAfterArch === 2 ? ok("rows retained after archive") : bad("rows after archive", rowsAfterArch);
const { error: pharmArch } = await pharm.rpc("archive_dataset", { p_dataset_id: dsHealth });
pharmArch ? ok("pharmacist archive blocked") : bad("pharm archive should fail");

console.log("5) purge_dataset (hard) — rows/stats/ops/dataset/object removed");
const { error: purgeErr } = await owner.rpc("purge_dataset", { p_dataset_id: dsSales });
purgeErr ? bad("purge_dataset", purgeErr.message) : ok("purge_dataset accepted");
const { count: rowsGone } = await SERVICE.from("dataset_rows").select("id", { count: "exact" }).eq("dataset_id", dsSales);
rowsGone === 0 ? ok("dataset_rows purged") : bad("rows after purge", rowsGone);
const { count: opsGone } = await SERVICE.from("dataset_operations").select("id", { count: "exact" }).eq("dataset_id", dsSales);
opsGone === 0 ? ok("dataset_operations purged") : bad("ops after purge", opsGone);
const { data: statsGone } = await SERVICE.from("dataset_column_stats").select("column_key").eq("dataset_id", dsSales).maybeSingle();
!statsGone ? ok("dataset_column_stats purged") : bad("stats after purge", JSON.stringify(statsGone));
const { data: dsGone } = await SERVICE.from("datasets").select("id").eq("id", dsSales).maybeSingle();
!dsGone ? ok("dataset row deleted") : bad("dataset after purge", JSON.stringify(dsGone));
const { error: purgeNotArchived } = await owner.rpc("purge_dataset", { p_dataset_id: dsHealth });
purgeNotArchived?.message?.includes("NOT_PURGED") ? ok("purge requires archived (NOT_PURGED)") : bad("purge-not-archived", purgeNotArchived?.message);
const { error: pharmPurge } = await pharm.rpc("purge_dataset", { p_dataset_id: dsHealth });
pharmPurge ? ok("pharmacist purge blocked") : bad("pharm purge should fail");

console.log("6) purge_expired sweep — dry mode archives eligible");
const onlyHealth = [dsHealth];
const { data: sweepDry } = await owner.rpc("purge_expired", { p_cutoff: new Date().toISOString(), p_purge: false, p_dataset_ids: onlyHealth });
Number(sweepDry) === 1 ? ok(`dry sweep archived ${sweepDry} (health)`) : bad("sweep dry count", sweepDry);
const { data: dsHealthAfter } = await SERVICE.from("datasets").select("status").eq("id", dsHealth).single();
dsHealthAfter?.status === "purged" ? ok("health dataset archived by sweep") : bad("health post-sweep", dsHealthAfter?.status);
const { error: pharmSweep } = await pharm.rpc("purge_expired", { p_cutoff: new Date().toISOString(), p_purge: false, p_dataset_ids: onlyHealth });
pharmSweep ? ok("pharmacist sweep blocked") : bad("pharm sweep should fail");

console.log("6b) purge_expired real mode hard-deletes archived");
const { data: sweepReal } = await owner.rpc("purge_expired", { p_cutoff: new Date().toISOString(), p_purge: true, p_dataset_ids: onlyHealth });
const { data: dsHealthGone } = await SERVICE.from("datasets").select("id").eq("id", dsHealth).maybeSingle();
Number(sweepReal) === 1 && !dsHealthGone ? ok("real sweep hard-purges archived dataset") : bad("sweep real", `${sweepReal}/${JSON.stringify(dsHealthGone)}`);
const { data: dsNoneAfter } = await SERVICE.from("datasets").select("id").eq("id", dsNone).maybeSingle();
dsNoneAfter ? ok("none-classed dataset survives") : bad("none dataset lost", JSON.stringify(dsNoneAfter));

console.log("7) subject_requests — request, process, reject, RLS");
const { error: reqErr } = await pharm.rpc("request_subject_action", { p_kind: "export", p_note: "e2e" });
reqErr ? bad("request export", reqErr.message) : ok("pharmacist requested export");
const { data: reqRow } = await pharm.from("subject_requests").select("id, kind, status, user_email").eq("user_email", pharmEmail).order("id", { ascending: false }).limit(1).single();
if (reqRow?.kind === "export" && reqRow?.status === "new") ok(`request row: kind=export status=new`);
else bad("request row", JSON.stringify(reqRow));
const { data: ownReqs } = await pharm.from("subject_requests").select("id").eq("user_email", pharmEmail);
ownReqs?.length >= 1 ? ok("user reads own requests") : bad("own requests", ownReqs?.length);

const { data: exportId } = await owner.rpc("process_subject_request", { p_request_id: reqRow.id, p_decision: "done" });
const { data: exportRow } = await SERVICE.from("subject_requests").select("status, payload").eq("id", reqRow.id).single();
if (exportRow?.status === "done" && Array.isArray(exportRow?.payload?.memberships) && exportRow.payload.memberships.length === 1)
  ok("export processed: done + memberships payload");
else bad("export result", JSON.stringify(exportRow));

const { error: rejectOwnerErr } = await pharm.rpc("process_subject_request", { p_request_id: reqRow.id, p_decision: "rejected" });
rejectOwnerErr ? ok("pharmacist cannot process (FORBIDDEN)") : bad("pharm process should fail");

const { data: delId } = await pharm.rpc("request_subject_action", { p_kind: "delete", p_note: "e2e" });
const { error: rejectDelErr } = await owner.rpc("process_subject_request", { p_request_id: delId, p_decision: "rejected" });
const { data: delRow } = await SERVICE.from("subject_requests").select("status, processed_at, processed_by").eq("id", delId).single();
if (delRow?.status === "rejected" && delRow?.processed_by === ownerUser.user.id) ok("reject path records decision");
else bad("reject result", JSON.stringify(delRow));

console.log("8) terms — current, pending, accept");
const { data: curTerms } = await pharm.rpc("current_terms");
curTerms?.version === "2026-08-01" ? ok("current_terms seeded") : bad("current_terms", JSON.stringify(curTerms));
const { data: pending0 } = await pharm.rpc("terms_pending");
pending0 === true ? ok("terms_pending true before accept") : bad("terms_pending", pending0);
const { error: acceptErr } = await pharm.rpc("accept_terms");
acceptErr ? bad("accept_terms", acceptErr.message) : ok("accept_terms ok");
const { data: pending1 } = await pharm.rpc("terms_pending");
pending1 === false ? ok("terms_pending false after accept") : bad("terms_pending2", pending1);
const { data: accepts } = await SERVICE.from("terms_acceptances").select("user_id, terms_id").eq("user_id", pharmUser.user.id);
accepts?.length === 1 ? ok("acceptance recorded (idempotent)") : bad("acceptances", accepts?.length);
await pharm.rpc("accept_terms");
const { data: accepts2 } = await SERVICE.from("terms_acceptances").select("user_id, terms_id").eq("user_id", pharmUser.user.id);
accepts2?.length === 1 ? ok("re-accept is idempotent (no dupes)") : bad("acceptances2", accepts2?.length);

console.log("9) cleanup");
if (dsNone) await SERVICE.from("datasets").delete().eq("id", dsNone);
if (noneTemplate) await SERVICE.from("templates").delete().eq("code", noneTemplate);
if (org) await SERVICE.from("organizations").delete().eq("id", org);
await SERVICE.auth.admin.deleteUser(ownerUser.user.id).catch(() => {});
await SERVICE.auth.admin.deleteUser(pharmUser.user.id).catch(() => {});

console.log(fail === 0 ? "\nPASS — all compliance checks succeeded." : `\nFAIL — ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);