-- Course pace: track each course's GCVS % complete against where the student
-- should be by today, plus missing assignments, as early-warning signals.
-- Scope: additive only. No existing columns or RLS policies are changed; the
-- existing grades / courses / settings policies already cover the new columns.

-- ---------------------------------------------------------------
-- grades: pace fields on each snapshot (null = not recorded)
-- ---------------------------------------------------------------

alter table grades
  add column percent_complete numeric(5,2)
    check (percent_complete >= 0 and percent_complete <= 100),
  add column missing_assignments integer
    check (missing_assignments >= 0);

-- ---------------------------------------------------------------
-- courses: optional per-course window (overrides the term dates)
-- ---------------------------------------------------------------

alter table courses
  add column start_date date,
  add column end_date date,
  add constraint courses_dates_ordered check (end_date >= start_date);

-- ---------------------------------------------------------------
-- settings: school term + alert thresholds
-- ---------------------------------------------------------------

alter table settings
  add column term_start date,
  add column term_end date,
  add column pace_gap_threshold integer not null default 10
    check (pace_gap_threshold between 1 and 100),
  add column missing_assignments_threshold integer not null default 3
    check (missing_assignments_threshold between 1 and 100),
  add constraint settings_term_ordered check (term_end >= term_start);

-- ---------------------------------------------------------------
-- New notification triggers (not used elsewhere in this migration)
-- ---------------------------------------------------------------

alter type notification_trigger add value if not exists 'pace_behind';
alter type notification_trigger add value if not exists 'missing_assignments';
