"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkLowGradeAlert } from "@/lib/alerts/grades";
import { requireRole } from "@/lib/auth/current-profile";
import { MAX_SWEEP_ENTRIES, planSweep, type SweepCourse, type SweepInvalidReason } from "@/lib/grades/sweep";
import { fetchLatestGrades } from "@/lib/grades/sweep-data";
import { studentName } from "@/lib/people/people";
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

  const fixedStudentId = text(form, "fixed_student_id");
  const studentId = fixedStudentId || text(form, "student_id");
  const name = text(form, "name");
  const redirectTo = text(form, "redirect_to");
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
  if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
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
  revalidatePath(`/students/${studentId}`);
  return { error: null };
}

export type SaveGradeSweepResult = {
  saved: number;
  skippedUnchanged: number;
  invalid: { courseId: string; reason: SweepInvalidReason }[];
  /** Set when nothing could be saved (bad request or database error). */
  error?: string;
};

type SweepStudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  courses: { id: string; name: string }[];
};

/**
 * Save the weekly sweep. The client sends only { courseId, value } pairs; the
 * courses (and which students are active) and each course's latest grade are
 * loaded here, so nothing about "last grade" is trusted from the browser.
 */
export async function saveGradeSweep(
  entries: { courseId: string; value: string }[],
): Promise<SaveGradeSweepResult> {
  const profile = await requireRole(["admin", "moderator"]);
  const empty = { saved: 0, skippedUnchanged: 0, invalid: [] };

  if (!Array.isArray(entries) || entries.length > MAX_SWEEP_ENTRIES) {
    return { ...empty, error: "Invalid sweep request." };
  }

  const supabase = await createClient();

  const { data: studentRows, error: studentsError } = await supabase
    .from("students")
    .select("id, first_name, last_name, courses(id, name)")
    .eq("enrollment_status", "active");
  if (studentsError) return { ...empty, error: studentsError.message };

  let latestGrades;
  try {
    latestGrades = await fetchLatestGrades(supabase);
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : "Could not load grades.",
    };
  }

  const courses: SweepCourse[] = [];
  const labels = new Map<string, { studentName: string; courseName: string }>();
  for (const student of (studentRows ?? []) as unknown as SweepStudentRow[]) {
    for (const course of student.courses) {
      courses.push({
        id: course.id,
        studentId: student.id,
        latestGrade: latestGrades.get(course.id)?.value ?? null,
      });
      labels.set(course.id, {
        studentName: studentName(student),
        courseName: course.name,
      });
    }
  }

  const plan = planSweep(
    entries.map((entry) => ({
      courseId: entry?.courseId,
      value: entry?.value,
    })),
    courses,
  );

  if (plan.toInsert.length > 0) {
    const { error } = await supabase.from("grades").insert(
      plan.toInsert.map((grade) => ({
        course_id: grade.courseId,
        student_id: grade.studentId,
        grade_value: grade.gradeValue,
        recorded_by: profile.id,
      })),
    );
    if (error) return { ...empty, error: error.message };

    // The grades are already saved; an alert problem must not fail the save.
    for (const grade of plan.toInsert) {
      const label = labels.get(grade.courseId);
      try {
        await checkLowGradeAlert({
          studentId: grade.studentId,
          studentName: label?.studentName ?? "A student",
          courseName: label?.courseName ?? "a course",
          gradeValue: grade.gradeValue,
          includeGuardians: false,
        });
      } catch (alertError) {
        console.error(
          "Grade sweep: low-grade alert failed",
          alertError instanceof Error ? alertError.message : "unknown error",
        );
      }
    }

    revalidatePath("/grades");
    revalidatePath("/grades/sweep");
    for (const studentId of new Set(plan.toInsert.map((g) => g.studentId))) {
      revalidatePath(`/students/${studentId}`);
    }
    for (const grade of plan.toInsert) {
      revalidatePath(`/grades/${grade.courseId}`);
    }
  }

  return {
    saved: plan.toInsert.length,
    skippedUnchanged: plan.skippedUnchanged,
    invalid: plan.invalid,
  };
}
