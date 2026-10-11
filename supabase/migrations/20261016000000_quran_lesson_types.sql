-- Hifz revision: separate new memorization (sabaq) from recent revision
-- (sabaq para) and old revision (dhor), track which juz a student has
-- memorized, and alert when a memorized juz hasn't been revised.
-- Scope: additive only. Existing rows become 'sabaq'. No existing column or
-- RLS policy is changed; the new table copies quran_progress's policies.

-- ---------------------------------------------------------------
-- Lesson type on quran_progress
-- ---------------------------------------------------------------

create type quran_lesson_type as enum ('sabaq', 'sabaq_para', 'dhor');

alter table quran_progress
  add column lesson_type quran_lesson_type not null default 'sabaq',
  add column juz smallint check (juz between 1 and 30);

create index idx_quran_progress_student_type_date
  on quran_progress(student_id, lesson_type, date);

-- ---------------------------------------------------------------
-- Memorized juz per student
-- ---------------------------------------------------------------

create table student_memorized_juz (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  juz         smallint not null check (juz between 1 and 30),
  marked_at   date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (student_id, juz)
);

alter table student_memorized_juz enable row level security;

-- Same access as quran_progress: admin all, moderator read/write, parent
-- read own children via the existing security-definer helper.
create policy memorized_juz_admin_all on student_memorized_juz
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy memorized_juz_moderator_rw on student_memorized_juz
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy memorized_juz_parent_read on student_memorized_juz
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(student_memorized_juz.student_id)
  );

-- ---------------------------------------------------------------
-- Settings + notification trigger
-- ---------------------------------------------------------------

alter table settings
  add column revision_overdue_school_days integer not null default 21
    check (revision_overdue_school_days between 1 and 180);

-- New enum value (not used elsewhere in this migration).
alter type notification_trigger add value if not exists 'revision_overdue';
