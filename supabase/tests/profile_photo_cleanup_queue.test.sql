begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select is(
  (select object_path
   from public.parse_profile_photo_cleanup_reference(
     'a1603952-e84a-4a82-bf11-2b12ba8f89f9/profile-1732200000000.jpg',
     'teacher-profile-images',
     'a1603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  'a1603952-e84a-4a82-bf11-2b12ba8f89f9/profile-1732200000000.jpg',
  'teacher object paths are preserved exactly'
);

select is(
  (select object_path
   from public.parse_profile_photo_cleanup_reference(
     'b2603952-e84a-4a82-bf11-2b12ba8f89f9/profile-unique.png',
     'student-profile-images',
     'b2603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  'b2603952-e84a-4a82-bf11-2b12ba8f89f9/profile-unique.png',
  'student object paths are preserved exactly'
);

select is(
  (select object_path
   from public.parse_profile_photo_cleanup_reference(
     'https://example-project.supabase.co/storage/v1/object/public/teacher-profile-images/a1603952-e84a-4a82-bf11-2b12ba8f89f9/profile-1.webp',
     'teacher-profile-images',
     'a1603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  'a1603952-e84a-4a82-bf11-2b12ba8f89f9/profile-1.webp',
  'teacher Storage URLs yield their exact object key'
);

select is(
  (select source_origin
   from public.parse_profile_photo_cleanup_reference(
     'https://example-project.supabase.co/storage/v1/object/sign/student-profile-images/b2603952-e84a-4a82-bf11-2b12ba8f89f9/profile-2.png?token=redacted',
     'student-profile-images',
     'b2603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  'https://example-project.supabase.co',
  'signed URLs retain only the origin, not their token'
);

select is(
  (select object_path
   from public.parse_profile_photo_cleanup_reference(
     'https://example-project.supabase.co/storage/v1/object/public/student-profile-images/b2603952-e84a-4a82-bf11-2b12ba8f89f9/profile-3.gif',
     'student-profile-images',
     'b2603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  'b2603952-e84a-4a82-bf11-2b12ba8f89f9/profile-3.gif',
  'student Storage URLs yield their exact object key'
);

select is(
  (select source_origin
   from public.parse_profile_photo_cleanup_reference(
     'a1603952-e84a-4a82-bf11-2b12ba8f89f9/profile-4.jpg',
     'teacher-profile-images',
     'a1603952-e84a-4a82-bf11-2b12ba8f89f9'
   )),
  null::text,
  'path-only references have no URL origin'
);

select is(
  (select count(*)::integer
   from pg_constraint
   where conrelid = 'public.teachers'::regclass
     and confrelid = 'auth.users'::regclass
     and contype = 'f'
     and confdeltype = 'c'),
  1,
  'Teacher profile has an Auth-user cascade'
);

select is(
  (select count(*)::integer
   from pg_constraint
   where conrelid = 'public.students'::regclass
     and confrelid = 'auth.users'::regclass
     and contype = 'f'
     and confdeltype = 'c'),
  1,
  'Student profile has an Auth-user cascade'
);

select is(
  (select count(*)::integer
   from pg_trigger
   where tgrelid = 'public.teachers'::regclass
     and tgname = 'teachers_profile_photo_cleanup_before_delete'
     and not tgisinternal),
  1,
  'Teacher profile cleanup trigger is installed'
);

select is(
  (select count(*)::integer
   from pg_trigger
   where tgrelid = 'public.students'::regclass
     and tgname = 'students_profile_photo_cleanup_before_delete'
     and not tgisinternal),
  1,
  'Student profile cleanup trigger is installed'
);

select is(
  has_function_privilege(
    'anon',
    'public.verify_profile_photo_cleanup_invocation_secret(text)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot validate the invocation secret'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.verify_profile_photo_cleanup_invocation_secret(text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot validate the invocation secret'
);

select is(
  has_function_privilege(
    'service_role',
    'public.verify_profile_photo_cleanup_invocation_secret(text)',
    'EXECUTE'
  ),
  true,
  'only the service role can validate the invocation secret'
);

select is(
  has_table_privilege('anon', 'public.profile_photo_cleanup_queue', 'SELECT'),
  false,
  'anonymous callers cannot read the cleanup queue'
);

select is(
  has_table_privilege('authenticated', 'public.profile_photo_cleanup_queue', 'SELECT'),
  false,
  'authenticated users cannot read the cleanup queue'
);

select is(
  has_table_privilege('service_role', 'public.profile_photo_cleanup_queue', 'SELECT'),
  false,
  'service role uses guarded RPCs instead of direct queue access'
);

select is(
  has_function_privilege(
    'anon',
    'public.claim_profile_photo_cleanup_batch(integer)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot claim cleanup jobs'
);

select is(
  has_function_privilege(
    'service_role',
    'public.claim_profile_photo_cleanup_batch(integer)',
    'EXECUTE'
  ),
  true,
  'service role can claim cleanup jobs'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.verify_profile_photo_cleanup_invocation_secret(
    'not-the-configured-cleanup-secret-used-only-in-this-test'
  ),
  false,
  'an incorrect invocation secret is rejected without returning the configured value'
);
reset role;

create temporary table profile_photo_cleanup_test_users (
  label text primary key,
  user_id uuid not null unique
) on commit drop;

insert into pg_temp.profile_photo_cleanup_test_users (label, user_id)
values
  ('teacher-direct', gen_random_uuid()),
  ('student-direct', gen_random_uuid()),
  ('teacher-cascade', gen_random_uuid()),
  ('student-cascade', gen_random_uuid()),
  ('teacher-rollback', gen_random_uuid()),
  ('student-no-photo', gen_random_uuid());

insert into auth.users (id)
select user_id
from pg_temp.profile_photo_cleanup_test_users;

create temporary table profile_photo_cleanup_test_expected (
  label text primary key,
  source_table text not null,
  profile_id uuid not null unique,
  user_id uuid not null unique,
  object_path text
) on commit drop;

insert into pg_temp.profile_photo_cleanup_test_expected (
  label,
  source_table,
  profile_id,
  user_id,
  object_path
)
select
  users.label,
  case when users.label like 'teacher-%' then 'teachers' else 'students' end,
  gen_random_uuid(),
  users.user_id,
  case
    when users.label = 'student-no-photo' then null
    else users.user_id::text || '/test-profile-photo.png'
  end
from pg_temp.profile_photo_cleanup_test_users as users;

create temporary table profile_photo_cleanup_test_teachers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_photo_url text
) on commit drop;

create temporary table profile_photo_cleanup_test_students (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_photo_url text
) on commit drop;

create trigger test_teacher_photo_cleanup_before_delete
before delete on pg_temp.profile_photo_cleanup_test_teachers
for each row
execute function public.capture_teacher_profile_photo_before_delete();

create trigger test_student_photo_cleanup_before_delete
before delete on pg_temp.profile_photo_cleanup_test_students
for each row
execute function public.capture_student_profile_photo_before_delete();

insert into pg_temp.profile_photo_cleanup_test_teachers (id, user_id, profile_photo_url)
select profile_id, user_id, object_path
from pg_temp.profile_photo_cleanup_test_expected
where source_table = 'teachers';

insert into pg_temp.profile_photo_cleanup_test_students (id, user_id, profile_photo_url)
select profile_id, user_id, object_path
from pg_temp.profile_photo_cleanup_test_expected
where source_table = 'students';

delete from pg_temp.profile_photo_cleanup_test_teachers
where id = (
  select profile_id
  from pg_temp.profile_photo_cleanup_test_expected
  where label = 'teacher-direct'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'teacher-direct'
     and queue.source_table = 'teachers'
     and queue.user_id = expected.user_id
     and queue.bucket_id = 'teacher-profile-images'
     and queue.object_path = expected.object_path),
  1,
  'direct Teacher row deletion queues exactly its own object'
);

delete from pg_temp.profile_photo_cleanup_test_students
where id = (
  select profile_id
  from pg_temp.profile_photo_cleanup_test_expected
  where label = 'student-direct'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'student-direct'
     and queue.source_table = 'students'
     and queue.user_id = expected.user_id
     and queue.bucket_id = 'student-profile-images'
     and queue.object_path = expected.object_path),
  1,
  'direct Student row deletion queues exactly its own object'
);

delete from auth.users
where id = (
  select user_id
  from pg_temp.profile_photo_cleanup_test_users
  where label = 'teacher-cascade'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'teacher-cascade'
     and queue.source_table = 'teachers'
     and queue.user_id = expected.user_id
     and queue.bucket_id = 'teacher-profile-images'
     and queue.object_path = expected.object_path),
  1,
  'Auth-user deletion cascade queues the Teacher object'
);

delete from auth.users
where id = (
  select user_id
  from pg_temp.profile_photo_cleanup_test_users
  where label = 'student-cascade'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'student-cascade'
     and queue.source_table = 'students'
     and queue.user_id = expected.user_id
     and queue.bucket_id = 'student-profile-images'
     and queue.object_path = expected.object_path),
  1,
  'Auth-user deletion cascade queues the Student object'
);

delete from pg_temp.profile_photo_cleanup_test_students
where id = (
  select profile_id
  from pg_temp.profile_photo_cleanup_test_expected
  where label = 'student-no-photo'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'student-no-photo'),
  0,
  'deleting a profile with no image does not enqueue work'
);

savepoint profile_photo_cleanup_rollback;

delete from pg_temp.profile_photo_cleanup_test_teachers
where id = (
  select profile_id
  from pg_temp.profile_photo_cleanup_test_expected
  where label = 'teacher-rollback'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'teacher-rollback'),
  1,
  'queue work is inserted in the profile deletion transaction'
);

rollback to savepoint profile_photo_cleanup_rollback;

select is(
  (select count(*)::integer
   from pg_temp.profile_photo_cleanup_test_teachers as profile
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = profile.id
   where expected.label = 'teacher-rollback'),
  1,
  'rolling back the profile deletion restores the profile row'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'teacher-rollback'),
  0,
  'rolling back the profile deletion removes its queued cleanup'
);

delete from pg_temp.profile_photo_cleanup_test_teachers
where id = (
  select profile_id
  from pg_temp.profile_photo_cleanup_test_expected
  where label = 'teacher-rollback'
);

select is(
  (select count(*)::integer
   from public.profile_photo_cleanup_queue as queue
   join pg_temp.profile_photo_cleanup_test_expected as expected
     on expected.profile_id = queue.source_row_id
   where expected.label = 'teacher-rollback'),
  1,
  'a committed retry creates exactly one cleanup job'
);

select * from finish();

rollback;
