"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type QuranBulkState = {
  error: string | null;
  saved?: number;
  date?: string;
};

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function nullable(form: FormData, key: string): string | null {
  const v = text(form, key);
  return v === "" ? null : v;
}

function positiveNumber(form: FormData, key: string): number | null {
  const v = text(form, key);
  const n = v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function intOrNull(form: FormData, key: string): number | null {
  const v = text(form, key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Bulk-logs one Quran lesson per student in a single submit.
 * Students whose `lines_N` field is empty are silently skipped.
 * The shared `date` applies to every row that is saved.
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

  const studentIdsRaw = text(form, "student_ids");
  const studentIds = studentIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (studentIds.length === 0) {
    return { error: "No students to log for." };
  }

  type Row = {
    student_id: string;
    date: string;
    surah: string | null;
    from_ayah: number | null;
    to_ayah: number | null;
    lines_memorized: number;
    note: string | null;
    recorded_by: string;
    recorded_at: string;
  };

  const rows: Row[] = [];
  const now = new Date().toISOString();

  for (const studentId of studentIds) {
    const lines = positiveNumber(form, `lines_${studentId}`);
    // Skip students where no lines entry was made at all.
    if (lines === null && text(form, `lines_${studentId}`) === "") continue;
    // Entered a non-numeric value — treat as validation error.
    if (lines === null) {
      return { error: `Lines memorized must be a number (problem with student ${studentId}).` };
    }

    rows.push({
      student_id: studentId,
      date,
      surah: nullable(form, `surah_${studentId}`),
      from_ayah: intOrNull(form, `from_${studentId}`),
      to_ayah: intOrNull(form, `to_${studentId}`),
      lines_memorized: lines,
      note: nullable(form, `note_${studentId}`),
      recorded_by: profile.id,
      recorded_at: now,
    });
  }

  if (rows.length === 0) {
    return { error: "Enter at least one student's lesson before saving." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("quran_progress").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/quran");
  return { error: null, saved: rows.length, date };
}
