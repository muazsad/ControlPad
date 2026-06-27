-- Fix recursive parent RLS checks involving student_guardians.
--
-- Policies on students/courses/grades/etc. cannot directly query
-- student_guardians because student_guardians has its own RLS policy.
-- These SECURITY DEFINER helpers run as the function owner and avoid
-- re-entering student_guardians policies while preserving parent scoping.

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
      select 1
      from public.guardians direct_guardian
      where direct_guardian.id = target_guardian_id
        and direct_guardian.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.student_guardians own_link
      join public.guardians own_guardian on own_guardian.id = own_link.guardian_id
      join public.student_guardians target_link
        on target_link.student_id = own_link.student_id
      where own_guardian.user_id = auth.uid()
        and target_link.guardian_id = target_guardian_id
    )
  )
$$;

revoke all on function public.parent_has_student(uuid) from public;
revoke all on function public.parent_can_read_guardian(uuid) from public;
grant execute on function public.parent_has_student(uuid) to authenticated;
grant execute on function public.parent_can_read_guardian(uuid) to authenticated;

drop policy if exists students_parent_read on students;
drop policy if exists guardians_parent_read on guardians;
drop policy if exists sg_parent_read on student_guardians;
drop policy if exists courses_parent_read on courses;
drop policy if exists grades_parent_read on grades;
drop policy if exists attendance_parent_read on attendance;
drop policy if exists quran_parent_read on quran_progress;
drop policy if exists payments_parent_read on payments;
drop policy if exists notifications_parent_read on notifications;

create policy students_parent_read on students
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(students.id)
  );

create policy guardians_parent_read on guardians
  for select using (
    public.user_role() = 'parent'
    and public.parent_can_read_guardian(guardians.id)
  );

create policy sg_parent_read on student_guardians
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(student_guardians.student_id)
  );

create policy courses_parent_read on courses
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(courses.student_id)
  );

create policy grades_parent_read on grades
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(grades.student_id)
  );

create policy attendance_parent_read on attendance
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(attendance.student_id)
  );

create policy quran_parent_read on quran_progress
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(quran_progress.student_id)
  );

create policy payments_parent_read on payments
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(payments.student_id)
  );

create policy notifications_parent_read on notifications
  for select using (
    public.user_role() = 'parent'
    and public.parent_has_student(notifications.student_id)
  );
