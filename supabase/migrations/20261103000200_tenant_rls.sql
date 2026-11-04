-- Multi-tenancy, step 3 of 4 (spec §4–6). Every policy is recreated with
-- school_id = current_school_id(). Role rules are unchanged from DATA_MODEL.md.

begin;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.school_id = public.current_school_id()
$$;

create or replace function public.parent_has_student(target_student_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.user_role() = 'parent'
  and exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = target_student_id
      and g.user_id = auth.uid()
      and sg.school_id = public.current_school_id()
  )
$$;

create or replace function public.parent_can_read_guardian(target_guardian_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.user_role() = 'parent'
  and (
    exists (
      select 1 from public.guardians direct_guardian
      where direct_guardian.id = target_guardian_id
        and direct_guardian.user_id = auth.uid()
        and direct_guardian.school_id = public.current_school_id()
    )
    or exists (
      select 1
      from public.student_guardians own_link
      join public.guardians own_guardian on own_guardian.id = own_link.guardian_id
      join public.student_guardians target_link on target_link.student_id = own_link.student_id
      where own_guardian.user_id = auth.uid()
        and target_link.guardian_id = target_guardian_id
        and own_link.school_id = public.current_school_id()
    )
  )
$$;

-- ── create_school(): onboarding (spec §6) ────────────────────────────────────

create or replace function public.create_school(
  p_name text, p_sms_name text, p_time_zone text, p_full_name text, p_phone text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_school uuid;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.current_school_id() is not null then
    raise exception 'This account already belongs to a school.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'School name must be 2–80 characters.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Your name is required.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'Unknown time zone.' using errcode = 'P0001';
  end if;

  insert into schools (name, sms_name, time_zone, created_by)
  values (trim(p_name), coalesce(nullif(trim(p_sms_name), ''), trim(p_name)), p_time_zone, v_user)
  returning id into v_school;

  insert into settings (school_id) values (v_school);
  insert into school_weekly_patterns (school_id) values (v_school);
  insert into school_sms_config (school_id) values (v_school);

  insert into profiles (id, role, full_name, phone, school_id)
  values (v_user, 'admin', trim(p_full_name), nullif(trim(p_phone), ''), v_school)
  on conflict (id) do update
    set role = 'admin', full_name = excluded.full_name, phone = excluded.phone,
        school_id = excluded.school_id;

  return v_school;
end
$$;

revoke all on function public.create_school(text, text, text, text, text) from public, anon;
grant execute on function public.create_school(text, text, text, text, text) to authenticated;

-- ── schools ──────────────────────────────────────────────────────────────────

create policy schools_member_read on schools
  for select using (id = public.current_school_id());
create policy schools_admin_update on schools
  for update using (id = public.current_school_id() and public.user_role() = 'admin')
  with check (id = public.current_school_id() and public.user_role() = 'admin');

-- Admins may only change these columns (not archived / created_by).
revoke update on schools from authenticated;
grant update (name, sms_name, time_zone) on schools to authenticated;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- profiles_own_insert is removed: it let any user insert their own profile with
-- any role. Profiles are now created only by create_school() or by an admin.

drop policy if exists profiles_own_insert on profiles;
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
-- profiles_own_read (id = auth.uid()) is kept as is: a user must read their own
-- row even before they have a school.
create policy profiles_moderator_read_staff on profiles
  for select using (
    school_id = public.current_school_id()
    and public.user_role() = 'moderator'
    and role in ('admin', 'moderator')
  );

-- ── Student data: admin all, moderator read+write, parent read own children ──

drop policy if exists students_admin_all on students;
drop policy if exists students_moderator_rw on students;
drop policy if exists students_parent_read on students;
create policy students_admin_all on students
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy students_moderator_rw on students
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy students_parent_read on students
  for select using (school_id = public.current_school_id() and public.parent_has_student(students.id));

drop policy if exists courses_admin_all on courses;
drop policy if exists courses_moderator_rw on courses;
drop policy if exists courses_parent_read on courses;
create policy courses_admin_all on courses
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy courses_moderator_rw on courses
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy courses_parent_read on courses
  for select using (school_id = public.current_school_id() and public.parent_has_student(courses.student_id));

drop policy if exists grades_admin_all on grades;
drop policy if exists grades_moderator_rw on grades;
drop policy if exists grades_parent_read on grades;
create policy grades_admin_all on grades
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy grades_moderator_rw on grades
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy grades_parent_read on grades
  for select using (school_id = public.current_school_id() and public.parent_has_student(grades.student_id));

drop policy if exists attendance_admin_all on attendance;
drop policy if exists attendance_moderator_rw on attendance;
drop policy if exists attendance_parent_read on attendance;
create policy attendance_admin_all on attendance
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy attendance_moderator_rw on attendance
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy attendance_parent_read on attendance
  for select using (school_id = public.current_school_id() and public.parent_has_student(attendance.student_id));

drop policy if exists quran_admin_all on quran_progress;
drop policy if exists quran_moderator_rw on quran_progress;
drop policy if exists quran_parent_read on quran_progress;
create policy quran_admin_all on quran_progress
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy quran_moderator_rw on quran_progress
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy quran_parent_read on quran_progress
  for select using (school_id = public.current_school_id() and public.parent_has_student(quran_progress.student_id));

drop policy if exists memorized_juz_admin_all on student_memorized_juz;
drop policy if exists memorized_juz_moderator_rw on student_memorized_juz;
drop policy if exists memorized_juz_parent_read on student_memorized_juz;
create policy memorized_juz_admin_all on student_memorized_juz
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy memorized_juz_moderator_rw on student_memorized_juz
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy memorized_juz_parent_read on student_memorized_juz
  for select using (school_id = public.current_school_id() and public.parent_has_student(student_memorized_juz.student_id));

-- juz_tests (PR #7): same three policies, only if the table exists. The policy
-- names must match the ones PR #7's migration created (check that file).
do $$
begin
  if to_regclass('public.juz_tests') is not null then
    execute 'drop policy if exists juz_tests_admin_all on juz_tests';
    execute 'drop policy if exists juz_tests_moderator_rw on juz_tests';
    execute 'drop policy if exists juz_tests_parent_read on juz_tests';
    execute $p$create policy juz_tests_admin_all on juz_tests
      for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
      with check (school_id = public.current_school_id() and public.user_role() = 'admin')$p$;
    execute $p$create policy juz_tests_moderator_rw on juz_tests
      for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
      with check (school_id = public.current_school_id() and public.user_role() = 'moderator')$p$;
    execute $p$create policy juz_tests_parent_read on juz_tests
      for select using (school_id = public.current_school_id() and public.parent_has_student(juz_tests.student_id))$p$;
  end if;
end $$;

-- ── Guardians / links: admin all, moderator read, parent own ─────────────────

drop policy if exists guardians_admin_all on guardians;
drop policy if exists guardians_moderator_read on guardians;
drop policy if exists guardians_parent_read on guardians;
create policy guardians_admin_all on guardians
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy guardians_moderator_read on guardians
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy guardians_parent_read on guardians
  for select using (school_id = public.current_school_id() and public.parent_can_read_guardian(guardians.id));

drop policy if exists sg_admin_all on student_guardians;
drop policy if exists sg_moderator_read on student_guardians;
drop policy if exists sg_parent_read on student_guardians;
create policy sg_admin_all on student_guardians
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy sg_moderator_read on student_guardians
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy sg_parent_read on student_guardians
  for select using (school_id = public.current_school_id() and public.parent_has_student(student_guardians.student_id));

-- ── Payments: admin all, moderator read, parent own children ─────────────────

drop policy if exists payments_admin_all on payments;
drop policy if exists payments_moderator_read on payments;
drop policy if exists payments_parent_read on payments;
create policy payments_admin_all on payments
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy payments_moderator_read on payments
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy payments_parent_read on payments
  for select using (school_id = public.current_school_id() and public.parent_has_student(payments.student_id));

-- ── Notifications: admin all, moderator read, parent own children ────────────

drop policy if exists notifications_admin_all on notifications;
drop policy if exists notifications_moderator_read on notifications;
drop policy if exists notifications_parent_read on notifications;
create policy notifications_admin_all on notifications
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy notifications_moderator_read on notifications
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy notifications_parent_read on notifications
  for select using (school_id = public.current_school_id() and public.parent_has_student(notifications.student_id));

-- ── Settings: admin all, moderator read ──────────────────────────────────────

drop policy if exists settings_admin_all on settings;
drop policy if exists settings_moderator_read on settings;
create policy settings_admin_all on settings
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy settings_moderator_read on settings
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');

-- ── Calendar + schedule groups: admin all, moderator read, parent read ───────

drop policy if exists school_weekly_patterns_admin_all on school_weekly_patterns;
drop policy if exists school_weekly_patterns_moderator_read on school_weekly_patterns;
drop policy if exists school_weekly_patterns_parent_read on school_weekly_patterns;
create policy school_weekly_patterns_admin_all on school_weekly_patterns
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_weekly_patterns_moderator_read on school_weekly_patterns
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_weekly_patterns_parent_read on school_weekly_patterns
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists school_breaks_admin_all on school_breaks;
drop policy if exists school_breaks_moderator_read on school_breaks;
drop policy if exists school_breaks_parent_read on school_breaks;
create policy school_breaks_admin_all on school_breaks
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_breaks_moderator_read on school_breaks
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_breaks_parent_read on school_breaks
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists school_special_days_admin_all on school_special_days;
drop policy if exists school_special_days_moderator_read on school_special_days;
drop policy if exists school_special_days_parent_read on school_special_days;
create policy school_special_days_admin_all on school_special_days
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_special_days_moderator_read on school_special_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_special_days_parent_read on school_special_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists schedule_groups_admin_all on schedule_groups;
drop policy if exists schedule_groups_moderator_read on schedule_groups;
drop policy if exists schedule_groups_parent_read on schedule_groups;
create policy schedule_groups_admin_all on schedule_groups
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy schedule_groups_moderator_read on schedule_groups
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy schedule_groups_parent_read on schedule_groups
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists schedule_group_days_admin_all on schedule_group_days;
drop policy if exists schedule_group_days_moderator_read on schedule_group_days;
drop policy if exists schedule_group_days_parent_read on schedule_group_days;
create policy schedule_group_days_admin_all on schedule_group_days
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy schedule_group_days_moderator_read on schedule_group_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy schedule_group_days_parent_read on schedule_group_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

-- ── Incoming texts, absence reports, announcements ───────────────────────────

drop policy if exists inbound_messages_admin_read on inbound_messages;
create policy inbound_messages_admin_read on inbound_messages
  for select using (school_id = public.current_school_id() and public.user_role() = 'admin');

drop policy if exists absence_reports_admin_all on absence_reports;
drop policy if exists absence_reports_moderator_read on absence_reports;
create policy absence_reports_admin_all on absence_reports
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy absence_reports_moderator_read on absence_reports
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');

drop policy if exists announcements_admin_all on announcements;
create policy announcements_admin_all on announcements
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');

commit;
