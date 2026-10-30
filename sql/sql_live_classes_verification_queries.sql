-- Read-only schema inspection.
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'live_classes',
    'teachers',
    'teacher_grade_groups',
    'teacher_subject_assignments',
    'students',
    'subjects',
    'calendar_events',
    'live_class_updates'
  )
order by table_name, ordinal_position;

-- Foreign keys, indexes, and RLS policies for the live-class boundary.
select
  relation.relname as table_name,
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class relation on relation.oid = constraint_row.conrelid
join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relname in ('live_classes', 'live_class_updates')
order by relation.relname, constraint_row.conname;

select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('live_classes', 'live_class_updates')
order by tablename, indexname;

select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('live_classes', 'live_class_updates', 'calendar_events')
order by tablename, policyname;

-- Access matrix: true means that the database eligibility predicates permit
-- this registered student to see this published class. No meeting links are returned.
select
  student.id as student_id,
  student.grade as student_grade,
  student.stream as student_stream,
  live.id as live_class_id,
  live.grade as class_grade,
  live.stream as class_stream,
  subject.name as subject,
  live.publication_status,
  live.status,
  (
    live.publication_status = 'published'
    and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
    and live.grade::integer = student.grade
    and lower(coalesce(live.stream, '')) = lower(coalesce(student.stream, ''))
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
      from public.teachers teacher
      join public.teacher_grade_groups grade_group
        on grade_group.teacher_id = teacher.id
      where teacher.id = live.teacher_id
        and grade_group.grade = live.grade::integer
        and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
        and (
          coalesce(grade_group.teach_all_subjects, false)
          or exists (
            select 1
            from public.teacher_subject_assignments assignment
            where assignment.teacher_id = teacher.id
              and assignment.grade = live.grade::integer
              and assignment.stream is not distinct from nullif(btrim(live.stream), '')
              and assignment.subject_id::text = live.subject_id::text
          )
        )
    )
  ) as would_be_visible
from public.students student
cross join public.live_classes live
join public.subjects subject on subject.id::text = live.subject_id::text
order by student.grade, student.stream, live.class_date, live.start_time;

-- Should return no rows after migration: published classes lacking a valid
-- teacher/subject, schedule, scope, or meeting details.
select
  live.id as live_class_id,
  live.teacher_id,
  live.grade,
  live.stream,
  live.subject_id,
  live.class_date,
  live.start_time,
  live.end_time,
  live.publication_status,
  live.status
from public.live_classes live
where live.grade is null
   or live.subject_id is null
   or live.class_date is null
   or live.start_time is null
   or live.start_at is null
   or live.end_at is null
   or not exists (
     select 1 from public.teachers teacher where teacher.id = live.teacher_id
   )
   or (
     live.publication_status = 'published'
     and (
       nullif(btrim(live.meeting_platform), '') is null
       or live.meeting_url !~* '^https://[[:alnum:]][^[:space:]]*$'
     )
   );

-- Should return no rows: teacher rows outside their registered grade, stream,
-- subject assignment / teach-all scope, or the subject's own eligibility.
select
  live.id as live_class_id,
  live.teacher_id,
  live.grade,
  live.stream,
  live.subject_id
from public.live_classes live
join public.subjects subject on subject.id::text = live.subject_id::text
where not exists (
  select 1
  from public.teachers teacher
  join public.teacher_grade_groups grade_group
    on grade_group.teacher_id = teacher.id
  where teacher.id = live.teacher_id
    and grade_group.grade = live.grade::integer
    and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
    and coalesce(subject.grades, '{}'::integer[]) @> array[live.grade::integer]
    and (
      live.grade::integer between 5 and 10
      or exists (
        select 1
        from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
        where lower(btrim(allowed_stream.stream)) = lower(btrim(live.stream))
      )
    )
    and (
      coalesce(grade_group.teach_all_subjects, false)
      or exists (
        select 1
        from public.teacher_subject_assignments assignment
        where assignment.teacher_id = teacher.id
          and assignment.grade = live.grade::integer
          and assignment.stream is not distinct from nullif(btrim(live.stream), '')
          and assignment.subject_id::text = live.subject_id::text
      )
    )
);

-- Should return no rows: duplicate Calendar entries for the same live class.
select source_table, source_id, count(*) as event_count
from public.calendar_events
where source_table = 'live_classes'
group by source_table, source_id
having count(*) > 1;

-- Meeting-link exposure checks. The authenticated student role must not have
-- column-level SELECT on live_classes.meeting_url, and live-class Calendar
-- rows must not retain a copy of the private meeting URL.
select
  table_name,
  column_name,
  grantee,
  privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and column_name = 'meeting_url'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee;

select id, source_id
from public.calendar_events
where source_table = 'live_classes'
  and meeting_url is not null;

-- Review any exposed view or materialized view whose definition references a
-- live-class meeting URL.
select
  relation_schema.nspname as schema_name,
  relation.relname as relation_name,
  relation.relkind as relation_kind,
  has_table_privilege('anon', relation.oid, 'select') as anon_can_select,
  has_table_privilege('authenticated', relation.oid, 'select') as authenticated_can_select,
  pg_get_viewdef(relation.oid, true) as definition
from pg_class relation
join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relkind in ('v', 'm')
  and pg_get_viewdef(relation.oid, true) ilike '%live_classes%'
  and pg_get_viewdef(relation.oid, true) ilike '%meeting_url%'
order by relation.relname;

-- Review callable RPCs that reference meeting_url, including their execution
-- grants and SECURITY DEFINER status.
select
  procedure.oid::regprocedure as function_signature,
  procedure.prosecdef as security_definer,
  has_function_privilege('anon', procedure.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_can_execute
from pg_proc procedure
join pg_namespace procedure_schema on procedure_schema.oid = procedure.pronamespace
where procedure_schema.nspname = 'public'
  and procedure.prokind = 'f'
  and pg_get_functiondef(procedure.oid) ilike '%meeting_url%'
order by procedure.proname;
