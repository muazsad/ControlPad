// ControlPad seed script — creates test accounts and records for each role so
// you can log in and verify role-based access and parent data isolation.
//
// Run with the service-role key loaded from .env.local:
//   npm run seed
//   (equivalently: node --env-file=.env.local scripts/seed.mjs)
//
// Idempotent: safe to run more than once. It reuses existing users/records by
// email and name rather than creating duplicates.
//
// The service-role key bypasses RLS — this is server-side tooling only and must
// never run in the browser.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD ?? "Password123!";

if (!url || !serviceKey) {
  console.error(
    "Missing env. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (e.g. run via `npm run seed`).",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // Paginate through users (fine for a small test project).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function getOrCreateUser(email, fullName) {
  const existing = await findUserByEmail(email);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

async function upsertProfile(id, role, fullName, phone = null) {
  const { error } = await admin
    .from("profiles")
    .upsert({ id, role, full_name: fullName, phone }, { onConflict: "id" });
  if (error) throw error;
}

async function getOrCreateGuardian({ fullName, phone, email, userId }) {
  const { data: existing, error: selErr } = await admin
    .from("guardians")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const { error } = await admin
      .from("guardians")
      .update({ full_name: fullName, phone, user_id: userId })
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin
    .from("guardians")
    .insert({ full_name: fullName, phone, email, user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function getOrCreateStudent({ firstName, lastName, gradeLevel }) {
  const { data: existing, error: selErr } = await admin
    .from("students")
    .select("id")
    .eq("first_name", firstName)
    .eq("last_name", lastName)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data, error } = await admin
    .from("students")
    .insert({
      first_name: firstName,
      last_name: lastName,
      grade_level: gradeLevel,
      enrollment_status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function linkStudentGuardian(studentId, guardianId, relationship, isPrimary) {
  const { error } = await admin.from("student_guardians").upsert(
    {
      student_id: studentId,
      guardian_id: guardianId,
      relationship,
      is_primary: isPrimary,
    },
    { onConflict: "student_id,guardian_id" },
  );
  if (error) throw error;
}

async function main() {
  console.log("Seeding ControlPad test data...");

  // --- Staff ---
  const adminId = await getOrCreateUser("admin@salaam.test", "Amina Director");
  await upsertProfile(adminId, "admin", "Amina Director", "+14135550100");

  const modId = await getOrCreateUser("moderator@salaam.test", "Tariq Teacher");
  await upsertProfile(modId, "moderator", "Tariq Teacher", "+14135550101");

  // --- Family A: parent Aisha Khan, children Yusuf & Maryam ---
  const parentAId = await getOrCreateUser("parentA@salaam.test", "Aisha Khan");
  await upsertProfile(parentAId, "parent", "Aisha Khan", "+14135550111");
  const guardianAId = await getOrCreateGuardian({
    fullName: "Aisha Khan",
    phone: "+14135550111",
    email: "parentA@salaam.test",
    userId: parentAId,
  });
  const yusufId = await getOrCreateStudent({
    firstName: "Yusuf",
    lastName: "Khan",
    gradeLevel: "7th grade",
  });
  const maryamId = await getOrCreateStudent({
    firstName: "Maryam",
    lastName: "Khan",
    gradeLevel: "5th grade",
  });
  await linkStudentGuardian(yusufId, guardianAId, "mother", true);
  await linkStudentGuardian(maryamId, guardianAId, "mother", true);

  // --- Family B: parent Bilal Rahman, child Omar ---
  const parentBId = await getOrCreateUser("parentB@salaam.test", "Bilal Rahman");
  await upsertProfile(parentBId, "parent", "Bilal Rahman", "+14135550122");
  const guardianBId = await getOrCreateGuardian({
    fullName: "Bilal Rahman",
    phone: "+14135550122",
    email: "parentB@salaam.test",
    userId: parentBId,
  });
  const omarId = await getOrCreateStudent({
    firstName: "Omar",
    lastName: "Rahman",
    gradeLevel: "9th grade",
  });
  await linkStudentGuardian(omarId, guardianBId, "father", true);

  console.log("\nDone. Test accounts (password: " + password + "):");
  console.table([
    { role: "admin", email: "admin@salaam.test" },
    { role: "moderator", email: "moderator@salaam.test" },
    { role: "parent (Khan family)", email: "parentA@salaam.test" },
    { role: "parent (Rahman family)", email: "parentB@salaam.test" },
  ]);
  console.log(
    "\nIsolation check: parentA should see Yusuf + Maryam Khan only;\n" +
      "parentB should see Omar Rahman only.",
  );
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
