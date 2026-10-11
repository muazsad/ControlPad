# Hifz Revision Design

## Context

ControlPad only tracks new memorization (lines per lesson). A student who
memorizes quickly but never revises loses what they memorized, and nothing
flags it. Hifz teachers distinguish three kinds of lesson:

- **sabaq**: new memorization;
- **sabaq para**: recent revision (the juz currently being memorized);
- **dhor**: old revision (juz memorized earlier).

## Migration (`20261016000000_quran_lesson_types.sql`, additive, not applied by Claude)

Named `…16` rather than the requested `…12000200`: `…13`–`…15` are already
applied, so an older version would be out of order (needs `--include-all`).

- Enum `quran_lesson_type` (`sabaq`, `sabaq_para`, `dhor`).
- `quran_progress.lesson_type` (NOT NULL DEFAULT `sabaq`, so existing rows are
  sabaq) and `quran_progress.juz` (1–30, nullable).
- `student_memorized_juz` (student, juz 1–30, `marked_at` date, unique per
  student + juz). RLS copies `quran_progress` exactly (admin all, moderator
  read/write, parent read via `parent_has_student()`).
- `settings.revision_overdue_school_days` (default 21).
- `notification_trigger += 'revision_overdue'`.

## Counting rules

Only **sabaq** counts as memorization: cumulative totals, the chart's
memorization line, the Quran score (`performance.ts` via `student-metrics.ts`),
Top Performers, escalation, and the `quran_slip` inactivity check. Revision
entries never add to totals. `cumulative_lines` stays unused; totals are
summed from raw entries. Helpers in `src/lib/quran/lessons.ts`.

## Revision logic (`src/lib/quran/revision.ts`, pure)

- Per memorized juz: last revision = latest `sabaq_para` or `dhor` entry for
  that juz, else `marked_at`.
- School days since = `schoolDaysSince()` from the school calendar, the same
  counting the Quran inactivity check uses (breaks / no-school days excluded).
- Tone: success ≤ `REVISION_WARNING_FRACTION` (0.7) × threshold, warning above
  that, danger (overdue) when > threshold.
- "Sabaq without revision" (dashboard only): ≥ `SABAQ_WITHOUT_REVISION_MIN_SABAQ`
  (3) sabaq entries and 0 revision entries in the last
  `SABAQ_WITHOUT_REVISION_WINDOW` (10) school days.
- SMS juz list capped at `REVISION_SMS_MAX_JUZ` (2): "Juz 3, 7 and 2 more".

## Entry (`/quran` bulk form)

Per student: Sabaq lines | Sabaq para juz | Dhor juz (several, shown as chips).
Each filled input becomes its own `quran_progress` row (revision rows store
0 lines). Enter moves to the next input, Shift+Enter back. One batch insert per
submit, plus one batch upsert (do-nothing on conflict) of any revised juz into
`student_memorized_juz`.

## Memorized juz (`/quran/[studentId]`)

30-cell grid; staff click to mark/unmark. Tone as above, tooltip with last
revision date and school days since. Parents see the grid read-only. Chart:
memorization line from sabaq only, revision entries as a small bar series.

## Alert

`revision_overdue` from the 10-minute tick at `QURAN_CHECK_TIME`, next to
`quran_slip`, skipped on no-school days. One SMS per student to parents +
admin listing overdue juz (capped), dedupe key
`revision_overdue:{studentId}:{ISO week}`, via `sendSms()`.

## Dashboard / digest / escalation / parent

- Dashboard: "Revision overdue" (danger) and "Sabaq without revision"
  (warning) lists, ordered via `admin-dashboard-severity.ts`; digest count line
  for each.
- Escalation: `revision` signal, `REVISION_OVERDUE_SCORE` per overdue juz.
- Parent Quran view: total stays sabaq-only; adds last revision date.
