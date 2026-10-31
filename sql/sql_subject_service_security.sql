begin;

do $$
declare
  expected record;
begin
  for expected in
    select *
    from (values
      ('subjects', 'id', 'bigint'),
      ('subjects', 'grades', 'ARRAY'),
      ('subjects', 'streams', 'ARRAY'),
      ('teachers', 'id', 'uuid'),
      ('teachers', 'user_id', 'uuid'),
      ('students', 'user_id', 'uuid'),
      ('students', 'grade', 'integer'),
      ('students', 'stream', 'text'),
      ('teacher_grade_groups', 'teacher_id', 'uuid'),
      ('teacher_grade_groups', 'grade', 'integer'),
      ('teacher_grade_groups', 'stream', 'text'),
      ('teacher_grade_groups', 'teach_all_subjects', 'boolean'),
      ('teacher_subject_assignments', 'teacher_id', 'uuid'),
      ('teacher_subject_assignments', 'subject_id', 'bigint'),
      ('teacher_subject_assignments', 'grade', 'integer'),
      ('teacher_subject_assignments', 'stream', 'text')
    ) as schema_check(table_name, column_name, data_type)
  loop
    if not exists (
      select 1
      from information_schema.columns as actual
      where actual.table_schema = 'public'
        and actual.table_name = expected.table_name
        and actual.column_name = expected.column_name
        and actual.data_type = expected.data_type
    ) then
      raise exception
        'Expected public.%.% with type %; no changes applied.',
        expected.table_name, expected.column_name, expected.data_type;
    end if;
  end loop;
end;
$$;

create or replace function public.subject_is_eligible_for_class(
  requested_subject_id bigint,
  requested_grade integer,
  requested_stream text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.subjects as subject
    where subject.id = requested_subject_id
      and subject.grades @> array[requested_grade]
      and (
        requested_grade between 5 and 10
        or (
          requested_grade between 11 and 12
          and requested_stream is not null
          and subject.streams @> array[requested_stream]
        )
      )
  );
$$;

create or replace function public.get_eligible_subjects(
  requested_grade integer,
  requested_stream text default null
)
returns table (id bigint, name text, grades integer[], streams text[])
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select subject.id, subject.name, subject.grades, subject.streams
  from public.subjects as subject
  where requested_grade between 5 and 12
    and subject.grades @> array[requested_grade]
    and (
      requested_grade between 5 and 10
      or (
        requested_grade between 11 and 12
        and requested_stream is not null
        and subject.streams @> array[requested_stream]
      )
    )
  order by subject.name;
$$;

create or replace function public.get_eligible_streams(requested_grade integer)
returns table (stream text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct eligible_stream.stream
  from public.subjects as subject
  cross join lateral unnest(subject.streams) as eligible_stream(stream)
  where requested_grade between 11 and 12
    and subject.grades @> array[requested_grade]
    and btrim(eligible_stream.stream) <> ''
  order by eligible_stream.stream;
$$;

create or replace function public.student_can_read_eligible_assignment(
  requested_teacher_id uuid,
  requested_grade integer,
  requested_stream text,
  requested_subject_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.students as student
    join public.teacher_grade_groups as grade_group
      on grade_group.teacher_id = requested_teacher_id
      and grade_group.grade = requested_grade
      and grade_group.stream is not distinct from requested_stream
    join public.teacher_subject_assignments as assignment
      on assignment.teacher_id = grade_group.teacher_id
      and assignment.grade = requested_grade
      and assignment.stream is not distinct from requested_stream
      and assignment.subject_id = requested_subject_id
    where student.user_id = (select auth.uid())
      and student.grade = requested_grade
      and student.stream is not distinct from requested_stream
      and public.subject_is_eligible_for_class(
        requested_subject_id,
        requested_grade,
        requested_stream
      )
  );
$$;

create or replace function public.validate_teacher_subject_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  authenticated_teacher_id uuid;
begin
  if auth.uid() is null then
    raise exception 'An authenticated teacher is required to change subject assignments.'
      using errcode = '42501';
  end if;

  select teacher.id
    into authenticated_teacher_id
  from public.teachers as teacher
  where teacher.user_id = auth.uid();

  if authenticated_teacher_id is null
    or new.teacher_id is distinct from authenticated_teacher_id then
    raise exception 'Teachers may only change their own subject assignments.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.teacher_grade_groups as grade_group
    where grade_group.teacher_id = new.teacher_id
      and grade_group.grade = new.grade
      and grade_group.stream is not distinct from new.stream
  ) then
    raise exception 'Create the matching grade and stream group before assigning a subject.'
      using errcode = '23514';
  end if;

  if not public.subject_is_eligible_for_class(
    new.subject_id,
    new.grade,
    new.stream
  ) then
    raise exception 'The selected subject is not eligible for this grade and stream.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.subject_is_eligible_for_class(bigint, integer, text)
  from public, anon;
revoke all on function public.get_eligible_subjects(integer, text)
  from public;
grant execute on function public.get_eligible_subjects(integer, text)
  to anon, authenticated;
revoke all on function public.get_eligible_streams(integer)
  from public;
grant execute on function public.get_eligible_streams(integer)
  to anon, authenticated;
revoke all on function public.student_can_read_eligible_assignment(uuid, integer, text, bigint)
  from public, anon;
grant execute on function public.student_can_read_eligible_assignment(uuid, integer, text, bigint)
  to authenticated;
revoke all on function public.validate_teacher_subject_assignment()
  from public, anon, authenticated;

drop trigger if exists validate_teacher_subject_assignment
  on public.teacher_subject_assignments;
create trigger validate_teacher_subject_assignment
before insert or update on public.teacher_subject_assignments
for each row execute function public.validate_teacher_subject_assignment();

alter table public.teacher_subject_assignments enable row level security;
alter table public.subjects enable row level security;

drop policy if exists "Students read their registered class subject assignments"
  on public.teacher_subject_assignments;
drop policy if exists "Students read eligible teacher subject assignments"
  on public.teacher_subject_assignments;
drop policy if exists "Students read eligible class subject assignments"
  on public.teacher_subject_assignments;
create policy "Students read eligible class subject assignments"
  on public.teacher_subject_assignments
  for select to authenticated
  using (
    public.student_can_read_eligible_assignment(
      teacher_id,
      grade::integer,
      stream,
      subject_id
    )
  );

drop policy if exists "Students read their registered class subjects"
  on public.subjects;
drop policy if exists "Students read subjects assigned to their class"
  on public.subjects;
drop policy if exists "Students read assigned class subjects"
  on public.subjects;
create policy "Students read assigned class subjects"
  on public.subjects
  for select to authenticated
  using (exists (
    select 1
    from public.teacher_subject_assignments as assignment
    where assignment.subject_id = subjects.id
      and public.student_can_read_eligible_assignment(
        assignment.teacher_id,
        assignment.grade::integer,
        assignment.stream,
        assignment.subject_id
      )
  ));

grant select on public.teacher_subject_assignments to authenticated;

drop policy if exists "Public read subject catalog"
  on public.subjects;
create policy "Public read subject catalog"
  on public.subjects
  for select to anon, authenticated
  using (true);

revoke all on public.subjects from public, anon, authenticated;
grant select (id, name, grades, streams)
  on public.subjects to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.subjects from anon, authenticated;

commit;
