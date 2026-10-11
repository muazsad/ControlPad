import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST returns at most 1000 rows per request, so we page. */
const GRADE_PAGE_SIZE = 1000;

export type LatestGrade = { value: number; recordedAt: string };

/**
 * Latest grade snapshot per course, for courses of ACTIVE students only.
 * Grades are append-only, so this reads newest-first and keeps the first row
 * seen per course. Shared by the sweep page and the save action so both agree
 * on what "latest" means.
 */
export async function fetchLatestGrades(
  supabase: SupabaseClient,
): Promise<Map<string, LatestGrade>> {
  const latest = new Map<string, LatestGrade>();

  for (let from = 0; ; from += GRADE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("grades")
      .select("course_id, grade_value, recorded_at, students!inner(enrollment_status)")
      .eq("students.enrollment_status", "active")
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + GRADE_PAGE_SIZE - 1);

    if (error) throw error;

    for (const row of data ?? []) {
      if (!latest.has(row.course_id)) {
        latest.set(row.course_id, {
          value: Number(row.grade_value),
          recordedAt: row.recorded_at,
        });
      }
    }

    if (!data || data.length < GRADE_PAGE_SIZE) break;
  }

  return latest;
}
