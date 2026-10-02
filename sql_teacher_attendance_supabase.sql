begin;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  grade smallint not null check (grade between 5 and 12),
  stream text,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  attendance_date date not null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_sessions_grade_stream_check check (
    (grade between 5 and 10 and stream is null)
    or (
      grade in (11, 12)
      and stream in ('science_pcm', 'science_pcb', 'commerce', 'arts_humanities')
    )
  )
);

create unique index if not exists attendance_sessions_scope_date_key
  on public.attendance_sessions (teacher_id, grade, stream, subject_id, attendance_date)
  nulls not distinct;

create index if not exists attendance_sessions_teacher_date_idx
  on public.attendance_sessions (teacher_id, attendance_date desc);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'not_marked'
    check (status in ('present', 'absent', 'late', 'not_marked')),
  check_in timestamptz,
  check_out timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_session_student_key unique (session_id, student_id)
);

create index if not exists attendance_records_student_idx
  on public.attendance_records (student_id, session_id);

create or replace function public.teacher_can_access_student_scope(
  requested_grade integer,
  requested_stream text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.teachers as teacher
    join public.teacher_grade_groups as grade_group
      on grade_group.teacher_id = teacher.id
    where teacher.user_id = (select auth.uid())
      and grade_group.grade = requested_grade
      and grade_group.stream is not distinct from requested_stream
  );
$$;

create or replace function public.teacher_can_access_attendance_scope(
  requested_grade integer,
  requested_stream text,
  requested_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.teachers as teacher
    join public.teacher_grade_groups as grade_group
      on grade_group.teacher_id = teacher.id
    join public.teacher_subject_assignments as assignment
      on assignment.teacher_id = teacher.id
      and assignment.grade = grade_group.grade
      and assignment.stream is not distinct from grade_group.stream
    where teacher.user_id = (select auth.uid())
      and grade_group.grade = requested_grade
      and grade_group.stream is not distinct from requested_stream
      and assignment.subject_id = requested_subject_id
  );
$$;

create or replace function public.teacher_can_access_attendance_session(
  requested_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.attendance_sessions as session
    join public.teachers as teacher on teacher.id = session.teacher_id
    where session.id = requested_session_id
      and teacher.user_id = (select auth.uid())
      and public.teacher_can_access_attendance_scope(
        session.grade,
        session.stream,
        session.subject_id
      )
  );
$$;

create or replace function public.teacher_can_access_attendance_record(
  requested_session_id uuid,
  requested_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.attendance_sessions as session
    join public.teachers as teacher on teacher.id = session.teacher_id
    join public.students as student on student.id = requested_student_id
    where session.id = requested_session_id
      and teacher.user_id = (select auth.uid())
      and student.grade = session.grade
      and student.stream is not distinct from session.stream
      and public.teacher_can_access_attendance_scope(
        session.grade,
        session.stream,
        session.subject_id
      )
  );
$$;

create or replace function public.save_teacher_attendance(
  requested_grade smallint,
  requested_stream text,
  requested_subject_id uuid,
  requested_attendance_date date,
  requested_records jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_teacher_id uuid;
  current_session_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to save attendance.'
      using errcode = '42501';
  end if;

  select teacher.id
    into current_teacher_id
  from public.teachers as teacher
  where teacher.user_id = (select auth.uid());

  if current_teacher_id is null then
    raise exception 'No teacher profile is linked to this account.'
      using errcode = '42501';
  end if;

  if requested_grade not between 5 and 12
    or requested_attendance_date is null
    or requested_subject_id is null
    or jsonb_typeof(requested_records) is distinct from 'array' then
    raise exception 'Attendance details are invalid.'
      using errcode = '22023';
  end if;

  if requested_grade between 5 and 10 and requested_stream is not null then
    raise exception 'Grades 5 to 10 must not have a stream.'
      using errcode = '22023';
  end if;

  if requested_grade in (11, 12)
    and (
      requested_stream is null
      or requested_stream not in ('science_pcm', 'science_pcb', 'commerce', 'arts_humanities')
    ) then
    raise exception 'A valid stream is required for Grades 11 and 12.'
      using errcode = '22023';
  end if;

  if not public.teacher_can_access_attendance_scope(
    requested_grade,
    requested_stream,
    requested_subject_id
  ) then
    raise exception 'You are not registered to teach this grade, stream, and subject.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(requested_records) as submitted(
      student_id uuid,
      status text,
      check_in timestamptz,
      check_out timestamptz,
      duration_minutes integer,
      remarks text
    )
    left join public.students as student on student.id = submitted.student_id
    where submitted.student_id is null
      or student.id is null
      or student.grade <> requested_grade
      or student.stream is distinct from requested_stream
      or coalesce(submitted.status, 'not_marked')
        not in ('present', 'absent', 'late', 'not_marked')
      or (submitted.duration_minutes is not null and submitted.duration_minutes < 0)
  ) then
    raise exception 'One or more attendance records are invalid or outside this class.'
      using errcode = '42501';
  end if;

  if exists (
    select submitted.student_id
    from jsonb_to_recordset(requested_records) as submitted(student_id uuid)
    group by submitted.student_id
    having count(*) > 1
  ) then
    raise exception 'A student can only appear once in an attendance save.'
      using errcode = '22023';
  end if;

  insert into public.attendance_sessions (
    teacher_id,
    grade,
    stream,
    subject_id,
    attendance_date,
    status
  )
  values (
    current_teacher_id,
    requested_grade,
    requested_stream,
    requested_subject_id,
    requested_attendance_date,
    'draft'
  )
  on conflict (teacher_id, grade, stream, subject_id, attendance_date)
  do update set updated_at = now()
  returning id into current_session_id;

  insert into public.attendance_records (
    session_id,
    student_id,
    status,
    check_in,
    check_out,
    duration_minutes,
    remarks
  )
  select
    current_session_id,
    submitted.student_id,
    coalesce(submitted.status, 'not_marked'),
    submitted.check_in,
    submitted.check_out,
    submitted.duration_minutes,
    submitted.remarks
  from jsonb_to_recordset(requested_records) as submitted(
    student_id uuid,
    status text,
    check_in timestamptz,
    check_out timestamptz,
    duration_minutes integer,
    remarks text
  )
  on conflict (session_id, student_id)
  do update set
    status = excluded.status,
    check_in = excluded.check_in,
    check_out = excluded.check_out,
    duration_minutes = excluded.duration_minutes,
    remarks = excluded.remarks,
    updated_at = now();

  update public.attendance_sessions
  set status = 'completed',
      updated_at = now()
  where id = current_session_id;

  return current_session_id;
end;
$$;

create or replace function public.set_attendance_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_attendance_record_duration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.check_in is not null and new.check_out is not null then
    if new.check_out < new.check_in then
      raise exception 'Check-out must be later than check-in.'
        using errcode = '22023';
    end if;
    new.duration_minutes := round(extract(epoch from (new.check_out - new.check_in)) / 60)::integer;
  else
    new.duration_minutes := null;
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_set_updated_at on public.attendance_sessions;
create trigger attendance_sessions_set_updated_at
  before update on public.attendance_sessions
  for each row execute function public.set_attendance_updated_at();

drop trigger if exists attendance_records_set_updated_at on public.attendance_records;
create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row execute function public.set_attendance_updated_at();

drop trigger if exists attendance_records_set_duration on public.attendance_records;
create trigger attendance_records_set_duration
  before insert or update on public.attendance_records
  for each row execute function public.set_attendance_record_duration();

alter table public.students enable row level security;
drop policy if exists "Teachers read students in registered teaching scope" on public.students;
create policy "Teachers read students in registered teaching scope"
  on public.students for select to authenticated
  using (public.teacher_can_access_student_scope(grade, stream));

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists attendance_sessions_select_own_scope on public.attendance_sessions;
create policy attendance_sessions_select_own_scope
  on public.attendance_sessions for select to authenticated
  using (public.teacher_can_access_attendance_session(id));

drop policy if exists attendance_sessions_insert_own_scope on public.attendance_sessions;
create policy attendance_sessions_insert_own_scope
  on public.attendance_sessions for insert to authenticated
  with check (
    exists (
      select 1 from public.teachers as teacher
      where teacher.id = attendance_sessions.teacher_id
        and teacher.user_id = (select auth.uid())
    )
    and public.teacher_can_access_attendance_scope(grade, stream, subject_id)
  );

drop policy if exists attendance_sessions_update_own_scope on public.attendance_sessions;
create policy attendance_sessions_update_own_scope
  on public.attendance_sessions for update to authenticated
  using (public.teacher_can_access_attendance_session(id))
  with check (
    exists (
      select 1 from public.teachers as teacher
      where teacher.id = attendance_sessions.teacher_id
        and teacher.user_id = (select auth.uid())
    )
    and public.teacher_can_access_attendance_scope(grade, stream, subject_id)
  );

drop policy if exists attendance_records_select_own_scope on public.attendance_records;
create policy attendance_records_select_own_scope
  on public.attendance_records for select to authenticated
  using (public.teacher_can_access_attendance_record(session_id, student_id));

drop policy if exists attendance_records_insert_own_scope on public.attendance_records;
create policy attendance_records_insert_own_scope
  on public.attendance_records for insert to authenticated
  with check (public.teacher_can_access_attendance_record(session_id, student_id));

drop policy if exists attendance_records_update_own_scope on public.attendance_records;
create policy attendance_records_update_own_scope
  on public.attendance_records for update to authenticated
  using (public.teacher_can_access_attendance_record(session_id, student_id))
  with check (public.teacher_can_access_attendance_record(session_id, student_id));

revoke all on public.attendance_sessions, public.attendance_records from anon;
grant select, insert, update on public.attendance_sessions to authenticated;
grant select, insert, update on public.attendance_records to authenticated;
revoke all on function public.teacher_can_access_student_scope(integer, text) from public, anon;
revoke all on function public.teacher_can_access_attendance_scope(integer, text, uuid) from public, anon;
revoke all on function public.teacher_can_access_attendance_session(uuid) from public, anon;
revoke all on function public.teacher_can_access_attendance_record(uuid, uuid) from public, anon;
grant execute on function public.teacher_can_access_student_scope(integer, text) to authenticated;
grant execute on function public.teacher_can_access_attendance_scope(integer, text, uuid) to authenticated;
grant execute on function public.teacher_can_access_attendance_session(uuid) to authenticated;
grant execute on function public.teacher_can_access_attendance_record(uuid, uuid) to authenticated;
revoke all on function public.save_teacher_attendance(smallint, text, uuid, date, jsonb) from public, anon;
grant execute on function public.save_teacher_attendance(smallint, text, uuid, date, jsonb) to authenticated;
revoke all on function public.set_attendance_updated_at() from public, anon, authenticated;
revoke all on function public.set_attendance_record_duration() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_sessions'
    ) then
      alter publication supabase_realtime add table public.attendance_sessions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_records'
    ) then
      alter publication supabase_realtime add table public.attendance_records;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students'
    ) then
      alter publication supabase_realtime add table public.students;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teacher_grade_groups'
    ) then
      alter publication supabase_realtime add table public.teacher_grade_groups;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teacher_subject_assignments'
    ) then
      alter publication supabase_realtime add table public.teacher_subject_assignments;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
