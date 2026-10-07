begin;

do $migration$
declare
  sessions_table regclass := to_regclass('public.attendance_sessions');
  column_types record;
  existing_function record;
begin
  if sessions_table is null then
    raise exception 'public.attendance_sessions does not exist; no table was created.';
  end if;

  select
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'id') as id_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'teacher_id') as teacher_id_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'grade') as grade_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'stream') as stream_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'subject_id') as subject_id_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'attendance_date') as attendance_date_type,
    max(format_type(attribute.atttypid, attribute.atttypmod))
      filter (where attribute.attname = 'status') as status_type
  into column_types
  from pg_attribute as attribute
  where attribute.attrelid = sessions_table
    and attribute.attnum > 0
    and not attribute.attisdropped;

  raise notice
    'Inspected public.attendance_sessions columns: id %, teacher_id %, grade %, stream %, subject_id %, attendance_date %, status %',
    column_types.id_type,
    column_types.teacher_id_type,
    column_types.grade_type,
    column_types.stream_type,
    column_types.subject_id_type,
    column_types.attendance_date_type,
    column_types.status_type;

  if column_types.id_type is null
    or column_types.teacher_id_type is null
    or column_types.grade_type is null
    or column_types.stream_type is null
    or column_types.subject_id_type is null
    or column_types.attendance_date_type is null
    or column_types.status_type is null then
    raise exception
      'public.attendance_sessions is missing a required column (id, teacher_id, grade, stream, subject_id, attendance_date, status).';
  end if;

  for existing_function in
    select pg_get_function_identity_arguments(function_row.oid) as identity_arguments
    from pg_proc as function_row
    join pg_namespace as function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = 'ensure_teacher_attendance_session'
      and function_row.prokind = 'f'
  loop
    execute format(
      'drop function public.ensure_teacher_attendance_session(%s)',
      existing_function.identity_arguments
    );
  end loop;

  execute format(
    $ddl$
      create function public.ensure_teacher_attendance_session(
        requested_grade %1$s,
        requested_stream %2$s,
        requested_subject_id %3$s,
        requested_attendance_date %4$s
      )
      returns %5$s
      language plpgsql
      security definer
      set search_path = pg_catalog, public, auth
      as $attendance_rpc$
      declare
        current_teacher_id public.attendance_sessions.teacher_id%%TYPE;
        current_session_id public.attendance_sessions.id%%TYPE;
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
        where teacher.user_id = (select auth.uid())
          and grade_group.grade = requested_grade
          and grade_group.stream is not distinct from requested_stream
          and (
            grade_group.teach_all_subjects
            or exists (
              select 1
              from public.teacher_subject_assignments as assignment
              where assignment.teacher_id = teacher.id
                and assignment.grade = grade_group.grade
                and assignment.stream is not distinct from grade_group.stream
                and assignment.subject_id = requested_subject_id
            )
          )
        limit 1;

        if current_teacher_id is null then
          raise exception 'You are not registered to teach this grade, stream, and subject.'
            using errcode = '42501';
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
        do nothing;

        select session.id
          into current_session_id
        from public.attendance_sessions as session
        where session.teacher_id = current_teacher_id
          and session.grade = requested_grade
          and session.stream is not distinct from requested_stream
          and session.subject_id = requested_subject_id
          and session.attendance_date = requested_attendance_date;

        if current_session_id is null then
          raise exception 'The attendance session could not be created or loaded.'
            using errcode = 'P0001';
        end if;

        return current_session_id;
      end;
      $attendance_rpc$;
    $ddl$,
    column_types.grade_type,
    column_types.stream_type,
    column_types.subject_id_type,
    column_types.attendance_date_type,
    column_types.id_type
  );

  execute format(
    'revoke all on function public.ensure_teacher_attendance_session(%s, %s, %s, %s) from public, anon',
    column_types.grade_type,
    column_types.stream_type,
    column_types.subject_id_type,
    column_types.attendance_date_type
  );
  execute format(
    'grant execute on function public.ensure_teacher_attendance_session(%s, %s, %s, %s) to authenticated',
    column_types.grade_type,
    column_types.stream_type,
    column_types.subject_id_type,
    column_types.attendance_date_type
  );
end;
$migration$;

notify pgrst, 'reload schema';

commit;
