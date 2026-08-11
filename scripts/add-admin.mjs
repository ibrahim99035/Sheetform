#!/usr/bin/env node
/**
 * Elevate (or demote) a user to/from superadmin.
 *
 * Usage:
 *   node scripts/add-admin.mjs <email>
 *   node scripts/add-admin.mjs <email> --remove
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (read from .env.local) — the only way to
 * grant the role, since authenticated users can never insert into admin_users.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const email = process.argv[2];
const remove = process.argv.includes("--remove");
if (!email) {
  console.error("Usage: node scripts/add-admin.mjs <email> [--remove]");
  process.exit(1);
}

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const {
  data: { users },
  error: listErr,
} = await supabase.auth.admin.listUsers();
if (listErr) {
  console.error("Failed to list users:", listErr.message);
  process.exit(1);
}

const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No user found with email "${email}".`);
  process.exit(1);
}

if (remove) {
  const { error } = await supabase.from("admin_users").delete().eq("user_id", user.id);
  if (error) {
    console.error("Failed to remove admin:", error.message);
    process.exit(1);
  }
  console.log(`Removed ${email} (${user.id}) from superadmins.`);
} else {
  const { error } = await supabase
    .from("admin_users")
    .upsert({ user_id: user.id }, { onConflict: "user_id" });
  if (error) {
    console.error("Failed to add admin:", error.message);
    process.exit(1);
  }
  console.log(`Added ${email} (${user.id}) as superadmin.`);
}