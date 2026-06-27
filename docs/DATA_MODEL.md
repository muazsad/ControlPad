# ControlPad — Data Model

Companion to `PROJECT_PLAN.md`. This describes the Postgres/Supabase schema, relationships, and Row Level Security (RLS). Claude Code should turn this into proper Supabase migration files (do not run ad-hoc SQL in the dashboard for anything you want to keep).

---

## Design notes

- **Parents may have no login.** Many parents only receive SMS. So contact data lives in a `guardians` table that does **not** require an auth account. A guardian who *wants* web access gets a Supabase auth user, and `guardians.user_id` links to it.
- **Staff (admin, moderator) always have logins**, represented in `profiles` (1:1 with `auth.users`).
- **History is kept** for grades, attendance, Quran progress, and notifications — we need trends and an audit trail, not just current values.
- **Phone numbers are stored in E.164 format** (e.g. `+14135551234`).
- **Every table has RLS enabled.** Default deny; policies grant the minimum.

---

## Enums

```sql
create type user_role            as enum ('admin', 'moderator', 'parent');
create type enrollment_status    as enum ('active', 'inactive', 'withdrawn');
create type attendance_status    as enum ('present', 'tardy', 'absent', 'excused');
create type payment_status       as enum ('paid', 'unpaid');
create type notification_trigger as enum ('low_grade','absence','tardy_threshold','quran_slip','payment_overdue','admin_digest');
create type notification_status  as enum ('queued','sent','failed');
```

---

## Tables

```sql
-- One row per authenticated user (admin / moderator / parent-with-login)
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null,
  full_name   text not null,
  phone       text,                       -- for admin/moderator alerts
  created_at  timestamptz not null default now()
);

create table students (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text not null,
  last_name          text not null,
  date_of_birth      date,
  grade_level        text,
  enrollment_status  enrollment_status not null default 'active',
  gcvs_reference     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Contact records for parents/guardians; login is optional
create table guardians (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text not null,              -- E.164, primary SMS target
  email       text,
  user_id     uuid references auth.users(id) on delete set null,  -- set if they log in
  created_at  timestamptz not null default now()
);

-- Many-to-many: a child can have several guardians; a guardian several children
create table student_guardians (
  student_id   uuid not null references students(id) on delete cascade,
  guardian_id  uuid not null references guardians(id) on delete cascade,
  relationship text,                      -- 'mother','father','uncle', etc.
  is_primary   boolean not null default false,
  primary key (student_id, guardian_id)
);

-- A student's GCVS courses
create table courses (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  name              text not null,        -- 'Algebra I'
  gcvs_course_code  text,
  created_at        timestamptz not null default now()
);

-- Grade snapshots over time; latest per course = current grade
create table grades (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  grade_value  numeric not null check (grade_value >= 0 and grade_value <= 100),
  note         text,
  recorded_by  uuid references auth.users(id),
  recorded_at  timestamptz not null default now()
);

create table attendance (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  date         date not null,
  status       attendance_status not null,
  note         text,
  recorded_by  uuid references auth.users(id),
  recorded_at  timestamptz not null default now(),
  unique (student_id, date)
);

create table quran_progress (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  date              date not null,
  surah             text,
  from_ayah         int,
  to_ayah           int,
  lines_memorized   numeric not null default 0,
  cumulative_lines  numeric,              -- optional running total
  note              text,
  recorded_by       uuid references auth.users(id),
  recorded_at       timestamptz not null default now()
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  period_month  date not null,            -- first day of the month it covers
  amount        numeric,
  status        payment_status not null default 'unpaid',
  paid_at       timestamptz,
  recorded_by   uuid references auth.users(id),
  unique (student_id, period_month)
);

-- Single-row table of configurable thresholds (id is always 1)
create table settings (
  id                    int primary key default 1 check (id = 1),
  grade_floor           numeric not null default 70,
  tardy_window_hours    numeric not null default 2,
  tardies_per_week      int     not null default 3,
  quran_inactivity_days int     not null default 7,
  payment_due_day       int     not null default 5,
  school_start          time    not null default '08:00',
  admin_digest_time     time    not null default '15:00',
  updated_at            timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

-- Audit log of every alert; also used to avoid duplicate sends
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  recipient_type  text not null,          -- 'parent' | 'admin'
  student_id      uuid references students(id) on delete set null,
  trigger_type    notification_trigger not null,
  body            text not null,
  status          notification_status not null default 'queued',
  twilio_sid      text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
```

---

## Row Level Security

Enable RLS on every table, then add policies. A helper avoids repeating the role lookup:

```sql
-- Returns the current user's role; SECURITY DEFINER so it can read profiles
create or replace function public.user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;
```

**Access rules to implement (per table):**

| Table | Admin | Moderator | Parent |
|-------|-------|-----------|--------|
| students, courses, grades, attendance, quran_progress | full | read + write | read **own children only** |
| guardians, student_guardians | full | read | read **own record / own children** |
| payments | full | read | read **own children only** |
| settings | read + write | read | none |
| notifications | full | read | read **own** |

**Parent "own children" check** (reusable predicate):

```sql
-- True when the row's student belongs to a guardian linked to the current user.
-- Implement this as a SECURITY DEFINER helper, not inline in each RLS policy:
-- parent policies on other tables must not directly query student_guardians,
-- because student_guardians has its own RLS policy and Postgres will recurse.
public.parent_has_student(<table>.student_id)
```

**Example policies (pattern to repeat):**

```sql
alter table students enable row level security;

create policy students_admin_all on students
  for all using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

create policy students_moderator_rw on students
  for all using (public.user_role() = 'moderator') with check (public.user_role() = 'moderator');

create policy students_parent_read on students
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = students.id and g.user_id = auth.uid()
    )
  );
```

> The **service role key** bypasses RLS. It is used **only** in server-side code (cron jobs, the SMS engine) and **never** shipped to the browser.

---

## Derived logic (not columns — computed by the app/cron)

- **Current grade** for a course = most recent `grades` row by `recorded_at`.
- **Grade slipping** = current grade below `settings.grade_floor`, or a downward delta across recent entries.
- **Weekly tardies** = count of `attendance.status = 'tardy'` in the last 7 days per student.
- **Quran slip** = days since the latest `quran_progress.date` exceeds `settings.quran_inactivity_days`.
- **Overdue payment** = no `payments` row with `status='paid'` for the current `period_month` once the day of month passes `settings.payment_due_day`.

---

## Add as you build

- `updated_at` auto-update trigger on `students` (and any table you edit in place).
- Indexes on `grades(course_id, recorded_at)`, `attendance(student_id, date)`, `quran_progress(student_id, date)`, `payments(student_id, period_month)`.
- A `notifications` dedup check before each send (same student + trigger within the relevant window).
