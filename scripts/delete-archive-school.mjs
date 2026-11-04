// Deletes the pre-multi-tenant archive school and everything in it (spec §3.5).
// Owner-run only:  node --env-file=.env.local scripts/delete-archive-school.mjs
// Prints counts first and needs you to type DELETE. Auth users are not removed.
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const ARCHIVE_ID = "00000000-0000-0000-0000-000000000001";
const TABLES = ["students", "guardians", "grades", "attendance", "quran_progress", "payments", "notifications", "profiles"];

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

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type DELETE to permanently delete the archive school and all rows above: ');
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
