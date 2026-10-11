# Course Pace Design

## Context

Grades only show trouble after it has happened. GCVS also reports how much of
each course is complete and how many assignments are missing; both move before
the grade does. Staff already re-type grades weekly (the grade sweep), so we
capture two more numbers in the same pass and compare % complete with where the
student *should* be by today.

Stacked on `feat/grade-sweep` (PR #2) because it extends the sweep grid and
`sweep.ts`; retarget to `main` once that merges.

## Migration (`20261012000100_course_pace.sql`, additive, NOT applied by Claude)

- `grades`: `percent_complete numeric(5,2)` (0–100), `missing_assignments integer` (>= 0), both NULL.
- `courses`: `start_date`, `end_date` (per-course override; end >= start).
- `settings`: `term_start`, `term_end`, `pace_gap_threshold` (default 10), `missing_assignments_threshold` (default 3).
- `notification_trigger`: `pace_behind`, `missing_assignments`.
- No change to existing columns or RLS policies. Queries that select the new
  columns fail until the migration is applied, so run `supabase db push` before merging.

## Pace logic (`src/lib/grades/pace.ts`, pure)

- `courseWindow(course, term)`: course dates if both set, else term dates, else null.
- `expectedPercent(window, today, isExpectedDay)`: expected school days elapsed
  (today included) / total in window x 100, clamped 0–100, null without a
  window or with no expected days. `expectedDayPredicate(group, calendar, defaults)`
  wraps `scheduleForDate()`, so the student's group days, breaks and special
  days with `students_expected = false` are respected.
- `paceGap = expected - latest percent_complete` (null if either missing).
- `paceTone`: neutral (null) / success (< threshold) / warning (>= threshold) /
  danger (>= `PACE_DANGER_MULTIPLIER` x threshold, constant = 2). `missingTone`
  uses the same bands for the missing count.
- `isoWeekKey(date)` for alert dedupe keys.

## Snapshot rules (`sweep.ts`)

- Sweep rows get **% complete** and **Missing** inputs next to the grade.
- Blank fields mean "leave alone" and **carry forward** the latest known value,
  so history is never nulled.
- One snapshot is inserted if any typed field differs from the latest snapshot;
  none if all typed fields match (unchanged skip now covers all three).
- A grade is required to insert (`grade_value` is NOT NULL): a course with no
  previous grade needs a typed grade (`grade_required`).
- `gradeChanged` is tracked per insert; the **low-grade alert runs only when
  the grade value itself changed**.
- Single-course form and student-profile editor use `carryForward()`; they
  always insert (explicit submit), and run the low-grade alert as before.
- Keyboard grid: Enter/ArrowDown/ArrowUp/Shift+Enter move within the same column
  across rows; Tab/Shift+Tab move across the row (grade, %, missing) then to the next row.

## Alerts (event-based, on save, via `sendSms()` only; no new cron)

`src/lib/alerts/pace.ts`, called after each inserted snapshot (sequentially, in try/catch):

- `pace_behind` when expected - percent >= `pace_gap_threshold` -> parents + admin,
  dedupe key `pace_behind:{courseId}:{ISO week}`.
- `missing_assignments` when missing >= `missing_assignments_threshold` -> parents + admin,
  dedupe key `missing_assignments:{courseId}:{ISO week}`.
- Short plain texts. Known limit: a sweep that re-types an unchanged % creates
  no snapshot and so no text; the dashboard still shows the course live.

## UI

- Settings -> "Term & pace" card (admin): term start/end + the two thresholds.
- Course add form: optional start/end ("Leave blank to use the term dates"); a
  "Course dates" card on `/grades/[courseId]` edits them.
- `/grades/[courseId]`: % complete and missing columns; Recharts line of actual
  % complete vs the expected pace line.
- Student profile: per course pace bar ("40% done - pace 55%") + missing count, toned.
- Dashboard + admin digest: "Behind pace" and "Missing work" lists, ordered by
  `admin-dashboard-severity.ts`. Computed live on every load.
- Escalation (`lib/people/escalation.ts`): `pace` and `missing` signals with named
  constants next to the existing ones.

## Data (no N+1)

Latest snapshot fields ride on existing bulk queries: `getAllStudentMetrics()`
(nested select now includes the new columns), the digest's grade query, and one
nested students -> courses -> grades query in `escalation-data.ts`. Shared
context (term, thresholds, calendar, groups) loads once per request in
`pace-data.ts`.

## Testing

`pace.test.ts`: expectedPercent (before start, after end, break inside window,
special day, null window), tone boundaries, gap, ISO week. `sweep.test.ts`:
carry-forward, multi-field skip, gradeChanged, grade_required, field-specific
invalid. Escalation and digest tests extended.
