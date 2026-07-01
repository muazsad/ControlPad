-- Add configurable school calendar tables.
-- Scope: new additive tables only.

create table school_weekly_patterns (
  id          int primary key default 1 check (id = 1),
  sunday      boolean not null default false,
  monday      boolean not null default true,
  tuesday     boolean not null default true,
  wednesday   boolean not null default true,
  thursday    boolean not null default true,
  friday      boolean not null default false,
  saturday    boolean not null default true,
  updated_at  timestamptz not null default now()
);

insert into school_weekly_patterns (id)
values (1)
on conflict do nothing;

create table school_breaks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create table school_special_days (
  date        date primary key,
  type        text not null check (type in ('no_school', 'half_day')),
  start_time  time,
  end_time    time,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (
    type = 'no_school'
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index idx_school_breaks_dates on school_breaks(start_date, end_date);
create index idx_school_special_days_type on school_special_days(type);

create trigger school_breaks_updated_at
  before update on school_breaks
  for each row execute function update_updated_at();

create trigger school_special_days_updated_at
  before update on school_special_days
  for each row execute function update_updated_at();

alter table school_weekly_patterns enable row level security;
alter table school_breaks enable row level security;
alter table school_special_days enable row level security;

create policy school_weekly_patterns_admin_all on school_weekly_patterns
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy school_weekly_patterns_moderator_read on school_weekly_patterns
  for select using (public.user_role() = 'moderator');

create policy school_weekly_patterns_parent_read on school_weekly_patterns
  for select using (public.user_role() = 'parent');

create policy school_breaks_admin_all on school_breaks
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy school_breaks_moderator_read on school_breaks
  for select using (public.user_role() = 'moderator');

create policy school_breaks_parent_read on school_breaks
  for select using (public.user_role() = 'parent');

create policy school_special_days_admin_all on school_special_days
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy school_special_days_moderator_read on school_special_days
  for select using (public.user_role() = 'moderator');

create policy school_special_days_parent_read on school_special_days
  for select using (public.user_role() = 'parent');
