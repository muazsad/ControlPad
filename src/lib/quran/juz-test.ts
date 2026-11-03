// Juz tests: while a test is open the student isn't expected to do sabaq,
// sabaq para or dhor, so Quran/revision alerts, dashboard flags and
// escalation pause, and the Quran score is frozen at the test's start.
// Pure: no database access.

export type JuzTestRow = {
  student_id?: string;
  juz: number;
  started_on: string;
  finished_on: string | null;
};

export type ActiveJuzTest = { juz: number; startedOn: string };

/** The open test (not finished, started on or before `asOfDate`), or null. */
export function activeJuzTest(
  tests: JuzTestRow[] | null | undefined,
  asOfDate: string,
): ActiveJuzTest | null {
  const open = (tests ?? [])
    .filter((test) => test.finished_on === null && test.started_on.slice(0, 10) <= asOfDate)
    .sort((a, b) => b.started_on.localeCompare(a.started_on))[0];
  return open ? { juz: open.juz, startedOn: open.started_on.slice(0, 10) } : null;
}

/** Student ids with an open test as of `asOfDate` (rows need `student_id`). */
export function studentsOnJuzTest(tests: JuzTestRow[], asOfDate: string): Map<string, ActiveJuzTest> {
  const byStudent = new Map<string, JuzTestRow[]>();
  for (const test of tests) {
    if (!test.student_id) continue;
    const list = byStudent.get(test.student_id) ?? [];
    list.push(test);
    byStudent.set(test.student_id, list);
  }
  const active = new Map<string, ActiveJuzTest>();
  for (const [studentId, list] of byStudent) {
    const test = activeJuzTest(list, asOfDate);
    if (test) active.set(studentId, test);
  }
  return active;
}

export function juzTestLabel(test: ActiveJuzTest): string {
  return `On juz test · Juz ${test.juz}`;
}
