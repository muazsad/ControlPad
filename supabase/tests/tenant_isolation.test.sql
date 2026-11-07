-- Behavioural tenant isolation (spec §5). Run: supabase test db  (needs Docker).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Two schools; admin, moderator and parent in each. Fixed ids for readability.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'mod-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000c', 'parent-a@test.local'),
  ('b0000000-0000-0000-0000-00000000000a', 'admin-b@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'mod-b@test.local'),
  ('b0000000-0000-0000-0000-00000000000c', 'parent-b@test.local'),
  ('c0000000-0000-0000-0000-00000000000a', 'archived@test.local');

insert into schools (id, name, sms_name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'School A', 'School A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'School B', 'School B');

insert into profiles (id, role, full_name, school_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Admin A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-00000000000b', 'moderator', 'Mod A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Parent A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000a', 'admin', 'Admin B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000b', 'moderator', 'Mod B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000c', 'parent', 'Parent B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('c0000000-0000-0000-0000-00000000000a', 'admin', 'Old admin', '00000000-0000-0000-0000-000000000001');

insert into settings (school_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000'), ('bbbbbbbb-0000-0000-0000-000000000000');

insert into students (id, first_name, last_name, school_id) values
  ('5a000000-0000-0000-0000-000000000001', 'Amina', 'A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('5b000000-0000-0000-0000-000000000001', 'Bilal', 'B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('5c000000-0000-0000-0000-000000000001', 'Old', 'Student', '00000000-0000-0000-0000-000000000001');

insert into guardians (id, full_name, phone, user_id, school_id) values
  ('6a000000-0000-0000-0000-000000000001', 'Parent A', '+14135550001', 'a0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('6b000000-0000-0000-0000-000000000001', 'Parent B', '+14135550001', 'b0000000-0000-0000-0000-00000000000c', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into student_guardians (student_id, guardian_id, school_id) values
  ('5a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('5b000000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into courses (id, student_id, name, school_id) values
  ('7a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Algebra', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 'Biology', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into grades (course_id, student_id, grade_value, school_id) values
  ('7a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 90, 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 80, 'bbbbbbbb-0000-0000-0000-000000000000');

insert into notifications (recipient_phone, recipient_type, trigger_type, body, school_id) values
  ('+14135550001', 'admin', 'manual_test', 'a', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('+14135550001', 'admin', 'manual_test', 'b', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into school_sms_config (school_id, twilio_account_sid) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ACaaaa'), ('bbbbbbbb-0000-0000-0000-000000000000', 'ACbbbb');

-- Composite FK: a grade can't point at another school's course (as postgres, RLS bypassed).
select throws_ok(
  $$ insert into grades (course_id, student_id, grade_value, school_id)
     values ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 50,
             'aaaaaaaa-0000-0000-0000-000000000000') $$,
  '23503', null, 'composite FK rejects a cross-school grade');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid::text, true);
$$;

set local role authenticated;

-- Admin A
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select is((select count(*) from students)::int, 1, 'admin A sees one student');
select is((select first_name from students), 'Amina', 'admin A sees only school A');
select is((select count(*) from grades)::int, 1, 'admin A sees one grade');
select is((select count(*) from guardians)::int, 1, 'admin A sees one guardian');
select is((select count(*) from notifications)::int, 1, 'admin A sees own notifications');
select is((select count(*) from settings)::int, 1, 'admin A sees one settings row');
select is((select count(*) from schools)::int, 1, 'admin A sees one school');
select is((select count(*) from profiles)::int, 3, 'admin A sees school A profiles only');
select is((select count(*) from school_sms_config)::int, 0, 'sms config is service-only');
select is((select count(*) from platform_admins)::int, 0, 'platform_admins is service-only');
select throws_ok(
  $$ insert into students (first_name, last_name, school_id)
     values ('X', 'Y', 'bbbbbbbb-0000-0000-0000-000000000000') $$,
  '42501', null, 'admin A cannot insert into school B');
select lives_ok(
  $$ insert into students (first_name, last_name) values ('New', 'Student') $$,
  'insert without school_id defaults to admin A''s school');
select is((select school_id from students where first_name = 'New'),
  'aaaaaaaa-0000-0000-0000-000000000000'::uuid, 'default school_id is the current school');
update students set first_name = 'Hacked' where id = '5b000000-0000-0000-0000-000000000001';
select is((select count(*) from students where first_name = 'Hacked')::int, 0, 'admin A cannot update school B rows');
select throws_ok(
  $$ update profiles set school_id = 'bbbbbbbb-0000-0000-0000-000000000000'
     where id = 'a0000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'admin A cannot move a profile to school B');
select throws_ok(
  $$ update schools set archived = true $$,
  '42501', null, 'admins cannot change archived');

-- Moderator B
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select first_name from students), 'Bilal', 'moderator B sees only school B');
select is((select count(*) from grades)::int, 1, 'moderator B sees one grade');

-- Parent B: own child only, and not parent A's same-phone guardian row.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000c');
select is((select count(*) from students)::int, 1, 'parent B sees one child');
select is((select count(*) from guardians)::int, 1, 'parent B sees own guardian row only');

-- Archived-school user sees nothing and has no role.
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
select is((select count(*) from students)::int, 0, 'archived school data is invisible');
select is(public.user_role()::text, null::text, 'archived user has no role');
select is((select count(*) from profiles)::int, 1, 'archived user still reads own profile');

-- Two foreign keys between the same pair of tables make PostgREST refuse
-- embeds like attendance → students(...). Only the composite key may remain.
select is(
  (select count(*)::int from (
     select conrelid, confrelid from pg_constraint
     where contype = 'f' and connamespace = 'public'::regnamespace
     group by conrelid, confrelid, conkey[1] having count(*) > 1
   ) dupes),
  0,
  'no table has two foreign keys to the same parent on the same column'
);

select * from finish();
rollback;
