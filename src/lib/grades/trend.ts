import { easternDateKey } from "@/lib/grades/sweep";

// Pure grade-trend logic: how far has a course's grade moved over a recent
// window? This is a view (ranking / sparkline), not an alert.

// ── Tunable constants ────────────────────────────────────────────────────────

/** Calendar days looked back for a trend. */
export const TREND_WINDOW_DAYS = 14;

/** A change at or below this many points is "danger" (a drop of 10+). */
export const TREND_DANGER_CHANGE = -10;

/** How many students the dashboard's "Biggest drops" card shows. */
export const TREND_DASHBOARD_TOP_COUNT = 5;

// ── Types ────────────────────────────────────────────────────────────────────

export type TrendSnapshot = { recordedAt: string; grade: number };

export type GradeTrend = {
  baseline: number;
  baselineDate: string;
  latest: number;
  latestDate: string;
  /** latest − baseline; negative means the grade fell. */
  change: number;
  /** Grades from the baseline through the latest, oldest first (for a sparkline). */
  points: number[];
};

export type TrendTone = "danger" | "warning" | "success" | "neutral";

export type CourseTrend = { courseName: string; trend: GradeTrend | null };

export type StudentTrend = {
  /** The course with the most negative change (ties: first listed), if any course has a trend. */
  worst: { courseName: string; trend: GradeTrend } | null;
  /** Mean change across the courses that have a trend, to one decimal. */
  averageChange: number | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// ── Public functions ─────────────────────────────────────────────────────────

/**
 * change = latest − baseline.
 * - baseline: the latest snapshot on or before (today − windowDays);
 * - if none, the earliest snapshot inside the window, but only when the window
 *   holds at least 2 snapshots;
 * - otherwise null.
 * Snapshots after `today` are ignored. A lone snapshot older than the window is
 * its own baseline, so its change is 0.
 */
export function gradeTrend(
  snapshots: TrendSnapshot[],
  today: string,
  windowDays: number = TREND_WINDOW_DAYS,
): GradeTrend | null {
  const dated = snapshots
    .map((snapshot) => ({
      grade: snapshot.grade,
      at: snapshot.recordedAt,
      date: easternDateKey(new Date(snapshot.recordedAt)),
    }))
    .filter((snapshot) => snapshot.date <= today)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (dated.length === 0) return null;

  const cutoff = shiftDate(today, -windowDays);
  const before = dated.filter((snapshot) => snapshot.date <= cutoff);
  const inWindow = dated.filter((snapshot) => snapshot.date > cutoff);

  let baseline: (typeof dated)[number];
  if (before.length > 0) {
    baseline = before[before.length - 1];
  } else if (inWindow.length >= 2) {
    baseline = inWindow[0];
  } else {
    return null;
  }

  const latest = dated[dated.length - 1];
  const series = dated.slice(dated.indexOf(baseline));
  return {
    baseline: baseline.grade,
    baselineDate: baseline.date,
    latest: latest.grade,
    latestDate: latest.date,
    change: roundTenth(latest.grade - baseline.grade),
    points: series.map((snapshot) => snapshot.grade),
  };
}

/** Danger at or below `TREND_DANGER_CHANGE`, warning for any other drop, success when flat or up. */
export function trendTone(change: number | null): TrendTone {
  if (change === null) return "neutral";
  if (change <= TREND_DANGER_CHANGE) return "danger";
  if (change < 0) return "warning";
  return "success";
}

/** Worst course change plus the average change across courses that have a trend. */
export function studentTrend(courses: CourseTrend[]): StudentTrend {
  const withTrend = courses.filter(
    (course): course is { courseName: string; trend: GradeTrend } =>
      course.trend !== null,
  );
  if (withTrend.length === 0) return { worst: null, averageChange: null };

  const worst = withTrend.reduce((best, course) =>
    course.trend.change < best.trend.change ? course : best,
  );
  const total = withTrend.reduce((sum, course) => sum + course.trend.change, 0);
  return { worst, averageChange: roundTenth(total / withTrend.length) };
}
