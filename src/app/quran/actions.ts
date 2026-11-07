"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import {
  JUZ_MAX,
  JUZ_MIN,
  parseJuzPages,
  type JuzPages,
  type QuranLessonType,
} from "@/lib/quran/lessons";
import { createClient } from "@/lib/supabase/server";

export type QuranBulkState = {
  error: string | null;
  saved?: number;
  date?: string;
};

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function positiveNumber(form: FormData, key: string): number | null {
  const v = text(form, key);
  const n = v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Bulk-logs Quran lessons for many students in one submit. Per student:
 * - `lines_<id>`: sabaq (new memorization) lines → one `sabaq` row;
 * - `para_<id>`: one sabaq para section ("3: 1-5") → one `sabaq_para` row;
 * - `dhor_<id>`: one or more dhor sections ("3: 1-5, 7: 10-20") → one `dhor` row each.
 * Revision sections always carry their pages within the juz.
 * Blank inputs are skipped. Revision rows store 0 lines: only sabaq counts as
 * memorization. Any revised juz is added to the student's memorized juz.
 * One batch insert, plus one batch upsert for memorized juz.
 */
export async function logQuranLessons(
  _prev: QuranBulkState,
  form: FormData,
): Promise<QuranBulkState> {
  const profile = await requireRole(["admin", "moderator"]);

  const date = text(form, "date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Choose a valid date." };
  }

  const studentIds = text(form, "student_ids")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (studentIds.length === 0) {
    return { error: "No students to log for." };
  }

  type Row = {
    student_id: string;
    date: string;
    lesson_type: QuranLessonType;
    juz: number | null;
    from_page: number | null;
    to_page: number | null;
    surah: string | null;
    from_ayah: number | null;
    to_ayah: number | null;
    lines_memorized: number;
    note: string | null;
    recorded_by: string;
    recorded_at: string;
  };

  const rows: Row[] = [];
  const memorized = new Map<string, { student_id: string; juz: number; marked_at: string }>();
  const now = new Date().toISOString();
  const row = (
    studentId: string,
    lessonType: QuranLessonType,
    section: JuzPages | null,
    lines: number,
  ): Row => ({
    student_id: studentId,
    date,
    lesson_type: lessonType,
    juz: section?.juz ?? null,
    from_page: section?.fromPage ?? null,
    to_page: section?.toPage ?? null,
    surah: null,
    from_ayah: null,
    to_ayah: null,
    lines_memorized: lines,
    note: null,
    recorded_by: profile.id,
    recorded_at: now,
  });
  const nameOf = (studentId: string) => text(form, `name_${studentId}`) || "a student";

  for (const studentId of studentIds) {
    const linesRaw = text(form, `lines_${studentId}`);
    if (linesRaw !== "") {
      const lines = positiveNumber(form, `lines_${studentId}`);
      if (lines === null) {
        return { error: `Sabaq lines for ${nameOf(studentId)} must be a number.` };
      }
      rows.push(row(studentId, "sabaq", null, lines));
    }

    const para = parseJuzPages(text(form, `para_${studentId}`));
    if (!para.ok) return { error: `Sabaq para for ${nameOf(studentId)}: ${para.error}` };
    if (para.entries.length > 1) {
      return { error: `Sabaq para for ${nameOf(studentId)}: enter one juz and its pages.` };
    }
    const dhor = parseJuzPages(text(form, `dhor_${studentId}`));
    if (!dhor.ok) return { error: `Dhor for ${nameOf(studentId)}: ${dhor.error}` };

    for (const section of para.entries) rows.push(row(studentId, "sabaq_para", section, 0));
    for (const section of dhor.entries) rows.push(row(studentId, "dhor", section, 0));
    for (const { juz } of [...para.entries, ...dhor.entries]) {
      memorized.set(`${studentId}:${juz}`, { student_id: studentId, juz, marked_at: date });
    }
  }

  if (rows.length === 0) {
    return { error: "Enter at least one student's lesson before saving." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("quran_progress").insert(rows);
  if (error) return { error: error.message };

  // Revising a juz means it was memorized: add any that aren't marked yet
  // (existing marks, and their marked_at dates, are left untouched).
  let juzError: string | null = null;
  if (memorized.size > 0) {
    const { error: upsertError } = await supabase
      .from("student_memorized_juz")
      .upsert([...memorized.values()], { onConflict: "student_id,juz", ignoreDuplicates: true });
    juzError = upsertError?.message ?? null;
  }

  revalidatePath("/quran");
  for (const studentId of new Set(rows.map((r) => r.student_id))) {
    revalidatePath(`/quran/${studentId}`);
  }

  if (juzError) {
    return {
      error: `Lessons saved, but the memorized juz list could not be updated: ${juzError}`,
      saved: rows.length,
      date,
    };
  }
  return { error: null, saved: rows.length, date };
}

/** Staff toggle on the juz grid: mark a juz memorized (today) or unmark it. */
export async function setJuzMemorized(input: {
  studentId: string;
  juz: number;
  memorized: boolean;
}): Promise<{ error: string | null }> {
  await requireRole(["admin", "moderator"]);
  const { studentId, juz, memorized } = input;
  if (!studentId || !Number.isInteger(juz) || juz < JUZ_MIN || juz > JUZ_MAX) {
    return { error: "Invalid juz." };
  }

  const supabase = await createClient();
  const { error } = memorized
    ? await supabase
        .from("student_memorized_juz")
        .upsert({ student_id: studentId, juz }, { onConflict: "student_id,juz", ignoreDuplicates: true })
    : await supabase
        .from("student_memorized_juz")
        .delete()
        .eq("student_id", studentId)
        .eq("juz", juz);
  if (error) return { error: error.message };

  revalidatePath(`/quran/${studentId}`);
  revalidatePath("/");
  return { error: null };
}

/** Start a juz test: sabaq, sabaq para and dhor aren't expected until it's finished. */
export async function startJuzTest(input: {
  studentId: string;
  juz: number;
  startedOn: string;
}): Promise<{ error: string | null }> {
  const profile = await requireRole(["admin", "moderator"]);
  const { studentId, juz, startedOn } = input;
  if (!studentId || !Number.isInteger(juz) || juz < JUZ_MIN || juz > JUZ_MAX) {
    return { error: `Choose a juz from ${JUZ_MIN} to ${JUZ_MAX}.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) return { error: "Choose a valid start date." };

  const supabase = await createClient();
  const { error } = await supabase.from("juz_tests").insert({
    student_id: studentId,
    juz,
    started_on: startedOn,
    started_by: profile.id,
  });
  if (error) {
    // Unique partial index: one open test per student.
    return {
      error: error.code === "23505" ? "This student already has a juz test in progress." : error.message,
    };
  }

  revalidatePath("/quran");
  revalidatePath(`/quran/${studentId}`);
  revalidatePath("/");
  return { error: null };
}

/** Finish the open juz test and mark that juz memorized (as of the finish date). */
export async function finishJuzTest(input: {
  studentId: string;
  testId: string;
  finishedOn: string;
}): Promise<{ error: string | null }> {
  const profile = await requireRole(["admin", "moderator"]);
  const { studentId, testId, finishedOn } = input;
  if (!studentId || !testId) return { error: "Invalid juz test." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(finishedOn)) return { error: "Choose a valid finish date." };

  const supabase = await createClient();
  const { data: test, error } = await supabase
    .from("juz_tests")
    .update({ finished_on: finishedOn, finished_by: profile.id })
    .eq("id", testId)
    .eq("student_id", studentId)
    .is("finished_on", null)
    .select("juz, started_on")
    .maybeSingle();
  if (error) {
    // Check constraint: finish can't be before start.
    return { error: error.code === "23514" ? "Finish date can't be before the start date." : error.message };
  }
  if (!test) return { error: "This juz test is already finished." };

  // Leaves an existing mark (and its date) untouched.
  const { error: juzError } = await supabase
    .from("student_memorized_juz")
    .upsert(
      { student_id: studentId, juz: test.juz, marked_at: finishedOn },
      { onConflict: "student_id,juz", ignoreDuplicates: true },
    );

  revalidatePath("/quran");
  revalidatePath(`/quran/${studentId}`);
  revalidatePath("/");
  if (juzError) {
    return { error: `Test finished, but Juz ${test.juz} could not be marked memorized: ${juzError.message}` };
  }
  return { error: null };
}
