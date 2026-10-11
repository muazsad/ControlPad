-- Stale grade data: how many of a student's own school days can pass without a
-- grade snapshot before a course counts as stale (about 2 weeks on a 5-day week).
-- Scope: additive only. No existing columns or RLS policies are changed.

alter table settings
  add column stale_grade_school_days integer not null default 10
    check (stale_grade_school_days between 1 and 90);
