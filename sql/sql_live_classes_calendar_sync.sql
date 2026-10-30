-- Optional Calendar integration. Run after the Live Classes security migration
-- and after the existing Calendar schema, five RLS policies, and student
-- access helper are installed. This migration does not create, drop, or alter
-- Calendar policies or modify the Calendar table schema.
begin;

do $$
declare
  required_column record;
  student_policy text;
  teacher_policy text;
  access_function record;
begin
  if to_regclass('public.live_classes') is null
    or to_regclass('public.calendar_events') is null then
    raise exception
      'Live Classes Calendar sync requires existing public.live_classes and public.calendar_events tables.';
  end if;

  for required_column in
    select *
    from (values
      ('live_classes', 'id', 'uuid'),
      ('live_classes', 'teacher_id', 'uuid'),
      ('live_classes', 'title', 'text'),
      ('live_classes', 'description', 'text'),
      ('live_classes', 'topic', 'text'),
      ('live_classes', 'chapter', 'text'),
      ('live_classes', 'grade', 'integer'),
      ('live_classes', 'stream', 'text'),
      ('live_classes', 'subject_id', 'bigint'),
      ('live_classes', 'start_at', 'timestamp with time zone'),
      ('live_classes', 'end_at', 'timestamp with time zone'),
      ('live_classes', 'status', 'text'),
      ('live_classes', 'publication_status', 'text'),
      ('calendar_events', 'id', 'uuid'),
      ('calendar_events', 'teacher_id', 'uuid'),
      ('calendar_events', 'title', 'text'),
      ('calendar_events', 'description', 'text'),
      ('calendar_events', 'event_type', 'text'),
      ('calendar_events', 'grade', 'integer'),
      ('calendar_events', 'stream', 'text'),
      ('calendar_events', 'subject_id', 'bigint'),
      ('calendar_events', 'start_at', 'timestamp with time zone'),
      ('calendar_events', 'end_at', 'timestamp with time zone'),
      ('calendar_events', 'all_day', 'boolean'),
      ('calendar_events', 'meeting_url', 'text'),
      ('calendar_events', 'status', 'text'),
      ('calendar_events', 'is_visible_to_students', 'boolean'),
      ('calendar_events', 'source_table', 'text'),
      ('calendar_events', 'source_id', 'uuid')
    ) as expected(table_name, column_name, data_type)
  loop
    if not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = required_column.table_name
        and actual.column_name = required_column.column_name
        and actual.data_type = required_column.data_type
    ) then
      raise exception
        'Live Classes Calendar sync requires public.%.% with type %; no Calendar changes were made.',
        required_column.table_name,
        required_column.column_name,
        required_column.data_type;
    end if;
  end loop;

  if to_regprocedure(
    'public.live_class_student_can_view(uuid,integer,text,text)'
  ) is null then
    raise exception
      'Apply the Live Classes security migration first; the student class-eligibility function is missing.';
  end if;
  if not has_function_privilege(
    'authenticated',
    to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)'),
    'EXECUTE'
  ) then
    raise exception
      'Authenticated students cannot execute the Live Classes eligibility function; no Calendar sync was installed.';
  end if;

  select procedure.prosecdef, procedure.prosrc
    into access_function
  from pg_proc procedure
  where procedure.oid = to_regprocedure(
    'public.calendar_student_can_view_event(integer,text,bigint,text,uuid)'
  );

  if not found then
    raise exception
      'The existing Calendar student-access helper is missing; no Calendar sync was installed.';
  end if;

  if not access_function.prosecdef
    or position('live_classes' in lower(access_function.prosrc)) = 0
    or position('live_class_student_can_view' in lower(access_function.prosrc)) = 0 then
    raise exception
      'The existing Calendar student-access helper does not validate live-class eligibility; review Calendar access before enabling sync.';
  end if;
  if not has_function_privilege(
    'authenticated',
    to_regprocedure('public.calendar_student_can_view_event(integer,text,bigint,text,uuid)'),
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    to_regprocedure('public.calendar_student_can_view_event(integer,text,bigint,text,uuid)'),
    'EXECUTE'
  ) then
    raise exception
      'Calendar student-access helper grants are not restricted to authenticated users; review Calendar access before enabling sync.';
  end if;

  select policy.qual
    into student_policy
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'calendar_events'
    and policy.policyname = 'calendar_student_select'
    and policy.cmd = 'SELECT'
    and 'authenticated' = any(policy.roles);

  if student_policy is null
    or position('is_visible_to_students' in lower(student_policy)) = 0
    or position('calendar_student_can_view_event' in lower(student_policy)) = 0
    or position('status' in lower(student_policy)) = 0
    or position('published' in lower(student_policy)) = 0
    or position(' or ' in lower(student_policy)) > 0 then
    raise exception
      'The existing calendar_student_select policy is missing or does not enforce the Calendar student-access helper; no policies were changed.';
  end if;

  select policy.qual
    into teacher_policy
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'calendar_events'
    and policy.policyname = 'calendar_teacher_select'
    and policy.cmd = 'SELECT'
    and 'authenticated' = any(policy.roles);

  if teacher_policy is null
    or position('calendar_teacher_owns_event' in lower(teacher_policy)) = 0
    or position(' or ' in lower(teacher_policy)) > 0 then
    raise exception
      'The existing calendar_teacher_select ownership policy is missing or unexpected; no policies were changed.';
  end if;

  if (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'calendar_events'
  ) <> 5 then
    raise exception
      'Expected the five existing Calendar RLS policies. Review their definitions; this migration will not replace them.';
  end if;

  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'calendar_events'
      and policy.cmd in ('SELECT', 'ALL')
      and (
        'authenticated' = any(policy.roles)
        or 'public' = any(policy.roles)
      )
      and policy.policyname not in (
        'calendar_student_select',
        'calendar_teacher_select'
      )
  ) then
    raise exception
      'An additional Calendar SELECT policy could expose events outside the checked student and teacher rules; review policies before enabling sync.';
  end if;

  if exists (
    select 1
    from public.live_classes live
    where live.teacher_id is null
      or live.title is null
      or live.grade is null
      or live.subject_id is null
      or live.start_at is null
      or live.end_at is null
      or live.end_at < live.start_at
  ) then
    raise exception
      'Existing live classes have incomplete teacher, class, subject, or scheduled-time data; repair them before enabling Calendar sync.';
  end if;

  if exists (
    select 1
    from public.calendar_events event
    where event.source_table = 'live_classes'
    group by event.source_id
    having event.source_id is null or count(*) > 1
  ) then
    raise exception
      'Duplicate or invalid live-class Calendar source links exist; resolve them before enabling sync.';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.calendar_events'::regclass
      and index_row.indisunique
      and index_relation.relname = 'calendar_events_source_unique_idx'
      and pg_get_indexdef(index_row.indexrelid) ilike '%(source_table, source_id)%'
      and coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '')
        ilike '%source_table is not null%'
      and coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '')
        ilike '%source_id is not null%'
  ) then
    raise exception
      'The existing unique Calendar source index is missing or incompatible; install the verified Calendar migration before enabling sync.';
  end if;

  if exists (
    select 1
    from public.live_classes live
    where lower(coalesce(live.publication_status, '')) not in ('draft', 'published')
      or lower(coalesce(live.status, '')) not in (
        'scheduled', 'live', 'completed', 'missed', 'attended', 'cancelled', 'canceled'
      )
  ) then
    raise exception
      'Existing live classes have unsupported status values; normalize them before enabling Calendar sync.';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and relation.relkind = 'r'
      and relation.relrowsecurity
  ) then
    raise exception
      'Row-level security is not enabled on public.calendar_events; no Calendar sync was installed.';
  end if;
end;
$$;

create or replace function public.sync_live_class_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text;
  calendar_status text;
  student_visible boolean;
begin
  if tg_op = 'DELETE' then
    delete from public.calendar_events
    where source_table = 'live_classes'
      and source_id = old.id;
    return old;
  end if;

  normalized_status := lower(btrim(new.status));
  calendar_status := case
    when lower(btrim(new.publication_status)) <> 'published' then 'draft'
    when normalized_status in ('scheduled', 'live') then 'published'
    when normalized_status in ('completed', 'missed', 'attended') then 'completed'
    when normalized_status in ('cancelled', 'canceled') then 'cancelled'
    else null
  end;

  if calendar_status is null then
    raise exception 'Unsupported live_classes.status value: %', new.status;
  end if;

  student_visible :=
    lower(btrim(new.publication_status)) = 'published'
    and normalized_status in ('scheduled', 'live');

  insert into public.calendar_events (
    teacher_id,
    title,
    description,
    event_type,
    grade,
    stream,
    subject_id,
    start_at,
    end_at,
    all_day,
    meeting_url,
    status,
    is_visible_to_students,
    source_table,
    source_id
  )
  values (
    new.teacher_id,
    new.title,
    coalesce(new.description, new.topic, new.chapter),
    'live_class',
    new.grade,
    new.stream,
    new.subject_id,
    new.start_at,
    new.end_at,
    false,
    null,
    calendar_status,
    student_visible,
    'live_classes',
    new.id
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    teacher_id = excluded.teacher_id,
    title = excluded.title,
    description = excluded.description,
    event_type = excluded.event_type,
    grade = excluded.grade,
    stream = excluded.stream,
    subject_id = excluded.subject_id,
    start_at = excluded.start_at,
    end_at = excluded.end_at,
    all_day = excluded.all_day,
    meeting_url = null,
    status = excluded.status,
    is_visible_to_students = excluded.is_visible_to_students;

  return new;
end;
$$;

alter function public.sync_live_class_calendar_event() owner to postgres;
revoke all on function public.sync_live_class_calendar_event()
  from public, anon, authenticated;

drop trigger if exists zz_live_classes_calendar_access_sync on public.live_classes;
drop trigger if exists live_classes_delete_calendar_event on public.live_classes;
drop trigger if exists live_classes_sync_calendar_event on public.live_classes;
create trigger live_classes_sync_calendar_event
  after insert or update or delete on public.live_classes
  for each row execute function public.sync_live_class_calendar_event();

insert into public.calendar_events (
  teacher_id,
  title,
  description,
  event_type,
  grade,
  stream,
  subject_id,
  start_at,
  end_at,
  all_day,
  meeting_url,
  status,
  is_visible_to_students,
  source_table,
  source_id
)
select
  live.teacher_id,
  live.title,
  coalesce(live.description, live.topic, live.chapter),
  'live_class',
  live.grade,
  live.stream,
  live.subject_id,
  live.start_at,
  live.end_at,
  false,
  null,
  case
    when lower(btrim(live.publication_status)) <> 'published' then 'draft'
    when lower(btrim(live.status)) in ('scheduled', 'live') then 'published'
    when lower(btrim(live.status)) in ('completed', 'missed', 'attended') then 'completed'
    when lower(btrim(live.status)) in ('cancelled', 'canceled') then 'cancelled'
    else null
  end,
  lower(btrim(live.publication_status)) = 'published'
    and lower(btrim(live.status)) in ('scheduled', 'live'),
  'live_classes',
  live.id
from public.live_classes live
on conflict (source_table, source_id)
  where source_table is not null and source_id is not null
do update set
  teacher_id = excluded.teacher_id,
  title = excluded.title,
  description = excluded.description,
  event_type = excluded.event_type,
  grade = excluded.grade,
  stream = excluded.stream,
  subject_id = excluded.subject_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  all_day = excluded.all_day,
  meeting_url = null,
  status = excluded.status,
  is_visible_to_students = excluded.is_visible_to_students;

delete from public.calendar_events event
where event.source_table = 'live_classes'
  and not exists (
    select 1
    from public.live_classes live
    where live.id = event.source_id
  );

commit;
