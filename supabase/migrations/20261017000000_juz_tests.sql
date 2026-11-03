-- Juz tests: while a student is being tested on a juz, they aren't expected
-- to do sabaq, sabaq para or dhor. A test is open (finished_on is null) from
-- "Start juz test" until staff click "Finish"; finishing marks the juz
-- memorized (done in the app, not here).
-- Scope: additive only. RLS copies student_memorized_juz / quran_progress.

create table juz_tests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  juz          smallint not null check (juz between 1 and 30),
  started_on   date not null default current_date,
  finished_on  date,
  started_by   uuid references auth.users(id),
  finished_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  check (finished_on is null or finished_on >= started_on)
);

-- At most one open test per student.
create unique index juz_tests_one_open_per_student
  on juz_tests(student_id) where finished_on is null;

create index idx_juz_tests_student on juz_tests(student_id, started_on);

alter table juz_tests enable row level security;

create policy juz_tests_admin_all on juz_tests
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy juz_tests_moderator_rw on juz_tests
  for all using (public.user_role() = 'moderator')
  with check (public.user_role() = 'moderator');

create policy juz_tests_parent_read on juz_tests
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(juz_tests.student_id)
  );
