import type { SchoolCalendarConfig } from "@/lib/schedule/calendar";
import {
  scheduleForDate,
  type DefaultSchedule,
  type ScheduleGroup,
} from "@/lib/schedule/student-schedule";

// Pure pace logic: where a student should be in a course by today versus the
// GCVS % complete staff last recorded. No database access.

// ── Tunable constants ────────────────────────────────────────────────────────

/** A gap (or missing count) at or above this many × the threshold is "danger". */
export const PACE_DANGER_MULTIPLIER = 2;

/** Fallbacks only; the live values come from `settings` (migration defaults match). */
export const DEFAULT_PACE_GAP_THRESHOLD = 10;
export const DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD = 3;

export const PERCENT_COMPLETE_MIN = 0;
export const PERCENT_COMPLETE_MAX = 100;
/** Windows longer than this are treated as a data-entry mistake (no pace shown). */
export const PACE_MAX_WINDOW_DAYS = 800;
export const MISSING_ASSIGNMENTS_MAX = 999;

// ── Types ────────────────────────────────────────────────────────────────────

export type PaceTone = "success" | "warning" | "danger" | "neutral";

export type PaceWindow = { start: string; end: string };

export type TermDates = {
  termStart: string | null;
  termEnd: string | null;
};

export type CourseDates = {
  startDate?: string | null;
  endDate?: string | null;
};

export type CoursePaceEvaluation = {
  window: PaceWindow | null;
  expected: number | null;
  actual: number | null;
  gap: number | null;
  paceTone: PaceTone;
  missing: number | null;
  missingTone: PaceTone;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function utcMs(date: string): number {
  return new Date(`${dateOnly(date)}T00:00:00.000Z`).getTime();
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// ── Window & expected pace ───────────────────────────────────────────────────

/** The course's own dates if both are set, else the term dates, else null. */
export function courseWindow(
  course: CourseDates,
  settings: TermDates,
): PaceWindow | null {
  const candidates: [string | null | undefined, string | null | undefined][] = [
    [course.startDate, course.endDate],
    [settings.termStart, settings.termEnd],
  ];
  for (const [start, end] of candidates) {
    if (!start || !end) continue;
    const window = { start: dateOnly(start), end: dateOnly(end) };
    const days = (utcMs(window.end) - utcMs(window.start)) / MS_PER_DAY + 1;
    if (!(days >= 1 && days <= PACE_MAX_WINDOW_DAYS)) return null;
    return window;
  }
  return null;
}

/** Whether a student is expected on a date, per their schedule group and the calendar. */
export function expectedDayPredicate(
  group: ScheduleGroup | null,
  calendar: SchoolCalendarConfig,
  defaults: DefaultSchedule,
): (date: string) => boolean {
  return (date) => scheduleForDate(date, group, calendar, defaults) !== null;
}

/**
 * Percent of the window's expected school days that have elapsed by `today`
 * (today included), 0–100. Uses the student's own expected days, so breaks and
 * closed days don't inflate the pace. Null when there is no usable window or
 * the window contains no expected days.
 */
export function expectedPercent(
  window: PaceWindow | null,
  today: string,
  isExpectedDay: (date: string) => boolean,
): number | null {
  if (!window) return null;
  const todayMs = utcMs(today);
  let total = 0;
  let elapsed = 0;
  for (let ms = utcMs(window.start); ms <= utcMs(window.end); ms += MS_PER_DAY) {
    if (!isExpectedDay(new Date(ms).toISOString().slice(0, 10))) continue;
    total += 1;
    if (ms <= todayMs) elapsed += 1;
  }
  if (total === 0) return null;
  return Math.min(PERCENT_COMPLETE_MAX, Math.max(PERCENT_COMPLETE_MIN, (elapsed / total) * 100));
}

/** Points behind (positive) or ahead (negative), to one decimal. Null if either side is missing. */
export function paceGap(
  expected: number | null,
  actual: number | null,
): number | null {
  if (expected === null || actual === null) return null;
  return roundTenth(expected - actual);
}

function thresholdTone(value: number | null, threshold: number): PaceTone {
  if (value === null) return "neutral";
  if (value >= threshold * PACE_DANGER_MULTIPLIER) return "danger";
  if (value >= threshold) return "warning";
  return "success";
}

/** Neutral without data; success below the threshold; warning at it; danger at 2× it. */
export function paceTone(gap: number | null, threshold: number): PaceTone {
  return thresholdTone(gap, threshold);
}

/** Same bands as `paceTone`, applied to the missing-assignment count. */
export function missingTone(missing: number | null, threshold: number): PaceTone {
  return thresholdTone(missing, threshold);
}

// ── One course, end to end ───────────────────────────────────────────────────

export function evaluateCoursePace(input: {
  course: CourseDates;
  term: TermDates;
  today: string;
  isExpectedDay: (date: string) => boolean;
  latest: { percentComplete: number | null; missingAssignments: number | null } | null;
  paceGapThreshold: number;
  missingAssignmentsThreshold: number;
}): CoursePaceEvaluation {
  const window = courseWindow(input.course, input.term);
  const expected = expectedPercent(window, input.today, input.isExpectedDay);
  const actual = input.latest?.percentComplete ?? null;
  const gap = paceGap(expected, actual);
  const missing = input.latest?.missingAssignments ?? null;
  return {
    window,
    expected,
    actual,
    gap,
    paceTone: paceTone(gap, input.paceGapThreshold),
    missing,
    missingTone: missingTone(missing, input.missingAssignmentsThreshold),
  };
}

// ── Shared context ───────────────────────────────────────────────────────────

/** Everything needed to evaluate pace for many courses without more queries. */
export type PaceContext = {
  term: TermDates;
  paceGapThreshold: number;
  missingAssignmentsThreshold: number;
  /** School days without a snapshot before a course is stale (see staleness.ts). */
  staleGradeSchoolDays: number;
  calendar: SchoolCalendarConfig;
  groups: Map<string, ScheduleGroup>;
  defaults: DefaultSchedule;
};

export type LatestPaceSnapshot = {
  percentComplete: number | null;
  missingAssignments: number | null;
};

/** Evaluate one course for a student in `groupId` (null = no schedule group). */
export function paceForCourse(
  context: PaceContext,
  today: string,
  groupId: string | null,
  course: CourseDates,
  latest: LatestPaceSnapshot | null,
): CoursePaceEvaluation {
  const group = groupId ? (context.groups.get(groupId) ?? null) : null;
  return evaluateCoursePace({
    course,
    term: context.term,
    today,
    isExpectedDay: expectedDayPredicate(group, context.calendar, context.defaults),
    latest,
    paceGapThreshold: context.paceGapThreshold,
    missingAssignmentsThreshold: context.missingAssignmentsThreshold,
  });
}

/** The most severe tone in a list (danger > warning > success > neutral). */
export function worstTone(tones: PaceTone[]): PaceTone {
  for (const tone of ["danger", "warning", "success"] as const) {
    if (tones.includes(tone)) return tone;
  }
  return "neutral";
}

// ── ISO week (alert dedupe keys) ─────────────────────────────────────────────

/** ISO 8601 week as "YYYY-Www" for a YYYY-MM-DD date. */
export function isoWeekKey(date: string): string {
  const d = new Date(utcMs(date));
  const weekday = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
