"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkLowGradeAlert } from "@/lib/alerts/grades";
import { checkPaceAlerts } from "@/lib/alerts/pace";
import { requireRole } from "@/lib/auth/current-profile";
import type { PaceContext } from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
import {
  MAX_SWEEP_ENTRIES,
  invalidMessage,
  planSweep,
  type SweepCourse,
  type SweepInsert,
  type SweepInvalid,
} from "@/lib/grades/sweep";
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Both dates or neither; end on or after start. */
function parseCourseDates(
  form: FormData,
): { ok: true; start: string | null; end: string | null } | { ok: false; error: string } {
  const start = nullable(form, "start_date");
  const end = nullable(form, "end_date");
  if (start === null && end === null) return { ok: true, start, end };
  if (start === null || end === null) {
    return { ok: false, error: "Enter both course dates, or leave both blank to use the term dates." };
  }
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
    return { ok: false, error: "Course dates must be valid dates." };
  }
  if (end < start) return { ok: false, error: "Course end must be on or after course start." };
  return { ok: true, start, end };
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

  const dates = parseCourseDates(form);
  if (!dates.ok) return { error: dates.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      student_id: studentId,
      name,
      gcvs_course_code: nullable(form, "gcvs_course_code"),
      start_date: dates.start,
      end_date: dates.end,
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

/** Set or clear a course's own start/end dates (blank = use the term dates). */
export async function updateCourseDates(
  _prev: GradeActionState,
  form: FormData,
): Promise<GradeActionState> {
  await requireRole(["admin", "moderator"]);

  const courseId = text(form, "course_id");
  if (!courseId) return { error: "Missing course reference." };
  const dates = parseCourseDates(form);
  if (!dates.ok) return { error: dates.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .update({ start_date: dates.start, end_date: dates.end })
    .eq("id", courseId)
    .select("student_id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Course not found." };

  revalidatePath("/grades");
  revalidatePath(`/grades/${courseId}`);
  revalidatePath(`/students/${data.student_id}`);
  return { error: null };
}

type SnapshotAlertTarget = {
  insert: SweepInsert;
  studentName: string;
  courseName: string;
  groupId: string | null;
  course: { startDate: string | null; endDate: string | null };
};

/**
 * After snapshots are saved: the low-grade alert only when the grade value
 * itself changed, then the pace/missing-work alerts. Sequential, and an alert
 * failure is logged (no PII) but never fails a save that already succeeded.
 */
async function runSnapshotAlerts(targets: SnapshotAlertTarget[]) {
  let context: PaceContext | undefined;
  try {
    context = await loadPaceContext({ service: true });
  } catch (error) {
    console.error(
      "Grade save: could not load pace settings",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  for (const target of targets) {
    const { insert } = target;
    if (insert.gradeChanged) {
      try {
        await checkLowGradeAlert({
          studentId: insert.studentId,
          studentName: target.studentName,
          courseName: target.courseName,
          gradeValue: insert.gradeValue,
          includeGuardians: false,
        });
      } catch (error) {
        console.error(
          "Grade save: low-grade alert failed",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
    if (!context) continue;
    try {
      await checkPaceAlerts(
        {
          studentId: insert.studentId,
          studentName: target.studentName,
          courseId: insert.courseId,
          courseName: target.courseName,
          groupId: target.groupId,
          course: target.course,
          percentComplete: insert.percentComplete,
          missingAssignments: insert.missingAssignments,
        },
        { context },
      );
    } catch (error) {
      console.error(
        "Grade save: pace alert failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}

function revalidateSnapshots(inserts: SweepInsert[]) {
  revalidatePath("/grades");
  revalidatePath("/grades/sweep");
  for (const studentId of new Set(inserts.map((insert) => insert.studentId))) {
    revalidatePath(`/students/${studentId}`);
  }
  for (const insert of inserts) revalidatePath(`/grades/${insert.courseId}`);
}

function snapshotRow(insert: SweepInsert, recordedBy: string, note: string | null = null) {
  return {
    course_id: insert.courseId,
    student_id: insert.studentId,
    grade_value: insert.gradeValue,
    percent_complete: insert.percentComplete,
    missing_assignments: insert.missingAssignments,
    note,
    recorded_by: recordedBy,
  };
}

/**
 * Single-course entry (course page and student profile). Uses the same
 * snapshot rules as the sweep: blank fields carry forward the latest value,
 * and a submit that changes nothing is rejected rather than duplicated.
 */
export async function recordGrade(
  _prev: GradeActionState,
  form: FormData,
): Promise<GradeActionState> {
  const profile = await requireRole(["admin", "moderator"]);

  const courseId = text(form, "course_id");
  if (!courseId) return { error: "Missing course reference." };

  const supabase = await createClient();
  const [courseResult, latestResult] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, name, student_id, start_date, end_date, students(first_name, last_name, schedule_group_id)",
      )
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("grades")
      .select("grade_value, percent_complete, missing_assignments")
      .eq("course_id", courseId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (courseResult.error) return { error: courseResult.error.message };
  if (latestResult.error) return { error: latestResult.error.message };
  const course = courseResult.data;
  if (!course) return { error: "Course not found." };

  const student = (Array.isArray(course.students) ? course.students[0] : course.students) as {
    first_name: string;
    last_name: string;
    schedule_group_id: string | null;
  } | null;
  const latest = latestResult.data;

  const plan = planSweep(
    [
      {
        courseId,
        value: text(form, "grade_value"),
        percent: text(form, "percent_complete"),
        missing: text(form, "missing_assignments"),
      },
    ],
    [
      {
        id: courseId,
        studentId: course.student_id,
        latestGrade: latest ? Number(latest.grade_value) : null,
        latestPercentComplete:
          latest?.percent_complete == null ? null : Number(latest.percent_complete),
        latestMissing:
          latest?.missing_assignments == null ? null : Number(latest.missing_assignments),
      },
    ],
  );

  if (plan.invalid.length > 0) {
    const [first] = plan.invalid;
    return { error: invalidMessage(first.field, first.reason) };
  }
  const [insert] = plan.toInsert;
  if (!insert) {
    return {
      error: plan.skippedUnchanged > 0
        ? "Nothing changed from the latest snapshot."
        : "Enter a grade, % complete or missing count.",
    };
  }

  const { error } = await supabase
    .from("grades")
    .insert(snapshotRow(insert, profile.id, nullable(form, "note")));
  if (error) return { error: error.message };

  await runSnapshotAlerts([
    {
      insert,
      studentName: student ? studentName(student) : "A student",
      courseName: course.name,
      groupId: student?.schedule_group_id ?? null,
      course: { startDate: course.start_date ?? null, endDate: course.end_date ?? null },
    },
  ]);

  revalidateSnapshots([insert]);
  return { error: null };
}

export type SaveGradeSweepResult = {
  saved: number;
  skippedUnchanged: number;
  invalid: SweepInvalid[];
  /** Set when nothing could be saved (bad request or database error). */
  error?: string;
};

type SweepStudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  schedule_group_id: string | null;
  courses: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
  }[];
};

/**
 * Save the weekly sweep. The client sends only the typed strings; the courses
 * (and which students are active) and each course's latest snapshot are loaded
 * here, so nothing about "last grade" is trusted from the browser.
 */
export async function saveGradeSweep(
  entries: { courseId: string; value: string; percent?: string; missing?: string }[],
): Promise<SaveGradeSweepResult> {
  const profile = await requireRole(["admin", "moderator"]);
  const empty = { saved: 0, skippedUnchanged: 0, invalid: [] };

  if (!Array.isArray(entries) || entries.length > MAX_SWEEP_ENTRIES) {
    return { ...empty, error: "Invalid sweep request." };
  }

  const supabase = await createClient();

  const { data: studentRows, error: studentsError } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, schedule_group_id, courses(id, name, start_date, end_date)",
    )
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
  const labels = new Map<string, Omit<SnapshotAlertTarget, "insert">>();
  for (const student of (studentRows ?? []) as unknown as SweepStudentRow[]) {
    for (const course of student.courses) {
      const latest = latestGrades.get(course.id);
      courses.push({
        id: course.id,
        studentId: student.id,
        latestGrade: latest?.value ?? null,
        latestPercentComplete: latest?.percentComplete ?? null,
        latestMissing: latest?.missingAssignments ?? null,
      });
      labels.set(course.id, {
        studentName: studentName(student),
        courseName: course.name,
        groupId: student.schedule_group_id,
        course: { startDate: course.start_date, endDate: course.end_date },
      });
    }
  }

  const plan = planSweep(
    entries.map((entry) => ({
      courseId: entry?.courseId,
      value: entry?.value,
      percent: entry?.percent,
      missing: entry?.missing,
    })),
    courses,
  );

  if (plan.toInsert.length > 0) {
    const { error } = await supabase
      .from("grades")
      .insert(plan.toInsert.map((insert) => snapshotRow(insert, profile.id)));
    if (error) return { ...empty, error: error.message };

    await runSnapshotAlerts(
      plan.toInsert.map((insert) => ({
        insert,
        studentName: labels.get(insert.courseId)?.studentName ?? "A student",
        courseName: labels.get(insert.courseId)?.courseName ?? "a course",
        groupId: labels.get(insert.courseId)?.groupId ?? null,
        course: labels.get(insert.courseId)?.course ?? { startDate: null, endDate: null },
      })),
    );
    revalidateSnapshots(plan.toInsert);
  }

  return {
    saved: plan.toInsert.length,
    skippedUnchanged: plan.skippedUnchanged,
    invalid: plan.invalid,
  };
}
