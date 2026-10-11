# Staff accountability — design

**Status:** built on `feature/staff-accountability` (stacked on `feature/parent-absence-reports`), Oct 11, 2026.

## Goal

The admin can see at a glance which teachers still have attendance to mark or
Quran lessons to log today.

## Decisions (confirmed with owner)

| Question | Decision |
|---|---|
| Who is responsible | **One teacher per schedule group** (`schedule_groups.teacher_id`, any admin or moderator), set in Settings → Schedule groups. They own attendance and Quran for the group's students. |
| Quran rule | Logged **every school day** the student attends. |
| Where | **Admin dashboard** section only. No SMS. |

## Rules (`lib/people/staff-accountability.ts`)

- Students counted: active, expected today per `scheduleForDate()` (so breaks, no-school days, group days and special days all apply).
- **Attendance** gap: no attendance row and the student's tardy cutoff has passed. Before that it's "not due yet".
- **Quran** gap: expected today, not marked absent/excused, and no `quran_progress` row dated today (unmarked students count — they're presumed in).
- Unmarked students with a pending/unexcused **parent absence report** are skipped (the admin resolves those).
- Ungrouped students, groups with no teacher, and teachers who are no longer staff go in a **"No teacher assigned"** row, listed last.
- Teachers with outstanding items are listed first; each row shows `marked/expected` and `logged/expected` with the missing students' names (first 5, then "+N more").

## Data

- Migration `20261013000000_schedule_group_teacher.sql`: `schedule_groups.teacher_id uuid references profiles(id) on delete set null`. Existing RLS on `schedule_groups` covers it.
- Loaded separately from `getScheduleGroups()` (`getGroupTeachers()`), so if the column is missing the app behaves as "no teachers assigned" instead of losing the groups.

## Out of scope

A digest line or SMS nudges to teachers, history on /staff, per-student teacher overrides.
