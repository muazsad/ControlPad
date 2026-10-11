import { easternDateKey } from "@/lib/grades/sweep";

// Pure staleness logic: has a course's grade data gone without an update for
// too many of the student's own school days? No database access.

// ── Tunable constants ────────────────────────────────────────────────────────

/** Fallback only; the live value is `settings.stale_grade_school_days`. */
export const DEFAULT_STALE_GRADE_SCHOOL_DAYS = 10;

/** Never count further back than this many calendar days (keeps loops bounded). */
export const STALENESS_MAX_LOOKBACK_DAYS = 400;

// ── Types ────────────────────────────────────────────────────────────────────

export type StalenessStatus = "fresh" | "stale" | "never";

export type CourseStaleness = {
  status: StalenessStatus;
  /**
   * Expected school days since the latest snapshot, or since the course was
   * created when it has never been graded. Null if neither date is known.
   */
  schoolDaysSince: number | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcMs(date: string): number {
  return new Date(`${date.slice(0, 10)}T00:00:00.000Z`).getTime();
}

/** A YYYY-MM-DD string is kept; anything with a time is converted to its Eastern date. */
function toDateKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : easternDateKey(new Date(value));
}

/** Expected school days in (from, to]: the day after `from` through `to`. */
export function schoolDaysBetween(
  from: string,
  to: string,
  isExpectedDay: (date: string) => boolean,
): number {
  const end = utcMs(to);
  const earliest = end - STALENESS_MAX_LOOKBACK_DAYS * MS_PER_DAY;
  let count = 0;
  for (let ms = Math.max(utcMs(from), earliest) + MS_PER_DAY; ms <= end; ms += MS_PER_DAY) {
    if (isExpectedDay(new Date(ms).toISOString().slice(0, 10))) count += 1;
  }
  return count;
}

// ── Public function ──────────────────────────────────────────────────────────

/**
 * - fresh:  latest snapshot is within `thresholdSchoolDays` school days (or the
 *           course is too new to have been graded yet).
 * - stale:  latest snapshot is MORE than the threshold of school days old.
 * - never:  no snapshot at all and the course was created more than the
 *           threshold ago.
 * School days are the student's own (`isExpectedDay`), so breaks and
 * no-school days don't count.
 */
export function courseStaleness(input: {
  latestRecordedAt: string | null;
  createdAt: string | null;
  today: string;
  thresholdSchoolDays: number;
  isExpectedDay: (date: string) => boolean;
}): CourseStaleness {
  const since = input.latestRecordedAt ?? input.createdAt;
  if (!since) return { status: "fresh", schoolDaysSince: null };

  const schoolDaysSince = schoolDaysBetween(
    toDateKey(since),
    input.today,
    input.isExpectedDay,
  );
  if (schoolDaysSince <= input.thresholdSchoolDays) {
    return { status: "fresh", schoolDaysSince };
  }
  return {
    status: input.latestRecordedAt ? "stale" : "never",
    schoolDaysSince,
  };
}

/** Human text for a tooltip, e.g. "Biology: no update in 12 school days". */
export function staleDescription(
  courseName: string,
  staleness: CourseStaleness,
): string {
  const days = staleness.schoolDaysSince;
  if (staleness.status === "never") {
    return `${courseName}: never graded${days === null ? "" : ` (added ${days} school days ago)`}`;
  }
  return `${courseName}: no update in ${days ?? "many"} school day${days === 1 ? "" : "s"}`;
}
