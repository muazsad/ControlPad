import {
  schoolDaysSince,
  schoolDayWindowEnding,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";

import { isRevision, isSabaq } from "./lessons";

// Pure revision logic for memorized juz. School days are counted with the
// school calendar exactly like the Quran inactivity check (`schoolDaysSince`),
// so breaks and no-school days don't count.

// ── Tunable constants ────────────────────────────────────────────────────────

/** Fallback only; the live value is `settings.revision_overdue_school_days`. */
export const DEFAULT_REVISION_OVERDUE_SCHOOL_DAYS = 21;

/** Past this fraction of the threshold a memorized juz shows as "warning". */
export const REVISION_WARNING_FRACTION = 0.7;

/** "Sabaq without revision": at least this many sabaq entries … */
export const SABAQ_WITHOUT_REVISION_MIN_SABAQ = 3;
/** … in this many most recent school days, with zero revision entries. */
export const SABAQ_WITHOUT_REVISION_WINDOW = 10;

/** The SMS names at most this many juz, then "and N more". */
export const REVISION_SMS_MAX_JUZ = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export type RevisionTone = "success" | "warning" | "danger";

export type QuranLessonEntry = {
  date: string;
  lesson_type?: string | null;
  juz?: number | null;
};

export type MemorizedJuz = { juz: number; markedAt: string };

export type JuzRevisionStatus = {
  juz: number;
  /** Latest sabaq para / dhor date for this juz, or null if never revised. */
  lastRevisionDate: string | null;
  /** The date counted from: last revision, else when it was marked memorized. */
  since: string;
  schoolDaysSince: number;
  overdue: boolean;
  tone: RevisionTone;
};

// ── Per juz ──────────────────────────────────────────────────────────────────

export function revisionTone(schoolDays: number, thresholdSchoolDays: number): RevisionTone {
  if (schoolDays > thresholdSchoolDays) return "danger";
  if (schoolDays > thresholdSchoolDays * REVISION_WARNING_FRACTION) return "warning";
  return "success";
}

/** Revision status for every memorized juz, ascending by juz. */
export function juzRevisionStatuses(input: {
  memorized: MemorizedJuz[];
  entries: QuranLessonEntry[];
  asOfDate: string;
  thresholdSchoolDays: number;
  calendar: SchoolCalendarConfig;
}): JuzRevisionStatus[] {
  const lastRevision = new Map<number, string>();
  for (const entry of input.entries) {
    if (!isRevision(entry) || entry.juz == null) continue;
    const date = entry.date.slice(0, 10);
    if (date > input.asOfDate) continue;
    const current = lastRevision.get(entry.juz);
    if (!current || date > current) lastRevision.set(entry.juz, date);
  }

  return [...input.memorized]
    .sort((a, b) => a.juz - b.juz)
    .map((item) => {
      const lastRevisionDate = lastRevision.get(item.juz) ?? null;
      const since = lastRevisionDate ?? item.markedAt.slice(0, 10);
      const days =
        since >= input.asOfDate ? 0 : schoolDaysSince(since, input.asOfDate, input.calendar);
      return {
        juz: item.juz,
        lastRevisionDate,
        since,
        schoolDaysSince: days,
        overdue: days > input.thresholdSchoolDays,
        tone: revisionTone(days, input.thresholdSchoolDays),
      };
    });
}

export function overdueJuz(statuses: JuzRevisionStatus[]): JuzRevisionStatus[] {
  return statuses.filter((status) => status.overdue);
}

/** Most recent revision date across all juz (for the parent view), or null. */
export function lastRevisionDate(entries: QuranLessonEntry[]): string | null {
  return entries
    .filter(isRevision)
    .map((entry) => entry.date.slice(0, 10))
    .reduce<string | null>((best, date) => (best === null || date > best ? date : best), null);
}

// ── Sabaq without revision ───────────────────────────────────────────────────

export type SabaqWithoutRevision = {
  flagged: boolean;
  sabaqCount: number;
  revisionCount: number;
};

/**
 * Flag a student who keeps memorizing but isn't revising: at least
 * SABAQ_WITHOUT_REVISION_MIN_SABAQ sabaq entries and no revision entries in
 * the last SABAQ_WITHOUT_REVISION_WINDOW school days (ending `asOfDate`).
 */
export function sabaqWithoutRevision(input: {
  entries: QuranLessonEntry[];
  asOfDate: string;
  calendar: SchoolCalendarConfig;
}): SabaqWithoutRevision {
  const window = schoolDayWindowEnding(input.asOfDate, SABAQ_WITHOUT_REVISION_WINDOW, input.calendar);
  const start = window[0] ?? input.asOfDate;
  const inWindow = input.entries.filter((entry) => {
    const date = entry.date.slice(0, 10);
    return date >= start && date <= input.asOfDate;
  });
  const sabaqCount = inWindow.filter(isSabaq).length;
  const revisionCount = inWindow.filter(isRevision).length;
  return {
    flagged: sabaqCount >= SABAQ_WITHOUT_REVISION_MIN_SABAQ && revisionCount === 0,
    sabaqCount,
    revisionCount,
  };
}

// ── SMS text ─────────────────────────────────────────────────────────────────

/** "Juz 3", "Juz 3 and 7", "Juz 3, 7 and 2 more". */
export function formatJuzList(juz: number[], max = REVISION_SMS_MAX_JUZ): string {
  const sorted = [...juz].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length <= max) {
    return sorted.length === 1
      ? `Juz ${sorted[0]}`
      : `Juz ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
  }
  return `Juz ${sorted.slice(0, max).join(", ")} and ${sorted.length - max} more`;
}

export function revisionOverdueMessage(studentName: string, juz: number[]): string {
  const firstName = studentName.trim().split(/\s+/)[0] || "Your child";
  return `Salaam Institute: ${firstName} hasn't revised ${formatJuzList(juz)} in over a month. Please encourage review at home.`;
}
