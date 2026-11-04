-- Multi-tenancy, step 1 of 4 (docs/superpowers/specs/2026-11-03-multi-tenancy-design.md §3).
-- Additive. Creates schools and the archive school that holds all pre-tenancy data.

begin;

create table if not exists schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 80),
  sms_name    text not null check (length(trim(sms_name)) between 2 and 40),
  time_zone   text not null default 'America/New_York',
  archived    boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists schools_updated_at on schools;
create trigger schools_updated_at before update on schools
  for each row execute function update_updated_at();

alter table schools enable row level security;

-- Per-school Twilio setup. RLS on and NO policies: service role only.
create table if not exists school_sms_config (
  school_id              uuid primary key references schools(id) on delete cascade,
  twilio_account_sid     text,
  twilio_auth_token_enc  text,
  twilio_phone_number    text unique,
  verified_at            timestamptz,
  requested_mode         text not null default 'off' check (requested_mode in ('off', 'test', 'live')),
  live_approved_at       timestamptz,
  live_approved_by       uuid references auth.users(id) on delete set null,
  test_number            text,
  updated_at             timestamptz not null default now()
);

alter table school_sms_config enable row level security;

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table platform_admins enable row level security;

alter table profiles add column if not exists school_id uuid references schools(id) on delete cascade;
create index if not exists profiles_school_id_idx on profiles (school_id);

-- The archive school: every pre-tenancy row moves here (spec §3.5). Fixed id so
-- later migrations and scripts can refer to it.
insert into schools (id, name, sms_name, archived)
values ('00000000-0000-0000-0000-000000000001', 'Pre-multi-tenant archive', 'Archive', true)
on conflict (id) do nothing;

update profiles set school_id = '00000000-0000-0000-0000-000000000001' where school_id is null;

-- The signed-in user's school, or null if they have none or it is archived.
create or replace function public.current_school_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.school_id
  from public.profiles p
  join public.schools s on s.id = p.school_id
  where p.id = auth.uid() and not s.archived
$$;

revoke all on function public.current_school_id() from public, anon;
grant execute on function public.current_school_id() to authenticated, service_role;

commit;
