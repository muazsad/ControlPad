import { activeJuzTest, type ActiveJuzTest, type JuzTestRow } from "@/lib/quran/juz-test";
import { sabaqOnly } from "@/lib/quran/lessons";
import { createClient } from "@/lib/supabase/server";
import { studentName, type EnrollmentStatus } from "@/lib/people/people";
import {
  avgGradeScore,
  quranScore,
  attendanceRate,
  globalPerformance,
  performanceTone,
  type GlobalPerformanceResult,
  type QuranScoreResult,
} from "@/lib/people/performance";

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 30;

// ── Internal raw types (Supabase nested select shape) ────────────────────────

type RawGrade = {
  grade_value: number;
  recorded_at: string;
  percent_complete: number | string | null;
  missing_assignments: number | null;
};
type RawCourse = {
  id: string;
  name: string;
  created_at: string | null;
  start_date: string | null;
  end_date: string | null;
  grades: RawGrade[];
};
type RawQuranEntry = { date: string; lines_memorized: number; lesson_type?: string | null };
type RawAttendance = { status: "present" | "tardy" | "absent" | "excused"; date: string };

type RawStudent = {
  id: string;
  first_name: string;
  last_name: string;
  grade_level: string | null;
  enrollment_status: EnrollmentStatus;
  schedule_group_id: string | null;
  courses: RawCourse[];
  quran_progress: RawQuranEntry[];
  attendance: RawAttendance[];
  juz_tests: JuzTestRow[] | null;
};

// ── Public shape ─────────────────────────────────────────────────────────────

/** A course with the pace fields from its latest snapshot (carry-forward keeps these current). */
export type CourseSnapshot = {
  courseId: string;
  courseName: string;
  /** When the course was added; used to judge "never graded". */
  createdAt: string | null;
  startDate: string | null;
  endDate: string | null;
  latestPercent: number | null;
  latestMissing: number | null;
  /** ISO time of the latest snapshot, or null if never graded. */
  latestRecordedAt: string | null;
  /** Every grade snapshot (for staleness and trends); order not guaranteed. */
  snapshots: { recordedAt: string; grade: number }[];
};

export type StudentMetricsRow = {
  id: string;
  name: string;
  grade_level: string | null;
  enrollment_status: EnrollmentStatus;
  courseCount: number;
  groupId: string | null;
  courseSnapshots: CourseSnapshot[];
  /** Latest grade value per course (one entry per course that has ≥1 grade). */
  latestGradeValues: number[];
  quranEntries: RawQuranEntry[];
  /** Open juz test; the Quran score is frozen at its start date. */
  juzTest: ActiveJuzTest | null;
  attendanceRecords: Pick<RawAttendance, "status">[];
  // Precomputed
  gradeScore: number | null;
  quranResult: QuranScoreResult;
  attRate: number;
  globalPerformance: GlobalPerformanceResult;
  globalScore: number | null;
  globalStatus: GlobalPerformanceResult["status"];
  globalTone: ReturnType<typeof performanceTone>;
};

// ── Helper ───────────────────────────────────────────────────────────────────

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pick the grade with the highest recorded_at for a single course. */
function latestGradeRow(grades: RawGrade[]): RawGrade | null {
  if (grades.length === 0) return null;
  return grades.reduce((best, g) =>
    g.recorded_at > best.recorded_at ? g : best,
  );
}

function latestGradeValue(grades: RawGrade[]): number | null {
  const latest = latestGradeRow(grades);
  return latest ? Number(latest.grade_value) : null;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch every student visible to the current session (RLS applies) together
 * with their courses+grades, quran_progress, and attendance — all in a SINGLE
 * Supabase query via nested .select() relations.
 *
 * Quran and attendance are windowed to the last WINDOW_DAYS days in JS after
 * the query (date filtering on nested tables isn't supported by the JS client).
 *
 * Returns precomputed metric values ready for display.
 */
export async function getAllStudentMetrics(): Promise<StudentMetricsRow[]> {
  const supabase = await createClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - WINDOW_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data, error } = await supabase
    .from("students")
    .select(
      `id, first_name, last_name, grade_level, enrollment_status, schedule_group_id,
       courses(id, name, created_at, start_date, end_date, grades(grade_value, recorded_at, percent_complete, missing_assignments)),
       quran_progress(date, lines_memorized, lesson_type),
       attendance(status, date),
       juz_tests(juz, started_on, finished_on)`,
    )
    .order("last_name", { ascending: true });

  if (error) throw error;

  return (data as unknown as RawStudent[]).map((s) => {
    const latestGradeValues = s.courses
      .map((c) => latestGradeValue(c.grades))
      .filter((v): v is number => v !== null);

    // Only sabaq (new memorization) counts toward the Quran score. On a juz
    // test sabaq pauses, so the score is frozen as of the test's start.
    const juzTest = activeJuzTest(s.juz_tests, new Date().toISOString().slice(0, 10));
    const quranCutoff = juzTest ? shiftDate(juzTest.startedOn, -WINDOW_DAYS) : cutoff;
    const quranEntries = sabaqOnly(s.quran_progress).filter(
      (e) => e.date >= quranCutoff && (!juzTest || e.date < juzTest.startedOn),
    );
    const attendanceRecords = s.attendance
      .filter((a) => a.date >= cutoff)
      .map(({ status }) => ({ status }));

    const gradeScore = avgGradeScore(latestGradeValues);
    const quranResult = quranScore(quranEntries, juzTest?.startedOn);
    const attRate = attendanceRate(attendanceRecords);
    const globalResult = globalPerformance({
      gradeScore,
      quranScore: quranResult.score,
      gradedCourseCount: latestGradeValues.length,
      quranEntryCount: quranEntries.length,
    });
    const globalScore = globalResult.score;
    const globalTone = performanceTone(globalScore);

    return {
      id: s.id,
      name: studentName(s),
      grade_level: s.grade_level,
      enrollment_status: s.enrollment_status,
      courseCount: s.courses.length,
      groupId: s.schedule_group_id,
      courseSnapshots: s.courses.map((course): CourseSnapshot => {
        const latest = latestGradeRow(course.grades);
        return {
          courseId: course.id,
          courseName: course.name,
          createdAt: course.created_at,
          latestRecordedAt: latest?.recorded_at ?? null,
          snapshots: course.grades.map((grade) => ({
            recordedAt: grade.recorded_at,
            grade: Number(grade.grade_value),
          })),
          startDate: course.start_date,
          endDate: course.end_date,
          latestPercent:
            latest?.percent_complete == null ? null : Number(latest.percent_complete),
          latestMissing: latest?.missing_assignments ?? null,
        };
      }),
      latestGradeValues,
      quranEntries,
      juzTest,
      attendanceRecords,
      gradeScore,
      quranResult,
      attRate,
      globalPerformance: globalResult,
      globalScore,
      globalStatus: globalResult.status,
      globalTone,
    };
  });
}
