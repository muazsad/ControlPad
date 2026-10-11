// Pure logic for the weekly grade sweep. No server or browser imports: the
// client form and the server action both use these functions.

// ── Constants ────────────────────────────────────────────────────────────────

/** A course counts as "updated" if its latest grade is within this many Eastern days (today included). */
export const SWEEP_WINDOW_DAYS = 7;
export const GRADE_MIN = 0;
export const GRADE_MAX = 100;
export const GRADE_MAX_DECIMALS = 1;
/** % complete uses the same 0–100, one-decimal rules as a grade. */
export const MISSING_MIN = 0;
export const MISSING_MAX = 999;
/** Upper bound on entries one save will process (there is one per course). */
export const MAX_SWEEP_ENTRIES = 2000;
export const SCHOOL_TIME_ZONE = "America/New_York";

// ── Types ────────────────────────────────────────────────────────────────────

export type SweepInvalidReason =
  | "not_a_number"
  | "too_many_decimals"
  | "out_of_range"
  | "not_a_whole_number"
  | "grade_required"
  | "unknown_course"
  | "duplicate";

export type SweepField = "grade" | "percent" | "missing";

export type ParsedGradeInput =
  | { status: "blank" }
  | { status: "ok"; value: number }
  | { status: "invalid"; reason: SweepInvalidReason };

/** What the browser sends per course: three typed strings (blank = leave alone). */
export type SweepEntry = {
  courseId: string;
  /** Current grade. */
  value: string;
  /** GCVS % complete. */
  percent?: string;
  /** Missing assignments. */
  missing?: string;
};

/** A course as loaded by the server (never client-supplied). */
export type SweepCourse = {
  id: string;
  studentId: string;
  latestGrade: number | null;
  latestPercentComplete?: number | null;
  latestMissing?: number | null;
};

export type SweepInsert = {
  courseId: string;
  studentId: string;
  /** The grade to store: typed, or carried forward from the latest snapshot. */
  gradeValue: number;
  /** Typed, or carried forward; null only if never recorded. */
  percentComplete: number | null;
  missingAssignments: number | null;
  /** The grade value itself differs from the latest snapshot (drives the low-grade alert). */
  gradeChanged: boolean;
  percentChanged: boolean;
  missingChanged: boolean;
};

export type SweepInvalid = {
  courseId: string;
  reason: SweepInvalidReason;
  field: SweepField;
};

export type SweepPlan = {
  toInsert: SweepInsert[];
  skippedUnchanged: number;
  invalid: SweepInvalid[];
};

export type ParsedMissingInput =
  | { status: "blank" }
  | { status: "ok"; value: number }
  | { status: "invalid"; reason: SweepInvalidReason };

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

/** Parse a missing-assignments count: blank, or a whole number 0–999. */
export function parseMissingInput(raw: unknown): ParsedMissingInput {
  if (typeof raw !== "string") {
    return { status: "invalid", reason: "not_a_number" };
  }
  const text = raw.trim();
  if (text === "") return { status: "blank" };
  if (!/^\d+$/.test(text)) {
    return {
      status: "invalid",
      reason: /^\d*\.\d*$/.test(text) && text !== "." ? "not_a_whole_number" : "not_a_number",
    };
  }
  const value = Number(text);
  if (value < MISSING_MIN || value > MISSING_MAX) {
    return { status: "invalid", reason: "out_of_range" };
  }
  return { status: "ok", value };
}

// ── Planning ─────────────────────────────────────────────────────────────────

/**
 * Decide what a sweep save should do. `courses` must come from the server.
 *
 * Per course there are three optional fields (grade, % complete, missing).
 * Blank fields mean "leave alone" and carry the latest known value forward, so
 * history is never nulled out. If no typed field differs from the latest
 * snapshot, nothing is inserted (no duplicate snapshot); otherwise exactly one
 * snapshot is. A grade is required to insert, since `grades.grade_value` is
 * NOT NULL: a course with no previous grade needs one typed.
 */
export function planSweep(
  entries: {
    courseId: unknown;
    value: unknown;
    percent?: unknown;
    missing?: unknown;
  }[],
  courses: SweepCourse[],
): SweepPlan {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const seen = new Set<string>();
  const plan: SweepPlan = { toInsert: [], skippedUnchanged: 0, invalid: [] };

  for (const entry of entries) {
    const grade = parseGradeInput(entry.value);
    const percent = parseGradeInput(entry.percent ?? "");
    const missing = parseMissingInput(entry.missing ?? "");
    if (
      grade.status === "blank" &&
      percent.status === "blank" &&
      missing.status === "blank"
    ) {
      continue;
    }

    const courseId = typeof entry.courseId === "string" ? entry.courseId : "";
    const course = byId.get(courseId);
    if (!course) {
      plan.invalid.push({ courseId, reason: "unknown_course", field: "grade" });
      continue;
    }
    if (seen.has(courseId)) {
      plan.invalid.push({ courseId, reason: "duplicate", field: "grade" });
      continue;
    }
    seen.add(courseId);

    const bad =
      grade.status === "invalid"
        ? ({ reason: grade.reason, field: "grade" } as const)
        : percent.status === "invalid"
          ? ({ reason: percent.reason, field: "percent" } as const)
          : missing.status === "invalid"
            ? ({ reason: missing.reason, field: "missing" } as const)
            : null;
    if (bad) {
      plan.invalid.push({ courseId, ...bad });
      continue;
    }

    const latestPercent = course.latestPercentComplete ?? null;
    const latestMissing = course.latestMissing ?? null;

    const gradeChanged =
      grade.status === "ok" &&
      (course.latestGrade === null ||
        toTenths(course.latestGrade) !== toTenths(grade.value));
    const percentChanged =
      percent.status === "ok" &&
      (latestPercent === null || toTenths(latestPercent) !== toTenths(percent.value));
    const missingChanged =
      missing.status === "ok" && latestMissing !== missing.value;

    if (!gradeChanged && !percentChanged && !missingChanged) {
      plan.skippedUnchanged += 1;
      continue;
    }

    const gradeValue = grade.status === "ok" ? grade.value : course.latestGrade;
    if (gradeValue === null) {
      plan.invalid.push({ courseId, reason: "grade_required", field: "grade" });
      continue;
    }

    plan.toInsert.push({
      courseId,
      studentId: course.studentId,
      gradeValue,
      percentComplete: percent.status === "ok" ? percent.value : latestPercent,
      missingAssignments: missing.status === "ok" ? missing.value : latestMissing,
      gradeChanged,
      percentChanged,
      missingChanged,
    });
  }

  return plan;
}

/**
 * Carry-forward for a single manual snapshot (the course and profile forms):
 * blank pace fields keep the latest known values. The grade is always typed.
 */
export function carryForward(
  latest: { percentComplete: number | null; missingAssignments: number | null } | null,
  typed: { percentComplete: number | null; missingAssignments: number | null },
): { percentComplete: number | null; missingAssignments: number | null } {
  return {
    percentComplete: typed.percentComplete ?? latest?.percentComplete ?? null,
    missingAssignments: typed.missingAssignments ?? latest?.missingAssignments ?? null,
  };
}

/** A short, plain message for the first invalid field. */
export function invalidMessage(field: SweepField, reason: SweepInvalidReason): string {
  const label =
    field === "grade" ? "Grade" : field === "percent" ? "% complete" : "Missing assignments";
  switch (reason) {
    case "too_many_decimals":
      return `${label}: use at most ${GRADE_MAX_DECIMALS} decimal place.`;
    case "out_of_range":
      return field === "missing"
        ? `${label}: enter ${MISSING_MIN}–${MISSING_MAX}.`
        : `${label}: enter ${GRADE_MIN}–${GRADE_MAX}.`;
    case "not_a_whole_number":
      return `${label}: enter a whole number.`;
    case "grade_required":
      return "Enter a grade: this course has none recorded yet.";
    case "unknown_course":
      return "That course could not be found.";
    case "duplicate":
      return "That course was entered twice.";
    default:
      return `${label}: enter a number.`;
  }
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
