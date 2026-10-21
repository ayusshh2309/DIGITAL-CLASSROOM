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
      ('calendar_events', 'id', 'uuid'),
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
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles owner_role on owner_role.oid = p.proowner
    where n.nspname = 'public'
      and p.proname = 'owns_calendar_teacher'
      and p.oid = to_regprocedure('public.owns_calendar_teacher(uuid)')
      and p.prosecdef
      and owner_role.rolname = 'postgres'
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and position('user_id' in lower(p.prosrc)) > 0
      and position('auth.uid' in lower(p.prosrc)) > 0
      and position('requested_teacher_id' in lower(p.prosrc)) > 0
      and position('teachers' in lower(p.prosrc)) > 0
      and position(
        'id=requested_teacher_id',
        regexp_replace(lower(p.prosrc), '\s+', '', 'g')
      ) > 0
      and position(
        'user_id=auth.uid()',
        regexp_replace(lower(p.prosrc), '\s+', '', 'g')
      ) > 0
  ) then
    raise exception
      'owns_calendar_teacher(uuid) is not verified as a postgres-owned, fixed-search-path definer matching authenticated teacher user_id to auth.uid(); inspect it before applying.';
  end if;

  if to_regprocedure('public.calendar_core_scope_allowed(uuid,integer,text,bigint)') is not null
    and not exists (
      select 1
      from pg_proc p
      join pg_roles owner_role on owner_role.oid = p.proowner
      where p.oid = to_regprocedure('public.calendar_core_scope_allowed(uuid,integer,text,bigint)')
        and owner_role.rolname = 'postgres'
        and p.prosecdef
        and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and position('teacher_grade_groups' in lower(p.prosrc)) > 0
        and position('teacher_subject_assignments' in lower(p.prosrc)) > 0
    ) then
    raise exception
      'A pre-existing calendar_core_scope_allowed function differs from the reviewed migration version; no Calendar changes made.';
  end if;

  if to_regprocedure('public.calendar_core_event_scope_guard()') is not null
    and not exists (
      select 1
      from pg_proc p
      join pg_roles owner_role on owner_role.oid = p.proowner
      where p.oid = to_regprocedure('public.calendar_core_event_scope_guard()')
        and owner_role.rolname = 'postgres'
        and p.prosecdef
        and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and position('source link cannot be changed' in lower(p.prosrc)) > 0
        and position('calendar_core_scope_allowed' in lower(p.prosrc)) > 0
    ) then
    raise exception
      'A pre-existing calendar_core_event_scope_guard function differs from the reviewed migration version; no Calendar changes made.';
  end if;

  if exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.grade not between 5 and 12
      or (grade_group.grade between 5 and 10 and grade_group.stream is not null)
      or (grade_group.grade between 11 and 12 and (
        grade_group.stream is null
        or grade_group.stream not in (
          'science_pcm', 'science_pcb', 'commerce', 'arts_humanities'
        )
      ))
  ) then
    raise exception
      'Teacher grade-group rows do not match the verified registration grade/stream rules; inspect them before Calendar setup.';
  end if;

  if exists (
    select 1
    from public.teacher_subject_assignments assignment
    where not exists (
      select 1
      from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = assignment.teacher_id
        and grade_group.grade = assignment.grade
        and grade_group.stream is not distinct from assignment.stream
    )
    or not exists (
      select 1
      from public.subjects subject
      where subject.id = assignment.subject_id
        and coalesce(subject.grades, '{}'::integer[]) @> array[assignment.grade]
        and (
          assignment.grade between 5 and 10
          or coalesce(subject.streams, '{}'::text[]) @> array[assignment.stream]
        )
    )
  ) then
    raise exception
      'Teacher subject assignments do not match registered grade groups or subject grade/stream eligibility; inspect them before Calendar setup.';
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
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_pkey'
      and contype = 'p'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_event_type_check'
      and contype = 'c'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_status_check'
      and contype = 'c'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_grade_valid'
      and contype = 'c'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_source_pair'
      and contype = 'c'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_valid_time'
      and contype = 'c'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_teacher_id_fkey'
      and contype = 'f'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_subject_id_fkey'
      and contype = 'f'
  ) then
    raise exception
      'A reviewed Calendar constraint is missing or renamed; this migration does not add duplicate constraints.';
  end if;

  if not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = 'public.calendar_events_pkey'::regclass
      and indisprimary
  ) or not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = to_regclass('public.calendar_events_teacher_start_idx')
  ) or not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = to_regclass('public.calendar_events_class_start_idx')
  ) or not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = to_regclass('public.calendar_events_subject_start_idx')
  ) or not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = to_regclass('public.calendar_events_student_visible_idx')
  ) or not exists (
    select 1 from pg_index
    where indrelid = 'public.calendar_events'::regclass
      and indexrelid = to_regclass('public.calendar_events_source_unique')
  ) then
    raise exception
      'A reviewed Calendar index is missing or renamed; this migration does not add duplicate indexes.';
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

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_events'
  ) <> 5 then
    raise exception
      'The reviewed Calendar policy set contains exactly five policies; inspect unexpected additions before proceeding.';
  end if;

  if exists (
    select 1
    from (values
      (
        'calendar_student_classwide_select',
        'SELECT',
        '((status = ''published''::text) AND (is_visible_to_students = true) AND (subject_id IS NULL) AND (grade IS NOT NULL) AND (EXISTS ( SELECT 1 FROM students s WHERE ((s.user_id = ( SELECT auth.uid() AS uid)) AND (s.grade = calendar_events.grade) AND (NOT (s.stream IS DISTINCT FROM calendar_events.stream))))))',
        null::text
      ),
      ('calendar_teacher_delete', 'DELETE', 'owns_calendar_teacher(teacher_id)', null::text),
      ('calendar_teacher_insert', 'INSERT', null::text, 'owns_calendar_teacher(teacher_id)'),
      ('calendar_teacher_select', 'SELECT', 'owns_calendar_teacher(teacher_id)', null::text),
      ('calendar_teacher_update', 'UPDATE', 'owns_calendar_teacher(teacher_id)', 'owns_calendar_teacher(teacher_id)')
    ) expected(policyname, cmd, qual, with_check)
    left join pg_policies actual
      on actual.schemaname = 'public'
      and actual.tablename = 'calendar_events'
      and actual.policyname = expected.policyname
    where actual.policyname is null
      or actual.permissive <> 'PERMISSIVE'
      or actual.roles <> array['authenticated']::name[]
      or actual.cmd <> expected.cmd
      or regexp_replace(actual.qual, '\s+', ' ', 'g')
           is distinct from regexp_replace(expected.qual, '\s+', ' ', 'g')
      or regexp_replace(actual.with_check, '\s+', ' ', 'g')
           is distinct from regexp_replace(expected.with_check, '\s+', ' ', 'g')
  ) then
    raise exception
      'Calendar policy expressions differ from the reviewed definitions; no policies will be changed.';
  end if;

  if not has_table_privilege('authenticated', 'public.calendar_events', 'SELECT')
    or not has_table_privilege('authenticated', 'public.calendar_events', 'INSERT')
    or not has_table_privilege('authenticated', 'public.calendar_events', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.calendar_events', 'DELETE') then
    raise exception
      'authenticated is missing one or more existing Calendar table privileges; this migration does not alter table grants.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and trigger_row.tgname = 'calendar_events_updated_at_trigger'
      and trigger_row.tgenabled = 'O'
      and (trigger_row.tgtype & 2) = 2
      and (trigger_row.tgtype & 16) = 16
      and trigger_function.proname = 'set_calendar_event_updated_at'
      and position('new.updated_at' in lower(trigger_function.prosrc)) > 0
      and coalesce(trigger_function.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception
      'The reviewed enabled updated_at trigger is missing or differs; this migration does not add a replacement.';
  end if;

  if (
    select count(*)
    from pg_trigger trigger_row
    join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = 'public.calendar_events'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled in ('O', 'A')
      and (trigger_row.tgtype & 2) = 2
      and (trigger_row.tgtype & 16) = 16
      and position('new.updated_at' in lower(trigger_function.prosrc)) > 0
  ) <> 1 then
    raise exception
      'Expected exactly one enabled updated_at trigger on public.calendar_events; inspect duplicate trigger behavior.';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname = 'calendar_events'
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'calendar_core_scope_guard'
      and (
        trigger_row.tgenabled in ('D', 'R')
        or trigger_row.tgfoid <> to_regprocedure('public.calendar_core_event_scope_guard()')::oid
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
    and exists (
      select 1
      from public.teachers teacher
      where teacher.id = requested_teacher_id
        and teacher.user_id = (select auth.uid())
    )
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
    return new;
  end if;

  if tg_op = 'UPDATE' then
    row_to_check := old;
    if not exists (
      select 1
      from public.teachers teacher
      where teacher.id = row_to_check.teacher_id
        and teacher.user_id = (select auth.uid())
    ) then
      raise exception 'You are not authorized to update this Calendar event.'
        using errcode = '42501';
    end if;

    if new.teacher_id is distinct from old.teacher_id
      or new.source_table is distinct from old.source_table
      or new.source_id is distinct from old.source_id then
      raise exception 'An event owner or source link cannot be changed.'
        using errcode = '42501';
    end if;

    if new.grade is distinct from old.grade
      or new.stream is distinct from old.stream
      or new.subject_id is distinct from old.subject_id then
      if not coalesce(public.calendar_core_scope_allowed(
        new.teacher_id, new.grade, new.stream, new.subject_id
      ), false) then
        raise exception 'Choose a grade, stream, and subject assigned to your teacher profile.'
          using errcode = '42501';
      end if;
    end if;

    return new;
  end if;

  row_to_check := new;
  if not coalesce(public.calendar_core_scope_allowed(
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

alter function public.calendar_core_scope_allowed(uuid, integer, text, bigint) owner to postgres;
alter function public.calendar_core_event_scope_guard() owner to postgres;

revoke all on function public.calendar_core_scope_allowed(uuid, integer, text, bigint)
  from public, anon, authenticated;
revoke all on function public.calendar_core_event_scope_guard()
  from public, anon, authenticated;

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
      before insert or update on public.calendar_events
      for each row execute function public.calendar_core_event_scope_guard();
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
