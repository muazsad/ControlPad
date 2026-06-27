"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkLowGradeAlert } from "@/lib/alerts/grades";
import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type GradeActionState = { error: string | null };

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function nullable(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value === "" ? null : value;
}

function parseGrade(value: string): number | null {
  if (!value) return null;
  const grade = Number(value);
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) return null;
  return grade;
}

export async function createCourse(
  _prev: GradeActionState,
  form: FormData,
): Promise<GradeActionState> {
  await requireRole(["admin", "moderator"]);

  const studentId = text(form, "student_id");
  const name = text(form, "name");
  if (!studentId) return { error: "Select a student." };
  if (!name) return { error: "Course name is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      student_id: studentId,
      name,
      gcvs_course_code: nullable(form, "gcvs_course_code"),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/grades");
  redirect(`/grades/${data.id}`);
}

export async function recordGrade(
  _prev: GradeActionState,
  form: FormData,
): Promise<GradeActionState> {
  const profile = await requireRole(["admin", "moderator"]);

  const courseId = text(form, "course_id");
  const studentId = text(form, "student_id");
  const studentName = text(form, "student_name");
  const courseName = text(form, "course_name");
  const gradeValue = parseGrade(text(form, "grade_value"));

  if (!courseId || !studentId) return { error: "Missing course reference." };
  if (gradeValue === null) {
    return { error: "Enter a grade between 0 and 100." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("grades").insert({
    course_id: courseId,
    student_id: studentId,
    grade_value: gradeValue,
    note: nullable(form, "note"),
    recorded_by: profile.id,
  });

  if (error) return { error: error.message };

  await checkLowGradeAlert({
    studentId,
    studentName: studentName || "A student",
    courseName: courseName || "a course",
    gradeValue,
    includeGuardians: false,
  });

  revalidatePath("/grades");
  revalidatePath(`/grades/${courseId}`);
  return { error: null };
}
