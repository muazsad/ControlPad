// Quran lesson types and the "only sabaq counts as memorization" rule.
// Pure: no database access.

export const QURAN_LESSON_TYPES = ["sabaq", "sabaq_para", "dhor"] as const;
export type QuranLessonType = (typeof QURAN_LESSON_TYPES)[number];

/** Revision lesson types (never added to memorized totals). */
export const REVISION_LESSON_TYPES: readonly QuranLessonType[] = ["sabaq_para", "dhor"];

export const QURAN_LESSON_LABELS: Record<QuranLessonType, string> = {
  sabaq: "Sabaq",
  sabaq_para: "Sabaq para",
  dhor: "Dhor",
};

export const JUZ_MIN = 1;
export const JUZ_MAX = 30;

/**
 * Revision pages are counted within the juz (page 1 = its first page), so any
 * mushaf printing works. 30 covers the longer 13-line printings.
 */
export const JUZ_PAGE_MIN = 1;
export const JUZ_PAGE_MAX = 30;

/** Rows saved before lesson types existed have no value; they are sabaq. */
export function lessonTypeOf(entry: { lesson_type?: string | null }): QuranLessonType {
  const value = entry.lesson_type;
  return value === "sabaq_para" || value === "dhor" ? value : "sabaq";
}

export function isSabaq(entry: { lesson_type?: string | null }): boolean {
  return lessonTypeOf(entry) === "sabaq";
}

export function isRevision(entry: { lesson_type?: string | null }): boolean {
  return !isSabaq(entry);
}

/** Only sabaq entries: use before any memorization total, score, or slip check. */
export function sabaqOnly<T extends { lesson_type?: string | null }>(entries: T[]): T[] {
  return entries.filter(isSabaq);
}

/** Memorized lines = the sum of raw sabaq entries (cumulative_lines is not used). */
export function sabaqTotalLines(
  entries: { lesson_type?: string | null; lines_memorized: number | string }[],
): number {
  return sabaqOnly(entries).reduce((sum, entry) => sum + Number(entry.lines_memorized), 0);
}

export type JuzParseResult = { ok: true; juz: number[] } | { ok: false; error: string };

/**
 * Parse one or more juz numbers typed as "3", "3, 7" or "3 7 12".
 * Blank → empty list. Duplicates are removed; order is ascending.
 */
export function parseJuzList(raw: string): JuzParseResult {
  const text = raw.trim();
  if (text === "") return { ok: true, juz: [] };
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const juz = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { ok: false, error: `"${part}" is not a juz number.` };
    }
    const value = Number(part);
    if (value < JUZ_MIN || value > JUZ_MAX) {
      return { ok: false, error: `Juz must be ${JUZ_MIN}–${JUZ_MAX} (got ${value}).` };
    }
    juz.add(value);
  }
  return { ok: true, juz: [...juz].sort((a, b) => a - b) };
}

/** One revised section: a juz and the pages within it. */
export type JuzPages = { juz: number; fromPage: number; toPage: number };

export type JuzPagesParseResult = { ok: true; entries: JuzPages[] } | { ok: false; error: string };

/**
 * Parse revised sections typed as "3: 1-5" or "3: 1-5, 7: 10-20" (a single
 * page is "3: 4"). Every juz needs its pages. Blank → empty list. Sorted by
 * juz, then first page.
 */
export function parseJuzPages(raw: string): JuzPagesParseResult {
  const text = raw.trim();
  if (text === "") return { ok: true, entries: [] };
  const entries: JuzPages[] = [];
  for (const part of text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      return { ok: false, error: `Add the pages for juz ${Number(part)}, e.g. "${Number(part)}: 1-5".` };
    }
    const match = /^(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!match) return { ok: false, error: `"${part}" should look like "3: 1-5" (juz: pages).` };
    const juz = Number(match[1]);
    const fromPage = Number(match[2]);
    const toPage = match[3] === undefined ? fromPage : Number(match[3]);
    if (juz < JUZ_MIN || juz > JUZ_MAX) {
      return { ok: false, error: `Juz must be ${JUZ_MIN}–${JUZ_MAX} (got ${juz}).` };
    }
    if (fromPage < JUZ_PAGE_MIN || toPage > JUZ_PAGE_MAX) {
      return { ok: false, error: `Juz ${juz}: pages must be ${JUZ_PAGE_MIN}–${JUZ_PAGE_MAX}.` };
    }
    if (toPage < fromPage) {
      return { ok: false, error: `Juz ${juz}: page ${fromPage} comes after page ${toPage}.` };
    }
    entries.push({ juz, fromPage, toPage });
  }
  entries.sort((a, b) => a.juz - b.juz || a.fromPage - b.fromPage);
  return { ok: true, entries };
}

/** "Juz 3 · p. 1–5", "Juz 3 · p. 4", or "Juz 3" for rows saved before pages. */
export function formatJuzPages(entry: {
  juz: number;
  fromPage: number | null;
  toPage: number | null;
}): string {
  if (entry.fromPage == null || entry.toPage == null) return `Juz ${entry.juz}`;
  const pages = entry.fromPage === entry.toPage ? `${entry.fromPage}` : `${entry.fromPage}–${entry.toPage}`;
  return `Juz ${entry.juz} · p. ${pages}`;
}
