-- Special days: more types, per-day attendance options, group scoping and a
-- parent text. Additive only: widens two check constraints, adds nullable /
-- defaulted columns and one enum value. Existing rows keep their behavior.

-- 1. More special-day types.
alter table school_special_days
  drop constraint if exists school_special_days_type_check;
alter table school_special_days
  add constraint school_special_days_type_check
  check (type in ('no_school', 'half_day', 'schedule_change', 'no_gcvs', 'field_trip', 'other'));

-- 2. Times: half days and schedule changes need both; other types may set
--    them optionally (end after start when both are given).
alter table school_special_days
  drop constraint if exists school_special_days_check;
alter table school_special_days
  add constraint school_special_days_times_check
  check (
    (type not in ('half_day', 'schedule_change') or (start_time is not null and end_time is not null))
    and (start_time is null or end_time is null or end_time > start_time)
  );

-- 3. Per-day options.
alter table school_special_days
  -- false = nobody in scope is expected (no attendance, no absence alerts).
  add column if not exists students_expected boolean not null default true,
  -- false = absence / tardy texts to parents are paused for students in scope.
  add column if not exists send_attendance_alerts boolean not null default true,
  -- null = whole school. Otherwise schedule group ids, plus 'ungrouped' for
  -- students without a group.
  add column if not exists applies_to text[],
  -- Text sent to parents of students in scope.
  add column if not exists parent_message text,
  -- Automatically text parents the evening before.
  add column if not exists notify_parents boolean not null default false,
  add column if not exists parents_notified_at timestamptz;

-- Keep existing rows behaving exactly as before:
-- no-school days expect nobody; half-day times only ever applied to students
-- without a schedule group.
update school_special_days set students_expected = false where type = 'no_school';
update school_special_days set applies_to = array['ungrouped'] where type = 'half_day' and applies_to is null;

-- 4. Notification trigger for the parent text.
alter type notification_trigger add value if not exists 'special_day';
