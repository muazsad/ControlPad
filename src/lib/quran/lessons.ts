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
