-- Multi-tenancy, step 2 of 4 (spec §3.2–3.5). Adds school_id everywhere,
-- backfills pre-tenancy rows into the archive school, then locks it down.

begin;

-- 1. Columns (nullable for the backfill).
alter table students              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table guardians             add column if not exists school_id uuid references schools(id) on delete cascade;
alter table student_guardians     add column if not exists school_id uuid references schools(id) on delete cascade;
alter table courses               add column if not exists school_id uuid references schools(id) on delete cascade;
alter table grades                add column if not exists school_id uuid references schools(id) on delete cascade;
alter table attendance            add column if not exists school_id uuid references schools(id) on delete cascade;
alter table quran_progress        add column if not exists school_id uuid references schools(id) on delete cascade;
alter table student_memorized_juz add column if not exists school_id uuid references schools(id) on delete cascade;
alter table payments              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table notifications         add column if not exists school_id uuid references schools(id) on delete cascade;
alter table settings              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_weekly_patterns add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_breaks         add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_special_days   add column if not exists school_id uuid references schools(id) on delete cascade;
alter table schedule_groups       add column if not exists school_id uuid references schools(id) on delete cascade;
alter table schedule_group_days   add column if not exists school_id uuid references schools(id) on delete cascade;
alter table inbound_messages      add column if not exists school_id uuid references schools(id) on delete cascade;
alter table absence_reports       add column if not exists school_id uuid references schools(id) on delete cascade;
alter table announcements         add column if not exists school_id uuid references schools(id) on delete cascade;

-- 2. Backfill + not null + default, for each table above.
do $$
declare
  t text;
  archive constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'students','guardians','student_guardians','courses','grades','attendance',
    'quran_progress','student_memorized_juz','payments','notifications','settings',
    'school_weekly_patterns','school_breaks','school_special_days','schedule_groups',
    'schedule_group_days','inbound_messages','absence_reports','announcements'
  ] loop
    execute format('update public.%I set school_id = %L where school_id is null', t, archive);
    execute format('alter table public.%I alter column school_id set not null', t);
    execute format('alter table public.%I alter column school_id set default public.current_school_id()', t);
    execute format('create index if not exists %I on public.%I (school_id)', t || '_school_id_idx', t);
  end loop;
end $$;

-- 3. juz_tests (PR #7). If it exists, give it the same treatment. If PR #7 merges
--    AFTER this migration has run, its own migration must add school_id, the
--    composite FK and the school-checked policies instead.
do $$
begin
  if to_regclass('public.juz_tests') is not null then
    alter table juz_tests add column if not exists school_id uuid references schools(id) on delete cascade;
    update juz_tests set school_id = '00000000-0000-0000-0000-000000000001' where school_id is null;
    alter table juz_tests alter column school_id set not null;
    alter table juz_tests alter column school_id set default public.current_school_id();
    create index if not exists juz_tests_school_id_idx on juz_tests (school_id);
  end if;
end $$;

-- 4. Parent keys for composite FKs.
alter table students        add constraint students_id_school_key        unique (id, school_id);
alter table guardians       add constraint guardians_id_school_key       unique (id, school_id);
alter table courses         add constraint courses_id_school_key         unique (id, school_id);
alter table schedule_groups add constraint schedule_groups_id_school_key unique (id, school_id);
alter table inbound_messages add constraint inbound_messages_id_school_key unique (id, school_id);

-- 5. Composite FKs: a child row's school must match its parent's.
alter table student_guardians
  add constraint student_guardians_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint student_guardians_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete cascade;
alter table courses
  add constraint courses_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table grades
  add constraint grades_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint grades_course_school_fkey
    foreign key (course_id, school_id) references courses (id, school_id) on delete cascade;
alter table attendance
  add constraint attendance_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table quran_progress
  add constraint quran_progress_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table student_memorized_juz
  add constraint student_memorized_juz_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table payments
  add constraint payments_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table absence_reports
  add constraint absence_reports_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint absence_reports_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete set null (guardian_id),
  add constraint absence_reports_inbound_school_fkey
    foreign key (inbound_message_id, school_id) references inbound_messages (id, school_id)
    on delete set null (inbound_message_id);
alter table inbound_messages
  add constraint inbound_messages_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete set null (guardian_id);
alter table notifications
  add constraint notifications_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete set null (student_id);
alter table students
  add constraint students_group_school_fkey
    foreign key (schedule_group_id, school_id) references schedule_groups (id, school_id)
    on delete set null (schedule_group_id);
alter table schedule_group_days
  add constraint schedule_group_days_group_school_fkey
    foreign key (group_id, school_id) references schedule_groups (id, school_id) on delete cascade;

do $$
begin
  if to_regclass('public.juz_tests') is not null then
    alter table juz_tests
      add constraint juz_tests_student_school_fkey
        foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
  end if;
end $$;

-- 6. Single-row tables become one row per school (spec §3.3).
alter table settings drop constraint if exists settings_pkey;
alter table settings drop constraint if exists settings_id_check;
alter table settings add primary key (school_id);

alter table school_weekly_patterns drop constraint if exists school_weekly_patterns_pkey;
alter table school_weekly_patterns drop constraint if exists school_weekly_patterns_id_check;
alter table school_weekly_patterns add primary key (school_id);

-- 7. Uniques that become per school (spec §3.4).
alter table schedule_groups drop constraint if exists schedule_groups_name_key;
alter table schedule_groups add constraint schedule_groups_school_name_key unique (school_id, name);

alter table school_special_days drop constraint if exists school_special_days_pkey;
alter table school_special_days add primary key (school_id, date);

commit;
