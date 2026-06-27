"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { enrollmentStatuses, type EnrollmentStatus } from "@/lib/people/people";

export type ActionState = { error: string | null };

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function nullable(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value === "" ? null : value;
}

function parseEnrollment(value: string): EnrollmentStatus {
  return (enrollmentStatuses as string[]).includes(value)
    ? (value as EnrollmentStatus)
    : "active";
}

export async function createStudent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  // Students are read+write for admin AND moderator per the access matrix.
  await requireRole(["admin", "moderator"]);

  const firstName = text(form, "first_name");
  const lastName = text(form, "last_name");
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({
      first_name: firstName,
      last_name: lastName,
      date_of_birth: nullable(form, "date_of_birth"),
      grade_level: nullable(form, "grade_level"),
      enrollment_status: parseEnrollment(text(form, "enrollment_status")),
      gcvs_reference: nullable(form, "gcvs_reference"),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/students");
  redirect(`/students/${data.id}`);
}

export async function updateStudent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin", "moderator"]);

  const id = text(form, "id");
  const firstName = text(form, "first_name");
  const lastName = text(form, "last_name");
  if (!id) return { error: "Missing student id." };
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({
      first_name: firstName,
      last_name: lastName,
      date_of_birth: nullable(form, "date_of_birth"),
      grade_level: nullable(form, "grade_level"),
      enrollment_status: parseEnrollment(text(form, "enrollment_status")),
      gcvs_reference: nullable(form, "gcvs_reference"),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/students");
  revalidatePath(`/students/${id}`);
  redirect(`/students/${id}`);
}

/** Linking a student to a guardian is an admin-only operation (RLS: guardians
 * and student_guardians are read-only for moderators). */
export async function linkGuardian(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const studentId = text(form, "student_id");
  const guardianId = text(form, "guardian_id");
  if (!studentId || !guardianId) {
    return { error: "Select a guardian to link." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("student_guardians").upsert(
    {
      student_id: studentId,
      guardian_id: guardianId,
      relationship: nullable(form, "relationship"),
      is_primary: form.get("is_primary") === "on",
    },
    { onConflict: "student_id,guardian_id" },
  );

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/guardians/${guardianId}`);
  return { error: null };
}

export async function unlinkGuardian(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const studentId = text(form, "student_id");
  const guardianId = text(form, "guardian_id");
  if (!studentId || !guardianId) return { error: "Missing link reference." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_guardians")
    .delete()
    .eq("student_id", studentId)
    .eq("guardian_id", guardianId);

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/guardians/${guardianId}`);
  return { error: null };
}
