-- Read-only inspection for the Live Classes security migration and optional
-- Calendar sync migration. These statements do not change database objects.

-- First check whether the student page's RPC is installed and callable.
select
  to_regprocedure('public.get_student_live_classes()') as student_live_classes_rpc,
  case
    when to_regprocedure('public.get_student_live_classes()') is null then false
    else has_function_privilege(
      'authenticated',
      to_regprocedure('public.get_student_live_classes()'),
      'EXECUTE'
    )
  end as authenticated_can_call_rpc;

-- Diagnose the class shown in the screenshot (31 October 2026). This read-only
-- matrix reports the database filters that determine whether each registered
-- student in that grade/stream can receive the class from the student RPC.
-- No meeting URLs or student account identifiers are returned.
select
  live.id as live_class_id,
  live.class_date,
  live.start_time,
  live.start_at,
  live.end_at,
  live.title,
  live.teacher_id,
  teacher.id is not null as teacher_profile_exists,
  live.grade as class_grade,
  live.stream as class_stream,
  live.subject_id,
  subject.name as subject_name,
  live.publication_status,
  live.status as class_status,
  student.id as matching_student_profile_id,
  student.grade as student_grade,
  student.stream as student_stream,
  live.publication_status = 'published' as is_published,
  lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
    as status_allows_student_visibility,
  student.grade = live.grade
    and lower(coalesce(student.stream, '')) =
      lower(coalesce(nullif(btrim(live.stream), ''), ''))
    as student_grade_and_stream_match,
  coalesce(subject.grades, '{}'::integer[]) @> array[live.grade]
    as subject_allows_grade,
  live.grade between 5 and 10
    or exists (
      select 1
      from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
      where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
    ) as subject_allows_stream,
  exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = live.teacher_id
      and grade_group.grade = live.grade
      and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
  ) as teacher_has_grade_and_stream,
  exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = live.teacher_id
      and grade_group.grade = live.grade
      and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
      and (
        coalesce(grade_group.teach_all_subjects, false)
        or exists (
          select 1
          from public.teacher_subject_assignments assignment
          where assignment.teacher_id = live.teacher_id
            and assignment.grade = live.grade
            and assignment.stream is not distinct from nullif(btrim(live.stream), '')
            and assignment.subject_id::text = live.subject_id::text
        )
      )
  ) as teacher_has_subject_assignment,
  (
    teacher.id is not null
    and live.publication_status = 'published'
    and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
    and student.grade = live.grade
    and lower(coalesce(student.stream, '')) =
      lower(coalesce(nullif(btrim(live.stream), ''), ''))
    and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
    and (
      student.grade between 5 and 10
      or exists (
        select 1
        from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
        where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
      )
    )
    and exists (
      select 1
      from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = live.teacher_id
        and grade_group.grade = live.grade
        and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
        and (
          coalesce(grade_group.teach_all_subjects, false)
          or exists (
            select 1
            from public.teacher_subject_assignments assignment
            where assignment.teacher_id = live.teacher_id
              and assignment.grade = live.grade
              and assignment.stream is not distinct from nullif(btrim(live.stream), '')
              and assignment.subject_id::text = live.subject_id::text
          )
        )
    )
  ) as would_be_returned_to_student
from public.live_classes live
left join public.teachers teacher on teacher.id = live.teacher_id
left join public.subjects subject on subject.id::text = live.subject_id::text
left join public.students student
  on student.grade = live.grade
 and lower(coalesce(student.stream, '')) =
   lower(coalesce(nullif(btrim(live.stream), ''), ''))
where live.class_date = date '2026-10-31'
order by live.start_time, student.id;

-- Review the five Calendar RLS policies before and after either migration.
select
  policyname,
  roles,
  cmd,
  permissive,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'calendar_events'
order by policyname;

-- Review the Live Classes ownership and student eligibility policies.
select
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'live_classes'
order by policyname;

select
  count(*) as calendar_policy_count,
  array_agg(policyname order by policyname) as calendar_policy_names
from pg_policies
where schemaname = 'public'
  and tablename = 'calendar_events';

-- Review columns, constraints, and indexes that the transactional Live
-- Classes migration could have touched before an error.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'live_classes'
order by ordinal_position;

select
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class relation
  on relation.oid = constraint_row.conrelid
join pg_namespace relation_schema
  on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relname = 'live_classes'
order by constraint_row.conname;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'live_classes'
order by indexname;

-- Inspect the functions and trigger involved. A failed transactional
-- migration should not leave its newly-created functions or triggers behind.
select
  procedure.oid::regprocedure as function_signature,
  procedure.prosecdef as security_definer,
  owner_role.rolname as owner,
  has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    as authenticated_can_execute,
  has_function_privilege('anon', procedure.oid, 'EXECUTE')
    as anon_can_execute
from pg_proc procedure
join pg_namespace procedure_schema
  on procedure_schema.oid = procedure.pronamespace
join pg_roles owner_role
  on owner_role.oid = procedure.proowner
where procedure_schema.nspname = 'public'
  and procedure.proname in (
    'live_class_teacher_scope_valid',
    'live_class_teacher_scope_allowed',
    'live_class_student_can_view',
    'get_student_live_classes',
    'sync_live_class_calendar_event',
    'calendar_student_can_view_event'
  )
order by procedure.proname, procedure.oid::regprocedure::text;

select
  trigger_row.tgname as trigger_name,
  pg_get_triggerdef(trigger_row.oid, true) as definition
from pg_trigger trigger_row
join pg_class relation
  on relation.oid = trigger_row.tgrelid
join pg_namespace relation_schema
  on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relname = 'live_classes'
  and not trigger_row.tgisinternal
  and trigger_row.tgname in (
    'zz_live_classes_calendar_access_sync',
    'live_classes_sync_calendar_event',
    'live_classes_delete_calendar_event',
    'live_classes_normalize_schedule',
    'live_classes_publish_update'
  )
order by trigger_row.tgname;

-- Confirm Calendar table RLS and source uniqueness without changing either.
select
  relation.relrowsecurity as row_level_security_enabled,
  relation.relforcerowsecurity as row_level_security_forced
from pg_class relation
join pg_namespace relation_schema
  on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relname = 'calendar_events';

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'calendar_events'
  and indexdef ilike '%source_table%'
  and indexdef ilike '%source_id%'
order by indexname;

-- Check for duplicate or orphaned live-class source links.
select
  source_table,
  source_id,
  count(*) as event_count
from public.calendar_events
where source_table = 'live_classes'
group by source_table, source_id
having source_id is null or count(*) > 1;

select
  event.id as calendar_event_id,
  event.source_id as live_class_id
from public.calendar_events event
where event.source_table = 'live_classes'
  and not exists (
    select 1
    from public.live_classes live
    where live.id = event.source_id
  );

-- After optional Calendar sync, this should return no rows. It checks the
-- source identity, actual scheduled timestamps, audience attributes, status,
-- visibility flag, and that private meeting URLs were not copied to Calendar.
select
  live.id as live_class_id,
  event.id as calendar_event_id,
  live.teacher_id,
  event.teacher_id as calendar_teacher_id,
  live.grade,
  event.grade as calendar_grade,
  live.stream,
  event.stream as calendar_stream,
  live.subject_id,
  event.subject_id as calendar_subject_id,
  live.start_at,
  event.start_at as calendar_start_at,
  live.end_at,
  event.end_at as calendar_end_at,
  live.publication_status,
  live.status as live_class_status,
  event.status as calendar_status,
  event.is_visible_to_students,
  event.meeting_url
from public.live_classes live
left join public.calendar_events event
  on event.source_table = 'live_classes'
 and event.source_id = live.id
where event.id is null
   or event.teacher_id is distinct from live.teacher_id
   or event.grade is distinct from live.grade
   or event.stream is distinct from live.stream
   or event.subject_id is distinct from live.subject_id
   or event.start_at is distinct from live.start_at
   or event.end_at is distinct from live.end_at
   or event.event_type is distinct from 'live_class'
   or event.meeting_url is not null
   or event.status is distinct from case
        when lower(btrim(live.publication_status)) <> 'published' then 'draft'
        when lower(btrim(live.status)) in ('scheduled', 'live') then 'published'
        when lower(btrim(live.status)) in ('completed', 'missed', 'attended') then 'completed'
        when lower(btrim(live.status)) in ('cancelled', 'canceled') then 'cancelled'
      end
   or event.is_visible_to_students is distinct from (
        lower(btrim(live.publication_status)) = 'published'
        and lower(btrim(live.status)) in ('scheduled', 'live')
      )
order by live.start_at, live.id;

-- Review teacher-profile existence and registered teacher-scope eligibility.
-- Teacher ownership itself is enforced by the RLS policies shown above.
select
  live.id as live_class_id,
  live.teacher_id,
  live.grade,
  live.stream,
  live.subject_id,
  exists (
    select 1
    from public.teachers teacher
    where teacher.id = live.teacher_id
  ) as teacher_profile_exists,
  public.live_class_teacher_scope_valid(
    live.teacher_id,
    live.grade,
    live.stream,
    live.subject_id::text
  ) as teacher_scope_is_valid
from public.live_classes live
where not exists (
  select 1
  from public.teachers teacher
  where teacher.id = live.teacher_id
)
or not public.live_class_teacher_scope_valid(
    live.teacher_id, live.grade, live.stream, live.subject_id::text
  );
