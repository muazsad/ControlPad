// ── Tunable constants ────────────────────────────────────────────────────────

/** Minimum entries required before classifying a memorization pattern. */
export const MIN_ENTRIES_FOR_PATTERN = 2;

/** Days without a new entry before the pattern is considered stagnant. */
export const STAGNANT_INACTIVE_DAYS = 7;

/** Window size used to compare recent memorization pace against prior pace. */
export const RATE_WINDOW_DAYS = 28;

/** Recent pace must exceed prior pace by this ratio to count as accelerating. */
export const ACCELERATION_RATE_RATIO = 1.25;

/** Gap coefficient of variation at or above this value is considered irregular. */
export const IRREGULAR_GAP_CV = 0.5;

/** Line-count coefficient of variation below this value is considered steady. */
export const STEADY_LINES_CV = 0.35;

// ── Types ────────────────────────────────────────────────────────────────────

export type QuranProgressEntry = {
  date: string;
  lines_memorized: number;
};

export type QuranProgressPoint = {
  date: string;
  linesThisEntry: number;
  cumulativeLines: number;
};

export type QuranPattern = "consistent" | "accelerating" | "irregular" | "stagnant";

export type GapStats = {
  gaps: number[];
  averageDays: number | null;
  coefficientOfVariation: number | null;
};

export type QuranPatternResult =
  | {
      status: "insufficient_data";
      pattern: null;
      description: string;
      recentLinesPerWeek: null;
      priorLinesPerWeek: null;
      daysSinceLastEntry: number | null;
      gapStats: GapStats;
    }
  | {
      status: "classified";
      pattern: QuranPattern;
      description: string;
      recentLinesPerWeek: number;
      priorLinesPerWeek: number;
      daysSinceLastEntry: number;
      gapStats: GapStats;
    };

export type QuranProgressSummary = {
  series: QuranProgressPoint[];
  pattern: QuranPatternResult;
};

export type QuranProgressOptions = {
  referenceDate?: string | Date;
};

// ── Utilities ────────────────────────────────────────────────────────────────

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function dateMs(date: string): number {
  return new Date(`${dateOnly(date)}T00:00:00.000Z`).getTime();
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((dateMs(endDate) - dateMs(startDate)) / (1000 * 60 * 60 * 24));
}

function daysBefore(referenceDate: string, days: number): string {
  const d = new Date(`${dateOnly(referenceDate)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number | null {
  const mean = average(values);
  if (mean === null || mean === 0) return null;

  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function linesPerWeek(
  entries: QuranProgressPoint[],
  fromDate: string,
  toDate: string,
): number {
  const total = entries
    .filter((entry) => entry.date >= fromDate && entry.date < toDate)
    .reduce((sum, entry) => sum + entry.linesThisEntry, 0);

  return roundOne((total / RATE_WINDOW_DAYS) * 7);
}

function gapStats(series: QuranProgressPoint[]): GapStats {
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    gaps.push(daysBetween(series[i - 1].date, series[i].date));
  }

  return {
    gaps,
    averageDays: average(gaps),
    coefficientOfVariation: coefficientOfVariation(gaps),
  };
}

function buildSeries(entries: QuranProgressEntry[]): QuranProgressPoint[] {
  const sorted = [...entries].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return Number(a.lines_memorized) - Number(b.lines_memorized);
  });

  let running = 0;
  return sorted.map((entry) => {
    const linesThisEntry = Number(entry.lines_memorized);
    running += linesThisEntry;
    return {
      date: dateOnly(entry.date),
      linesThisEntry,
      cumulativeLines: running,
    };
  });
}

// ── Public functions ─────────────────────────────────────────────────────────

export function summarizeQuranProgress(
  entries: QuranProgressEntry[],
  options: QuranProgressOptions = {},
): QuranProgressSummary {
  const series = buildSeries(entries);
  const referenceDate = dateOnly(options.referenceDate ?? new Date());
  const stats = gapStats(series);
  const lastEntry = series.at(-1) ?? null;
  const daysSinceLastEntry = lastEntry
    ? daysBetween(lastEntry.date, referenceDate)
    : null;

  const recentStart = daysBefore(referenceDate, RATE_WINDOW_DAYS);
  const priorStart = daysBefore(recentStart, RATE_WINDOW_DAYS);
  const recentLinesPerWeek = linesPerWeek(series, recentStart, referenceDate);
  const priorLinesPerWeek = linesPerWeek(series, priorStart, recentStart);

  if (series.length < MIN_ENTRIES_FOR_PATTERN) {
    return {
      series,
      pattern: {
        status: "insufficient_data",
        pattern: null,
        description: "Not enough data to chart a trend yet.",
        recentLinesPerWeek: null,
        priorLinesPerWeek: null,
        daysSinceLastEntry,
        gapStats: stats,
      },
    };
  }

  if (
    daysSinceLastEntry !== null &&
    daysSinceLastEntry >= STAGNANT_INACTIVE_DAYS
  ) {
    return {
      series,
      pattern: {
        status: "classified",
        pattern: "stagnant",
        description: `No new lesson has been logged for ${daysSinceLastEntry} days.`,
        recentLinesPerWeek,
        priorLinesPerWeek,
        daysSinceLastEntry,
        gapStats: stats,
      },
    };
  }

  if (
    priorLinesPerWeek > 0 &&
    recentLinesPerWeek > priorLinesPerWeek * ACCELERATION_RATE_RATIO
  ) {
    return {
      series,
      pattern: {
        status: "classified",
        pattern: "accelerating",
        description: `Recent pace is ${recentLinesPerWeek} lines/week, up from ${priorLinesPerWeek}.`,
        recentLinesPerWeek,
        priorLinesPerWeek,
        daysSinceLastEntry: daysSinceLastEntry ?? 0,
        gapStats: stats,
      },
    };
  }

  const gapCv = stats.coefficientOfVariation;
  const lineCv = coefficientOfVariation(series.map((entry) => entry.linesThisEntry));
  const isRegular = gapCv !== null && gapCv < IRREGULAR_GAP_CV;
  const hasSteadyLines = lineCv !== null && lineCv < STEADY_LINES_CV;

  if (isRegular && hasSteadyLines) {
    return {
      series,
      pattern: {
        status: "classified",
        pattern: "consistent",
        description: `Lessons are landing about every ${roundOne(stats.averageDays ?? 0)} days.`,
        recentLinesPerWeek,
        priorLinesPerWeek,
        daysSinceLastEntry: daysSinceLastEntry ?? 0,
        gapStats: stats,
      },
    };
  }

  return {
    series,
    pattern: {
      status: "classified",
      pattern: "irregular",
      description: "Lesson spacing varies enough to make the trend uneven.",
      recentLinesPerWeek,
      priorLinesPerWeek,
      daysSinceLastEntry: daysSinceLastEntry ?? 0,
      gapStats: stats,
    },
  };
}
