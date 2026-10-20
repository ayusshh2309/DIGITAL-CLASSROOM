begin;

do $$
declare
  required record;
begin
  if to_regclass('public.calendar_events') is null then
    raise exception 'public.calendar_events must already exist; this migration does not create it.';
  end if;

  if to_regclass('public.teachers') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null then
    raise exception 'A verified teacher-scope table is missing; no Calendar changes made.';
  end if;

  for required in
    select *
    from (values
      ('calendar_events', 'teacher_id', 'uuid'),
      ('calendar_events', 'title', 'text'),
      ('calendar_events', 'event_type', 'text'),
      ('calendar_events', 'grade', 'integer'),
      ('calendar_events', 'stream', 'text'),
      ('calendar_events', 'subject_id', 'bigint'),
      ('calendar_events', 'start_at', 'timestamp with time zone'),
      ('calendar_events', 'end_at', 'timestamp with time zone'),
      ('calendar_events', 'all_day', 'boolean'),
      ('calendar_events', 'location', 'text'),
      ('calendar_events', 'meeting_url', 'text'),
      ('calendar_events', 'status', 'text'),
      ('calendar_events', 'is_visible_to_students', 'boolean'),
      ('calendar_events', 'source_table', 'text'),
      ('calendar_events', 'source_id', 'uuid'),
      ('calendar_events', 'updated_at', 'timestamp with time zone'),
      ('teachers', 'id', 'uuid'),
      ('subjects', 'id', 'bigint'),
      ('subjects', 'grades', 'ARRAY'),
      ('subjects', 'streams', 'ARRAY'),
      ('teacher_grade_groups', 'teacher_id', 'uuid'),
      ('teacher_grade_groups', 'grade', 'integer'),
      ('teacher_grade_groups', 'stream', 'text'),
      ('teacher_grade_groups', 'teach_all_subjects', 'boolean'),
      ('teacher_subject_assignments', 'teacher_id', 'uuid'),
      ('teacher_subject_assignments', 'subject_id', 'bigint'),
      ('teacher_subject_assignments', 'grade', 'integer'),
      ('teacher_subject_assignments', 'stream', 'text')
    ) as expected(table_name, column_name, data_type)
  loop
    if not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
        and actual.data_type = required.data_type
    ) then
      raise exception
        'Required verified Calendar column %.% is missing or has an incompatible type (expected %).',
        required.table_name, required.column_name, required.data_type;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'grades' and udt_name = '_int4'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'streams' and udt_name = '_text'
  ) then
    raise exception 'subjects.grades must be integer[] and subjects.streams must be text[].';
  end if;

  if to_regprocedure('public.owns_calendar_teacher(uuid)') is null then
    raise exception 'The existing owns_calendar_teacher(uuid) policy helper is required.';
  end if;

  if not exists (
    select 1 from pg_constraint fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.teacher_grade_groups'::regclass
      and fk.confrelid = 'public.teachers'::regclass
      and fk.conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.teacher_grade_groups'::regclass
          and attname = 'teacher_id' and not attisdropped
      )]::smallint[]
      and fk.confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.teachers'::regclass
          and attname = 'id' and not attisdropped
      )]::smallint[]
  ) or not exists (
    select 1 from pg_constraint fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.teacher_subject_assignments'::regclass
      and fk.confrelid = 'public.teachers'::regclass
      and fk.conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.teacher_subject_assignments'::regclass
          and attname = 'teacher_id' and not attisdropped
      )]::smallint[]
      and fk.confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.teachers'::regclass
          and attname = 'id' and not attisdropped
      )]::smallint[]
  ) or not exists (
    select 1 from pg_constraint fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.teacher_subject_assignments'::regclass
      and fk.confrelid = 'public.subjects'::regclass
      and fk.conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.teacher_subject_assignments'::regclass
          and attname = 'subject_id' and not attisdropped
      )]::smallint[]
      and fk.confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.subjects'::regclass
          and attname = 'id' and not attisdropped
      )]::smallint[]
  ) then
    raise exception
      'Verified foreign-key relationships for teacher teaching scope are missing; no Calendar changes made.';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'calendar_events'
      and c.relrowsecurity
  ) then
    raise exception 'RLS must already be enabled on public.calendar_events.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events'
      and policyname = 'calendar_student_classwide_select' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events'
      and policyname = 'calendar_teacher_delete' and cmd = 'DELETE'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events'
      and policyname = 'calendar_teacher_insert' and cmd = 'INSERT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events'
      and policyname = 'calendar_teacher_select' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events'
      and policyname = 'calendar_teacher_update' and cmd = 'UPDATE'
  ) then
    raise exception 'The five reviewed Calendar policies were not found; no policies are changed.';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'calendar_core_scope_guard',
        'calendar_core_updated_at'
      )
      and (
        trigger_row.tgenabled in ('D', 'R')
        or (trigger_row.tgname = 'calendar_core_scope_guard'
          and trigger_row.tgfoid <> to_regprocedure('public.calendar_core_event_scope_guard()')::oid)
        or
        (trigger_row.tgname = 'calendar_core_updated_at'
          and trigger_row.tgfoid <> to_regprocedure('public.calendar_core_set_updated_at()')::oid)
      )
  ) then
    raise exception 'A Calendar core trigger name is already used by a different function.';
  end if;
end;
$$;

create or replace function public.calendar_core_scope_allowed(
  requested_teacher_id uuid,
  requested_grade integer,
  requested_stream text,
  requested_subject_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    requested_grade between 5 and 12
    and public.owns_calendar_teacher(requested_teacher_id)
    and (
      (requested_grade between 5 and 10 and requested_stream is null)
      or (requested_grade between 11 and 12 and requested_stream is not null)
    )
    and exists (
      select 1
      from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = requested_teacher_id
        and grade_group.grade = requested_grade
        and grade_group.stream is not distinct from requested_stream
    )
    and (
      requested_subject_id is null
      or exists (
        select 1
        from public.subjects subject
        where subject.id = requested_subject_id
          and coalesce(subject.grades, '{}'::integer[]) @> array[requested_grade]
          and (
            requested_grade between 5 and 10
            or coalesce(subject.streams, '{}'::text[]) @> array[requested_stream]
          )
          and (
            exists (
              select 1
              from public.teacher_subject_assignments assignment
              where assignment.teacher_id = requested_teacher_id
                and assignment.grade = requested_grade
                and assignment.stream is not distinct from requested_stream
                and assignment.subject_id = requested_subject_id
            )
            or exists (
              select 1
              from public.teacher_grade_groups all_subject_group
              where all_subject_group.teacher_id = requested_teacher_id
                and all_subject_group.grade = requested_grade
                and all_subject_group.stream is not distinct from requested_stream
                and all_subject_group.teach_all_subjects
            )
          )
      )
    );
$$;

create or replace function public.calendar_core_event_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_to_check public.calendar_events%rowtype;
begin
  if (select auth.uid()) is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    row_to_check := old;
    if row_to_check.source_table is not null or row_to_check.source_id is not null
      or not coalesce(public.calendar_core_scope_allowed(
        row_to_check.teacher_id,
        row_to_check.grade,
        row_to_check.stream,
        row_to_check.subject_id
      ), false) then
      raise exception 'You are not authorized to manage this Calendar event.'
        using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  row_to_check := new;
  if row_to_check.source_table is not null or row_to_check.source_id is not null
    or not coalesce(public.calendar_core_scope_allowed(
      row_to_check.teacher_id,
      row_to_check.grade,
      row_to_check.stream,
      row_to_check.subject_id
    ), false) then
    raise exception 'Choose a grade, stream, and subject assigned to your teacher profile.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.calendar_core_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function public.calendar_core_scope_allowed(uuid, integer, text, bigint) owner to postgres;
alter function public.calendar_core_event_scope_guard() owner to postgres;
alter function public.calendar_core_set_updated_at() owner to postgres;

revoke all on function public.calendar_core_scope_allowed(uuid, integer, text, bigint)
  from public, anon, authenticated;
revoke all on function public.calendar_core_event_scope_guard()
  from public, anon, authenticated;
revoke all on function public.calendar_core_set_updated_at()
  from public, anon, authenticated;

grant select, insert, update, delete on public.calendar_events to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and trigger_row.tgname = 'calendar_core_scope_guard'
      and not trigger_row.tgisinternal
  ) then
    create trigger calendar_core_scope_guard
      before insert or update or delete on public.calendar_events
      for each row execute function public.calendar_core_event_scope_guard();
  end if;

  if not exists (
    select 1 from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and trigger_row.tgname = 'calendar_core_updated_at'
      and not trigger_row.tgisinternal
  ) then
    create trigger calendar_core_updated_at
      before update on public.calendar_events
      for each row execute function public.calendar_core_set_updated_at();
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'calendar_events'
    ) then
    alter publication supabase_realtime add table public.calendar_events;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
