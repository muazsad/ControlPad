-- Schedule groups: students belong to a group (e.g. Full time, Quran only)
-- that defines which weekdays they attend and their daily times.
-- Also: arrival time on attendance, parent escalation delay, and SMS
-- delivery-mode tracking on notifications.
-- Scope: additive only. Existing students are assigned to a seeded
-- "Full time" group built from the current settings + weekly pattern.

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------

create table schedule_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per weekday the group attends. No row = group does not attend.
-- weekday: 0 = Sunday … 6 = Saturday (matches JS Date.getUTCDay()).
create table schedule_group_days (
  group_id             uuid not null references schedule_groups(id) on delete cascade,
  weekday              smallint not null check (weekday between 0 and 6),
  start_time           time not null,
  tardy_grace_minutes  int not null default 10 check (tardy_grace_minutes between 0 and 240),
  absence_check_time   time not null,
  primary key (group_id, weekday),
  check (absence_check_time >= start_time)
);

create trigger schedule_groups_updated_at
  before update on schedule_groups
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------

alter table students
  add column schedule_group_id uuid references schedule_groups(id) on delete set null;

create index idx_students_schedule_group on students(schedule_group_id);

-- Local (America/New_York) arrival time recorded by staff.
alter table attendance
  add column arrived_at time;

-- Minutes after a group's absence-check time before parents are texted
-- about students who are still unmarked or absent.
alter table settings
  add column parent_alert_delay_minutes int not null default 60
    check (parent_alert_delay_minutes between 0 and 480);

-- Optional explicit dedupe key (used for batched admin messages) and the
-- delivery mode the message was handled in (off / test / live).
alter table notifications
  add column dedupe_key text,
  add column delivery_mode text check (delivery_mode in ('off', 'test', 'live'));

create index idx_notifications_dedupe_key on notifications(dedupe_key, created_at)
  where dedupe_key is not null;

create index idx_notifications_created_at on notifications(created_at desc);

-- New enum values (not used elsewhere in this migration).
alter type notification_trigger add value if not exists 'absence_review';
alter type notification_trigger add value if not exists 'manual_test';
alter type notification_status add value if not exists 'dry_run';

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------

alter table schedule_groups enable row level security;
alter table schedule_group_days enable row level security;

create policy schedule_groups_admin_all on schedule_groups
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy schedule_groups_moderator_read on schedule_groups
  for select using (public.user_role() = 'moderator');

create policy schedule_groups_parent_read on schedule_groups
  for select using (public.user_role() = 'parent');

create policy schedule_group_days_admin_all on schedule_group_days
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy schedule_group_days_moderator_read on schedule_group_days
  for select using (public.user_role() = 'moderator');

create policy schedule_group_days_parent_read on schedule_group_days
  for select using (public.user_role() = 'parent');

-- ---------------------------------------------------------------
-- Seed: "Full time" group from current settings + weekly pattern,
-- and assign every existing student to it.
-- ---------------------------------------------------------------

insert into schedule_groups (name, description)
values ('Full time', 'GCVS + Quran')
on conflict (name) do nothing;

insert into schedule_group_days (group_id, weekday, start_time, tardy_grace_minutes, absence_check_time)
select
  g.id,
  d.weekday,
  s.school_start,
  10,
  (s.school_start + make_interval(mins => (s.tardy_window_hours * 60)::int))::time
from schedule_groups g
cross join settings s
cross join (
  values (0, 'sunday'), (1, 'monday'), (2, 'tuesday'), (3, 'wednesday'),
         (4, 'thursday'), (5, 'friday'), (6, 'saturday')
) as d(weekday, day_key)
left join school_weekly_patterns p on p.id = 1
where g.name = 'Full time'
  and s.id = 1
  and coalesce(
    case d.day_key
      when 'sunday' then p.sunday
      when 'monday' then p.monday
      when 'tuesday' then p.tuesday
      when 'wednesday' then p.wednesday
      when 'thursday' then p.thursday
      when 'friday' then p.friday
      when 'saturday' then p.saturday
    end,
    d.weekday in (1, 2, 3, 4, 6)
  )
on conflict do nothing;

update students
set schedule_group_id = (select id from schedule_groups where name = 'Full time')
where schedule_group_id is null;
