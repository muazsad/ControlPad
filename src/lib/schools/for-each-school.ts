import type { SchoolContext } from "@/lib/schools/school-context";

export type SchoolRunResult<T> =
  | { schoolId: string; ok: true; result: T }
  | { schoolId: string; ok: false; error: string };

/**
 * Runs `run` for each school in turn. One school failing is logged (school id
 * only, no PII) and the rest still run.
 */
export async function forEachSchool<T>(
  schools: SchoolContext[],
  run: (ctx: SchoolContext) => Promise<T>,
  deps: { log?: (line: string) => void } = {},
): Promise<SchoolRunResult<T>[]> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const results: SchoolRunResult<T>[] = [];
  for (const ctx of schools) {
    try {
      results.push({ schoolId: ctx.schoolId, ok: true, result: await run(ctx) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      log(`Scheduled run failed for school ${ctx.schoolId}: ${message}`);
      results.push({ schoolId: ctx.schoolId, ok: false, error: message });
    }
  }
  return results;
}
