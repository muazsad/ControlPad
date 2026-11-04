// Deletes the pre-multi-tenant archive school and everything in it (spec §3.5).
// Owner-run only:  node --env-file=.env.local scripts/delete-archive-school.mjs [--with-logins]
// Prints counts first and needs you to type DELETE.
//
// --with-logins also deletes the sign-in accounts whose profile is still in the
// archive (old staff and parents who haven't been re-added), so their emails can
// be used again in the new school. Run it AFTER you've recreated your school
// through onboarding — your own account has left the archive by then. Platform
// admins are never deleted.
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const ARCHIVE_ID = "00000000-0000-0000-0000-000000000001";
const TABLES = ["students", "guardians", "grades", "attendance", "quran_progress", "payments", "notifications", "profiles"];
const withLogins = process.argv.includes("--with-logins");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: school } = await supabase.from("schools").select("id, name, archived").eq("id", ARCHIVE_ID).maybeSingle();
if (!school) {
  console.log("No archive school found. Nothing to do.");
  process.exit(0);
}
if (!school.archived) {
  console.error("The school with the archive id is not archived. Refusing.");
  process.exit(1);
}

for (const table of TABLES) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("school_id", ARCHIVE_ID);
  console.log(`${table}: ${error ? `error (${error.message})` : count}`);
}

// Collect the logins before the school (and its profiles) are deleted.
let loginIds = [];
if (withLogins) {
  const [{ data: profiles, error: profileError }, { data: admins, error: adminError }] = await Promise.all([
    supabase.from("profiles").select("id").eq("school_id", ARCHIVE_ID),
    supabase.from("platform_admins").select("user_id"),
  ]);
  if (profileError || adminError) {
    console.error(`Could not list logins: ${(profileError ?? adminError).message}`);
    process.exit(1);
  }
  const keep = new Set((admins ?? []).map((row) => row.user_id));
  loginIds = (profiles ?? []).map((row) => row.id).filter((id) => !keep.has(id));
  console.log(`sign-in accounts to delete: ${loginIds.length}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("Type DELETE to permanently delete the archive school and everything above: ");
rl.close();
if (answer.trim() !== "DELETE") {
  console.log("Cancelled.");
  process.exit(0);
}

const { error } = await supabase.from("schools").delete().eq("id", ARCHIVE_ID);
if (error) {
  console.error(`Delete failed: ${error.message}`);
  process.exit(1);
}
console.log("Archive school deleted.");

let failed = 0;
for (const id of loginIds) {
  const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
  if (deleteError) failed += 1;
}
if (withLogins) console.log(`Sign-in accounts deleted: ${loginIds.length - failed}${failed ? `, failed: ${failed}` : ""}.`);
