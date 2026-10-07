begin;

create or replace function public.ensure_teacher_attendance_session(
  requested_attendance_date date,
  requested_grade integer,
  requested_stream text,
  requested_subject_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $ensure_attendance$
declare
  current_teacher_id public.teachers.id%type;
  current_session_id public.attendance_sessions.id%type;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to open attendance.'
      using errcode = '42501';
  end if;

  if requested_grade is null
    or requested_subject_id is null
    or requested_attendance_date is null then
    raise exception 'Attendance session details are invalid.'
      using errcode = '22023';
  end if;

  select teacher.id
    into current_teacher_id
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
    and assignment.subject_id::text = requested_subject_id::text
  limit 1;

  if current_teacher_id is null then
    raise exception 'You are not registered to teach this grade, stream, and subject.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat_ws(
        '|',
        current_teacher_id::text,
        requested_grade::text,
        coalesce(requested_stream, '<null>'),
        requested_subject_id::text,
        requested_attendance_date::text
      ),
      0
    )
  );

  select session.id
    into current_session_id
  from public.attendance_sessions as session
  where session.teacher_id = current_teacher_id
    and session.grade = requested_grade
    and session.stream is not distinct from requested_stream
    and session.subject_id = requested_subject_id
    and session.attendance_date = requested_attendance_date
  for update;

  if current_session_id is null then
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
    returning id into current_session_id;
  end if;

  return current_session_id;
end;
$ensure_attendance$;

create or replace function public.save_teacher_attendance(
  requested_attendance_date date,
  requested_grade integer,
  requested_records jsonb,
  requested_stream text,
  requested_subject_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $save_attendance$
declare
  current_teacher_id public.teachers.id%type;
  current_session_id public.attendance_sessions.id%type;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to save attendance.'
      using errcode = '42501';
  end if;

  if requested_attendance_date is null
    or requested_grade is null
    or requested_subject_id is null
    or jsonb_typeof(requested_records) is distinct from 'array' then
    raise exception 'Attendance details and a JSON array of records are required.'
      using errcode = '22023';
  end if;

  select teacher.id
    into current_teacher_id
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
    and assignment.subject_id::text = requested_subject_id::text
  limit 1;

  if current_teacher_id is null then
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
    left join public.students as student
      on student.id = submitted.student_id
    where submitted.student_id is null
      or student.id is null
      or student.grade <> requested_grade
      or student.stream is distinct from requested_stream
      or not exists (
        select 1
        from public.teacher_grade_groups as grade_group
        where grade_group.teacher_id = current_teacher_id
          and grade_group.grade = requested_grade
          and grade_group.stream is not distinct from requested_stream
      )
      or coalesce(submitted.status, 'not_marked')
        not in ('present', 'absent', 'late', 'not_marked')
      or (
        submitted.duration_minutes is not null
        and submitted.duration_minutes < 0
      )
      or (
        submitted.check_in is not null
        and submitted.check_out is not null
        and submitted.check_out < submitted.check_in
      )
  ) then
    raise exception 'One or more attendance records are invalid or outside this registered class.'
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

  current_session_id := public.ensure_teacher_attendance_session(
    requested_attendance_date,
    requested_grade,
    requested_stream,
    requested_subject_id
  );

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
    case
      when submitted.check_in is not null and submitted.check_out is not null
        then round(extract(epoch from (submitted.check_out - submitted.check_in)) / 60)::integer
      else submitted.duration_minutes
    end,
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
  where id = current_session_id
    and teacher_id = current_teacher_id;

  return current_session_id;
end;
$save_attendance$;

revoke all on function public.ensure_teacher_attendance_session(date, integer, text, bigint)
  from public, anon;
grant execute on function public.ensure_teacher_attendance_session(date, integer, text, bigint)
  to authenticated;

revoke all on function public.save_teacher_attendance(date, integer, jsonb, text, bigint)
  from public, anon;
grant execute on function public.save_teacher_attendance(date, integer, jsonb, text, bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
