// ── Tunable constants ────────────────────────────────────────────────────────

/** Days in the "recent" Quran window used for trend comparison. */
const QURAN_RECENT_WINDOW_DAYS = 14;

/** Days in the "prior" Quran window used for trend comparison. */
const QURAN_PRIOR_WINDOW_DAYS = 14;

/**
 * Score thresholds for performanceTone().
 * ≥ SUCCESS_THRESHOLD → 'success'
 * ≥ WARNING_THRESHOLD → 'warning'
 * <  WARNING_THRESHOLD → 'danger'
 * null → 'neutral'
 */
const PERFORMANCE_SUCCESS_THRESHOLD = 75;
const PERFORMANCE_WARNING_THRESHOLD = 50;

// ── Types ────────────────────────────────────────────────────────────────────

export type QuranTrend = 'improving' | 'steady' | 'slowing' | 'stalled';

export type QuranScoreResult = {
  score: number;
  trend: QuranTrend;
};

export type CompositeWeights = {
  grades: number;
  quran: number;
  attendance: number;
};

// ── Utilities ────────────────────────────────────────────────────────────────

function daysBefore(referenceIso: string, days: number): Date {
  const d = new Date(referenceIso);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function sumLines(
  entries: { date: string; lines_memorized: number }[],
  from: Date,
  to: Date,
): number {
  return entries
    .filter((e) => {
      const d = new Date(e.date);
      return d >= from && d < to;
    })
    .reduce((acc, e) => acc + e.lines_memorized, 0);
}

// ── Public functions ─────────────────────────────────────────────────────────

/**
 * Average of the latest grade score per course.
 * Returns null when no courses have been graded.
 */
export function avgGradeScore(latestGradePerCourse: number[]): number | null {
  if (latestGradePerCourse.length === 0) return null;
  const total = latestGradePerCourse.reduce((acc, g) => acc + g, 0);
  return total / latestGradePerCourse.length;
}

/**
 * Summarises recent Quran activity as a 0–100 score and a trend label.
 *
 * Windows are evaluated relative to today (UTC):
 *   recent  = last QURAN_RECENT_WINDOW_DAYS days
 *   prior   = the QURAN_PRIOR_WINDOW_DAYS days immediately before that
 *
 * Score mapping:
 *   improving (recent > prior)  → 90
 *   steady    (recent === prior, both > 0) → 70
 *   slowing   (recent < prior, recent > 0) → 40
 *   stalled   (no lines in recent window)  → 10
 */
export function quranScore(
  entries: { date: string; lines_memorized: number }[],
): QuranScoreResult {
  const now = new Date().toISOString();
  const recentEnd = new Date(now);
  const recentStart = daysBefore(now, QURAN_RECENT_WINDOW_DAYS);
  const priorEnd = recentStart;
  const priorStart = daysBefore(recentStart.toISOString(), QURAN_PRIOR_WINDOW_DAYS);

  const recentLines = sumLines(entries, recentStart, recentEnd);
  const priorLines = sumLines(entries, priorStart, priorEnd);

  if (recentLines === 0) {
    return { score: 10, trend: 'stalled' };
  }
  if (recentLines > priorLines) {
    return { score: 90, trend: 'improving' };
  }
  if (recentLines === priorLines) {
    return { score: 70, trend: 'steady' };
  }
  return { score: 40, trend: 'slowing' };
}

/**
 * Percentage of sessions marked present or excused.
 * Returns 0 when the record list is empty.
 * Used by the leaderboard only.
 */
export function attendanceRate(
  records: { status: 'present' | 'tardy' | 'absent' | 'excused' }[],
): number {
  if (records.length === 0) return 0;
  const counted = records.filter(
    (r) => r.status === 'present' || r.status === 'excused',
  ).length;
  return (counted / records.length) * 100;
}

/**
 * Primary performance metric shown across all student tabs.
 * Equal-weight average of gradeScore (0–100) and quranScore (0–100).
 * Attendance is intentionally excluded here.
 * Returns null when both inputs are null (no data at all).
 */
export function globalPerformance(
  gradeScore: number | null,
  qScore: number | null,
): number | null {
  if (gradeScore === null && qScore === null) return null;
  if (gradeScore === null) return qScore;
  if (qScore === null) return gradeScore;
  return (gradeScore + qScore) / 2;
}

/**
 * Weighted blend of grades, quran, and attendance scores.
 * Weights are normalised to sum to 1 before blending.
 * Null inputs are excluded from both numerator and denominator.
 * Used only by the Top Performers leaderboard.
 *
 * @returns 0–100 blended score, or null if all inputs are null.
 */
export function compositeScore(
  weights: CompositeWeights,
  g: number | null,
  q: number | null,
  a: number | null,
): number | null {
  const pairs: [number | null, number][] = [
    [g, weights.grades],
    [q, weights.quran],
    [a, weights.attendance],
  ];

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [value, weight] of pairs) {
    if (value !== null && weight > 0) {
      weightedSum += value * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

/**
 * Maps a 0–100 score to a StatusBadge-compatible tone.
 *
 * ≥ 75  → 'success'
 * ≥ 50  → 'warning'
 * <  50  → 'danger'
 * null  → 'neutral'
 */
export function performanceTone(
  score: number | null,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score === null) return 'neutral';
  if (score >= PERFORMANCE_SUCCESS_THRESHOLD) return 'success';
  if (score >= PERFORMANCE_WARNING_THRESHOLD) return 'warning';
  return 'danger';
}
