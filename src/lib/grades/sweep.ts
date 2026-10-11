// Pure logic for the weekly grade sweep. No server or browser imports: the
// client form and the server action both use these functions.

// ── Constants ────────────────────────────────────────────────────────────────

/** A course counts as "updated" if its latest grade is within this many Eastern days (today included). */
export const SWEEP_WINDOW_DAYS = 7;
export const GRADE_MIN = 0;
export const GRADE_MAX = 100;
export const GRADE_MAX_DECIMALS = 1;
/** Upper bound on entries one save will process (there is one per course). */
export const MAX_SWEEP_ENTRIES = 2000;
export const SCHOOL_TIME_ZONE = "America/New_York";

// ── Types ────────────────────────────────────────────────────────────────────

export type SweepInvalidReason =
  | "not_a_number"
  | "too_many_decimals"
  | "out_of_range"
  | "unknown_course"
  | "duplicate";

export type ParsedGradeInput =
  | { status: "blank" }
  | { status: "ok"; value: number }
  | { status: "invalid"; reason: SweepInvalidReason };

export type SweepEntry = { courseId: string; value: string };

/** A course as loaded by the server (never client-supplied). */
export type SweepCourse = {
  id: string;
  studentId: string;
  latestGrade: number | null;
};

export type SweepInsert = {
  courseId: string;
  studentId: string;
  gradeValue: number;
};

export type SweepPlan = {
  toInsert: SweepInsert[];
  skippedUnchanged: number;
  invalid: { courseId: string; reason: SweepInvalidReason }[];
};

// ── Parsing ──────────────────────────────────────────────────────────────────

const NUMERIC_SHAPE = /^(\d*)(?:\.(\d*))?$/;
const TENTHS = 10 ** GRADE_MAX_DECIMALS;

function toTenths(value: number): number {
  return Math.round(value * TENTHS);
}

/** Parse one typed grade. Blank is not an error; it just means "no entry". */
export function parseGradeInput(raw: unknown): ParsedGradeInput {
  if (typeof raw !== "string") {
    return { status: "invalid", reason: "not_a_number" };
  }
  const text = raw.trim();
  if (text === "") return { status: "blank" };

  const match = NUMERIC_SHAPE.exec(text);
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) {
    return { status: "invalid", reason: "not_a_number" };
  }

  const [, whole, fraction = ""] = match;
  if (fraction.length > GRADE_MAX_DECIMALS) {
    return { status: "invalid", reason: "too_many_decimals" };
  }

  const value = Number(`${whole || "0"}.${fraction || "0"}`);
  if (!Number.isFinite(value) || value < GRADE_MIN || value > GRADE_MAX) {
    return { status: "invalid", reason: "out_of_range" };
  }
  return { status: "ok", value: toTenths(value) / TENTHS };
}

// ── Planning ─────────────────────────────────────────────────────────────────

/**
 * Decide what a sweep save should do. `courses` must come from the server.
 * Blank entries are dropped, unchanged grades are skipped (no duplicate
 * snapshot), and everything that can't be saved is reported as invalid.
 */
export function planSweep(
  entries: { courseId: unknown; value: unknown }[],
  courses: SweepCourse[],
): SweepPlan {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const seen = new Set<string>();
  const plan: SweepPlan = { toInsert: [], skippedUnchanged: 0, invalid: [] };

  for (const entry of entries) {
    const parsed = parseGradeInput(entry.value);
    if (parsed.status === "blank") continue;

    const courseId = typeof entry.courseId === "string" ? entry.courseId : "";
    const course = byId.get(courseId);
    if (!course) {
      plan.invalid.push({ courseId, reason: "unknown_course" });
      continue;
    }
    if (seen.has(courseId)) {
      plan.invalid.push({ courseId, reason: "duplicate" });
      continue;
    }
    seen.add(courseId);

    if (parsed.status === "invalid") {
      plan.invalid.push({ courseId, reason: parsed.reason });
      continue;
    }

    if (
      course.latestGrade !== null &&
      toTenths(course.latestGrade) === toTenths(parsed.value)
    ) {
      plan.skippedUnchanged += 1;
      continue;
    }

    plan.toInsert.push({
      courseId,
      studentId: course.studentId,
      gradeValue: parsed.value,
    });
  }

  return plan;
}

// ── Eastern-time window ──────────────────────────────────────────────────────

const easternFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Eastern calendar date as YYYY-MM-DD. */
export function easternDateKey(date: Date): string {
  return easternFormatter.format(date);
}

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** True when `recordedAt` falls on today or the previous SWEEP_WINDOW_DAYS - 1 Eastern days. */
export function isWithinSweepWindow(
  recordedAt: string | null,
  now: Date,
): boolean {
  if (!recordedAt) return false;
  const recorded = new Date(recordedAt);
  if (Number.isNaN(recorded.getTime())) return false;
  const earliest = shiftDateKey(easternDateKey(now), -(SWEEP_WINDOW_DAYS - 1));
  return easternDateKey(recorded) >= earliest;
}
