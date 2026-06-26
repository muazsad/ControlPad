-- ControlPad initial schema
-- Implements enums, tables, user_role() helper, and RLS policies
-- from docs/DATA_MODEL.md

-- =============================================================
-- Enums
-- =============================================================

create type user_role            as enum ('admin', 'moderator', 'parent');
create type enrollment_status    as enum ('active', 'inactive', 'withdrawn');
create type attendance_status    as enum ('present', 'tardy', 'absent', 'excused');
create type payment_status       as enum ('paid', 'unpaid');
create type notification_trigger as enum ('low_grade','absence','tardy_threshold','quran_slip','payment_overdue','admin_digest');
create type notification_status  as enum ('queued','sent','failed');

-- =============================================================
-- Tables
-- =============================================================

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null,
  full_name   text not null,
  phone       text,
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

create table guardians (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text not null,
  email       text,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table student_guardians (
  student_id   uuid not null references students(id) on delete cascade,
  guardian_id  uuid not null references guardians(id) on delete cascade,
  relationship text,
  is_primary   boolean not null default false,
  primary key (student_id, guardian_id)
);

create table courses (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  name              text not null,
  gcvs_course_code  text,
  created_at        timestamptz not null default now()
);

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
  cumulative_lines  numeric,
  note              text,
  recorded_by       uuid references auth.users(id),
  recorded_at       timestamptz not null default now()
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  period_month  date not null,
  amount        numeric,
  status        payment_status not null default 'unpaid',
  paid_at       timestamptz,
  recorded_by   uuid references auth.users(id),
  unique (student_id, period_month)
);

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

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  recipient_type  text not null,
  student_id      uuid references students(id) on delete set null,
  trigger_type    notification_trigger not null,
  body            text not null,
  status          notification_status not null default 'queued',
  twilio_sid      text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- =============================================================
-- Indexes (for common query patterns)
-- =============================================================

create index idx_grades_course_recorded   on grades(course_id, recorded_at);
create index idx_attendance_student_date  on attendance(student_id, date);
create index idx_quran_student_date       on quran_progress(student_id, date);
create index idx_payments_student_period  on payments(student_id, period_month);
create index idx_guardians_user_id        on guardians(user_id);
create index idx_notifications_student    on notifications(student_id, trigger_type, created_at);

-- =============================================================
-- updated_at trigger for students
-- =============================================================

create or replace function update_updated_at()
returns trigger
language plpgsql
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger students_updated_at
  before update on students
  for each row execute function update_updated_at();

-- =============================================================
-- user_role() helper — SECURITY DEFINER so it can read profiles
-- =============================================================

create or replace function public.user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

-- =============================================================
-- Row Level Security
-- =============================================================

-- ---- profiles ----
alter table profiles enable row level security;

create policy profiles_admin_all on profiles
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy profiles_own_read on profiles
  for select using (id = auth.uid());

-- Allow inserting own profile (for first-login setup)
create policy profiles_own_insert on profiles
  for insert with check (id = auth.uid());

-- ---- students ----
alter table students enable row level security;

create policy students_admin_all on students
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy students_moderator_rw on students
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy students_parent_read on students
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = students.id and g.user_id = auth.uid()
    )
  );

-- ---- guardians ----
alter table guardians enable row level security;

create policy guardians_admin_all on guardians
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy guardians_moderator_read on guardians
  for select using (public.user_role() = 'moderator');

create policy guardians_parent_read on guardians
  for select using (
    public.user_role() = 'parent'
    and (
      user_id = auth.uid()
      or exists (
        select 1 from student_guardians sg
        join guardians g2 on g2.id = sg.guardian_id
        join student_guardians sg2 on sg2.student_id = sg.student_id
        where g2.user_id = auth.uid() and sg2.guardian_id = guardians.id
      )
    )
  );

-- ---- student_guardians ----
alter table student_guardians enable row level security;

create policy sg_admin_all on student_guardians
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy sg_moderator_read on student_guardians
  for select using (public.user_role() = 'moderator');

create policy sg_parent_read on student_guardians
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from guardians g
      where g.id = student_guardians.guardian_id and g.user_id = auth.uid()
    )
  );

-- ---- courses ----
alter table courses enable row level security;

create policy courses_admin_all on courses
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy courses_moderator_rw on courses
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy courses_parent_read on courses
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = courses.student_id and g.user_id = auth.uid()
    )
  );

-- ---- grades ----
alter table grades enable row level security;

create policy grades_admin_all on grades
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy grades_moderator_rw on grades
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy grades_parent_read on grades
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = grades.student_id and g.user_id = auth.uid()
    )
  );

-- ---- attendance ----
alter table attendance enable row level security;

create policy attendance_admin_all on attendance
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy attendance_moderator_rw on attendance
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy attendance_parent_read on attendance
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = attendance.student_id and g.user_id = auth.uid()
    )
  );

-- ---- quran_progress ----
alter table quran_progress enable row level security;

create policy quran_admin_all on quran_progress
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy quran_moderator_rw on quran_progress
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy quran_parent_read on quran_progress
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = quran_progress.student_id and g.user_id = auth.uid()
    )
  );

-- ---- payments ----
alter table payments enable row level security;

create policy payments_admin_all on payments
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy payments_moderator_read on payments
  for select using (public.user_role() = 'moderator');

create policy payments_parent_read on payments
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = payments.student_id and g.user_id = auth.uid()
    )
  );

-- ---- settings ----
alter table settings enable row level security;

create policy settings_admin_all on settings
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy settings_moderator_read on settings
  for select using (public.user_role() = 'moderator');

-- ---- notifications ----
alter table notifications enable row level security;

create policy notifications_admin_all on notifications
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy notifications_moderator_read on notifications
  for select using (public.user_role() = 'moderator');

create policy notifications_parent_read on notifications
  for select using (
    public.user_role() = 'parent'
    and exists (
      select 1 from student_guardians sg
      join guardians g on g.id = sg.guardian_id
      where sg.student_id = notifications.student_id and g.user_id = auth.uid()
    )
  );
