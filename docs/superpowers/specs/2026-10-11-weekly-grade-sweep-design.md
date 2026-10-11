# Weekly Grade Sweep Design

## Context

GCVS has no API, so staff re-type grades into ControlPad. Today that is one
form per course (`/grades/[courseId]` or the student profile), which is far too
slow to do weekly for every student × course. The sweep is a single keyboard-
driven page where one teacher can update the current GCVS grade for every
active student's every course in about 10 minutes.

## Scope

- New page `/grades/sweep` (admin + moderator, `requireRole`), linked from
  `/grades` with a "Weekly sweep" button.
- One table row per course of every **active** student: Student | Course |
  Last grade (value + date, or "never") | New grade (input) | status chip.
  Grouped by student (alphabetical), courses alphabetical within a student.
- Filters: schedule group, name search, "only not updated in the last 7 days".
  Progress line: "X of Y courses updated in the last 7 days".
- One "Save sweep" button → one server action → one batch insert of new
  `grades` snapshots, then the existing low-grade alert per inserted grade.
- No migrations, no auth/RLS/env changes. Grades stay append-only snapshots.

## Pure logic: `src/lib/grades/sweep.ts`

No server or browser imports, so the client and the server action share it.

- Constants: `SWEEP_WINDOW_DAYS = 7`, `GRADE_MIN = 0`, `GRADE_MAX = 100`,
  `GRADE_MAX_DECIMALS = 1`, `SCHOOL_TIME_ZONE = "America/New_York"`.
- `parseGradeInput(raw)` → `blank | ok(value) | invalid(reason)`. Accepts
  digits with an optional `.` and up to one decimal (`85`, `85.0`, `85.`, `.5`).
  Reasons: `not_a_number` (letters, negatives, NaN, junk), `too_many_decimals`,
  `out_of_range`.
- `planSweep(entries, courses)` → `{ toInsert, skippedUnchanged, invalid }`:
  - blank → dropped silently (not counted);
  - unknown course id (not in the server-loaded `courses`) → `invalid`;
  - duplicate course id → later duplicates `invalid`;
  - invalid value → `invalid`;
  - value equal to the course's latest grade (compared in tenths, so `85` ==
    `85.0`) → `skippedUnchanged`, no snapshot;
  - otherwise → `toInsert` with the value rounded to 1 decimal. A course with
    no previous grade always inserts.
- `easternDateKey(date)` and `isWithinSweepWindow(recordedAt, now)`: "updated in
  the last 7 days" is counted in **Eastern calendar days**, today plus the six
  before it. A sweep done last Saturday therefore is stale again this Saturday.

## Data (no N+1)

Two queries on the page, mirroring `getAllStudentMetrics()`'s approach of
fetching in bulk and shaping in JS:

1. `students` (active only) with nested `courses(id, name)` and
   `schedule_groups(id, name)`.
2. Latest grade per course. Postgres can't express "latest per group" through
   PostgREST without an RPC/view (migrations are out of scope), so we select
   `grades` joined to active students, newest first, and keep the first row per
   course. PostgREST caps responses at 1000 rows, so the helper
   `fetchLatestGrades()` in `src/lib/grades/sweep-data.ts` pages with `.range()`
   until exhausted. It is shared by the page and the action so the "latest"
   definition cannot diverge. If this ever gets slow, replace it with a view.

## Server action: `saveGradeSweep(entries)` in `app/grades/actions.ts`

1. `requireRole(["admin","moderator"])`.
2. Treat input as untrusted: must be an array (capped at `MAX_SWEEP_ENTRIES`),
   items `{ courseId, value }`.
3. Load active students' courses and latest grades itself. Client-supplied
   "last grade" values do not exist in the contract.
4. `planSweep()` on the server regardless of any client filtering.
5. One `insert` of `{ course_id, student_id, grade_value, recorded_by }` rows
   (existing column names; `recorded_at` defaults to `now()`).
6. After a successful insert, `checkLowGradeAlert()` per inserted grade,
   sequentially, each in try/catch (failures are logged without PII and never
   fail the save). Same arguments as `recordGrade` (`includeGuardians: false`);
   its dedupe is unchanged.
7. Revalidate `/grades`, `/grades/sweep`, each affected `/students/[id]` and
   `/grades/[courseId]`.
8. Return `{ saved, skippedUnchanged, invalid, error? }`. `invalid` is a list of
   `{ courseId, reason }`. If the insert fails, nothing is saved and `error` is
   set.

## Client: `sweep-form.tsx`

- Inputs: `type="text"`, `inputMode="decimal"`. Invalid values get a red border
  (`aria-invalid`) and are never submitted.
- Keyboard: Enter / Tab / ArrowDown → next visible input; Shift+Enter /
  Shift+Tab / ArrowUp → previous; Esc clears the current input. At the ends,
  Enter on the last input moves to the Save button; Tab/Shift+Tab fall through
  to normal browser behavior. First input is focused on load.
- Typed values live in `entries: Record<courseId, string>`, independent of the
  filters. Filters only hide rows; hidden rows with entries are still saved.
- The status chip and the progress line come from server data only, so they
  change after a save (the action revalidates and the page re-renders), never
  while typing. This also means the "not updated" filter never makes a row
  vanish mid-entry.
- Safety net: drafts in `localStorage["grade-sweep-draft:<userId>:<easternDate>"]`
  (every access in try/catch). On load, only entries whose course still exists
  are restored, with a "Restored N unsaved entries" toast. Cleared after a
  successful save (entries that were saved or unchanged are removed; invalid
  ones stay). `beforeunload` warns while any unsaved entry exists.
- Result is shown in a sonner toast.

## Testing

Node test runner tests for `sweep.ts` (blank, unchanged, changed, out of range,
NaN, 2+ decimals, rounding, `85` vs `85.0`, no previous grade, unknown course,
duplicate, Eastern window edges). The page, action, and client are verified by
`npm run build` plus a manual walkthrough.

## Out of scope / known limits

- No migration, so no SQL "latest grade" view; see paging note above.
- `beforeunload` does not catch in-app (Next `<Link>`) navigation; the draft
  restore covers that case.
- Per-course notes are not captured in the sweep.
