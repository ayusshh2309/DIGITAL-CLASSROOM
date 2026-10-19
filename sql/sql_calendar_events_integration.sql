begin;

do $$
declare
  required_table text;
  required_column text;
begin
  foreach required_table in array array[
    'calendar_events',
    'teachers',
    'students',
    'student_profiles',
    'subjects',
    'teacher_grade_groups',
    'teacher_subject_assignments',
    'materials',
    'quizzes',
    'live_classes',
    'announcements',
    'announcement_recipients',
    'assignments'
  ] loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'Required public.% table is missing; apply its existing schema migration before calendar integration', required_table;
    end if;
  end loop;

  foreach required_column in array array[
    'id',
    'teacher_id',
    'title',
    'description',
    'event_type',
    'grade',
    'stream',
    'subject_id',
    'start_at',
    'end_at',
    'all_day',
    'location',
    'meeting_url',
    'created_at',
    'updated_at'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'calendar_events'
        and column_name = required_column
    ) then
      raise exception 'Expected public.calendar_events.%; inspect the deployed schema before applying calendar integration', required_column;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teachers'
      and column_name = 'user_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name in ('id', 'user_id', 'grade', 'stream')
    group by table_name
    having count(distinct column_name) = 4
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name in ('id', 'name', 'grades', 'streams')
    group by table_name
    having count(distinct column_name) = 4
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_profiles'
      and column_name in ('student_id', 'eligible_subjects')
    group by table_name
    having count(distinct column_name) = 2
  ) then
    raise exception 'Expected teacher user_id, student registration scope, and subject curriculum columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'calendar_events'
      and column_name = 'subject_id'
      and data_type = 'bigint'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name = 'id'
      and data_type = 'bigint'
  ) then
    raise exception 'Calendar and subjects IDs must both be bigint for safe subject-scope checks';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'calendar_events',
        'teachers',
        'materials',
        'quizzes',
        'live_classes',
        'announcements',
        'assignments'
      )
      and column_name = 'id'
      and data_type <> 'uuid'
  ) or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'calendar_events',
        'teachers',
        'materials',
        'quizzes',
        'live_classes',
        'announcements',
        'assignments'
      )
      and column_name = 'id'
      and data_type = 'uuid'
  ) <> 7 then
    raise exception 'Calendar source IDs must be UUIDs; inspect source-table IDs before applying this migration';
  end if;
end;
$$;

alter table public.calendar_events
  add column if not exists source_table text,
  add column if not exists source_id uuid,
  add column if not exists status text not null default 'scheduled',
  add column if not exists is_visible_to_students boolean not null default true;

do $$
begin
  if exists (
    select 1
    from public.calendar_events
    where source_table is not null and source_id is null
  ) then
    raise exception 'calendar_events contains incomplete source links; resolve them before applying the integration';
  end if;

  if exists (
    select source_table, source_id
    from public.calendar_events
    where source_table is not null
    group by source_table, source_id
    having count(*) > 1
  ) then
    raise exception 'calendar_events contains duplicate source links; resolve duplicates before applying the integration';
  end if;
end;
$$;

create unique index if not exists calendar_events_source_unique
  on public.calendar_events (source_table, source_id)
  where source_table is not null and source_id is not null;

create index if not exists calendar_events_teacher_start_idx
  on public.calendar_events (teacher_id, start_at);

create index if not exists calendar_events_student_scope_start_idx
  on public.calendar_events (grade, stream, start_at)
  where is_visible_to_students;

create or replace function public.teacher_can_manage_calendar_event(
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
  select exists (
    select 1
    from public.teachers teacher
    where teacher.id = requested_teacher_id
      and teacher.user_id = (select auth.uid())
  )
  and (
    requested_grade is null
    and requested_stream is null
    and requested_subject_id is null
    or exists (
      select 1
      from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = requested_teacher_id
        and grade_group.grade = requested_grade
        and (
          (requested_grade < 11 and grade_group.stream is null and requested_stream is null)
          or
          (requested_grade >= 11 and grade_group.stream is not distinct from requested_stream)
        )
        and (
          requested_subject_id is null
          or grade_group.teach_all_subjects
          or exists (
            select 1
            from public.teacher_subject_assignments assignment
            where assignment.teacher_id = requested_teacher_id
              and assignment.grade = requested_grade
              and assignment.stream is not distinct from requested_stream
              and (
                assignment.subject_id::text = requested_subject_id::text
                or exists (
                  select 1
                  from public.subjects subject
                  where subject.id::text = requested_subject_id::text
                    and lower(btrim(assignment.subject)) = lower(btrim(subject.name))
                )
              )
          )
        )
    )
  );
$$;

alter function public.teacher_can_manage_calendar_event(uuid, integer, text, bigint) owner to postgres;
revoke all on function public.teacher_can_manage_calendar_event(uuid, integer, text, bigint) from public, anon;
grant execute on function public.teacher_can_manage_calendar_event(uuid, integer, text, bigint) to authenticated;

create or replace function public.teacher_owns_calendar_profile(requested_teacher_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teachers teacher
    where teacher.id = requested_teacher_id
      and teacher.user_id = (select auth.uid())
  );
$$;

alter function public.teacher_owns_calendar_profile(uuid) owner to postgres;
revoke all on function public.teacher_owns_calendar_profile(uuid) from public, anon;
grant execute on function public.teacher_owns_calendar_profile(uuid) to authenticated;

create or replace function public.student_can_view_calendar_event(
  requested_grade integer,
  requested_stream text,
  requested_subject_id bigint,
  requested_visible boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(requested_visible, false)
    and requested_grade is not null
    and exists (
      select 1
      from public.students student
      where student.user_id = (select auth.uid())
        and student.grade = requested_grade
        and (
          (student.grade between 5 and 10
            and nullif(btrim(coalesce(requested_stream, '')), '') is null)
          or
          (student.grade in (11, 12)
            and lower(btrim(coalesce(student.stream, '')))
              = lower(btrim(coalesce(requested_stream, ''))))
        )
        and (
          requested_subject_id is null
          or exists (
            select 1
            from public.subjects subject
            where subject.id::text = requested_subject_id::text
              and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
              and (
                student.grade < 11
                or coalesce(subject.streams, '{}'::text[]) @> array[student.stream]
              )
              and (
                not exists (
                  select 1
                  from public.student_profiles student_profile
                  where student_profile.student_id = student.user_id
                    and cardinality(student_profile.eligible_subjects) > 0
                )
                or exists (
                  select 1
                  from public.student_profiles student_profile
                  where student_profile.student_id = student.user_id
                    and lower(subject.name) = any(
                    select lower(registered.subject_name)
                    from unnest(student_profile.eligible_subjects) as registered(subject_name)
                    )
                )
              )
          )
        )
    );
$$;

alter function public.student_can_view_calendar_event(integer, text, bigint, boolean) owner to postgres;
revoke all on function public.student_can_view_calendar_event(integer, text, bigint, boolean) from public, anon;
grant execute on function public.student_can_view_calendar_event(integer, text, bigint, boolean) to authenticated;

alter table public.calendar_events enable row level security;
grant select, insert, update, delete on public.calendar_events to authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_events'
  loop
    execute format('drop policy %I on public.calendar_events', policy_record.policyname);
  end loop;
end;
$$;

create policy calendar_events_teacher_select
on public.calendar_events
for select to authenticated
using (
  public.teacher_owns_calendar_profile(teacher_id)
);

create policy calendar_events_student_select
on public.calendar_events
for select to authenticated
using (
  public.student_can_view_calendar_event(grade, stream, subject_id, is_visible_to_students)
);

create policy calendar_events_teacher_insert
on public.calendar_events
for insert to authenticated
with check (
  source_table is null
  and source_id is null
  and public.teacher_can_manage_calendar_event(teacher_id, grade, stream, subject_id)
);

create policy calendar_events_teacher_update
on public.calendar_events
for update to authenticated
using (
  source_table is null
  and source_id is null
  and public.teacher_owns_calendar_profile(teacher_id)
)
with check (
  source_table is null
  and source_id is null
  and public.teacher_owns_calendar_profile(teacher_id)
  and public.teacher_can_manage_calendar_event(teacher_id, grade, stream, subject_id)
);

create policy calendar_events_teacher_delete
on public.calendar_events
for delete to authenticated
using (
  source_table is null
  and source_id is null
  and public.teacher_owns_calendar_profile(teacher_id)
);

create or replace function public.sync_calendar_activity(
  requested_source_table text,
  requested_record jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  teacher_value text;
  teacher_id_value uuid;
  title_value text;
  description_value text;
  event_type_value text;
  status_value text;
  grade_text text;
  grade_value integer;
  stream_value text;
  subject_id_text text;
  subject_id_value bigint;
  subject_text text;
  matching_subject_count bigint;
  start_at_value timestamptz;
  end_at_value timestamptz;
  duration_value integer;
  visible_value boolean;
  meeting_url_value text;
  location_value text;
begin
  if requested_source_table not in (
    'materials',
    'quizzes',
    'live_classes',
    'announcements',
    'assignments'
  ) then
    raise exception 'Unsupported calendar activity source: %', requested_source_table;
  end if;

  source_id_value := nullif(requested_record ->> 'id', '')::uuid;
  if source_id_value is null then
    raise exception 'Calendar activity source %.id must be a UUID', requested_source_table;
  end if;

  if lower(coalesce(requested_record ->> 'operation', '')) = 'delete' then
    delete from public.calendar_events
    where source_table = requested_source_table and source_id = source_id_value;
    return;
  end if;

  status_value := lower(coalesce(nullif(requested_record ->> 'status', ''), 'published'));
  visible_value := case requested_source_table
    when 'materials' then status_value = 'published'
    when 'quizzes' then status_value in ('published', 'scheduled')
    when 'live_classes' then true
    when 'announcements' then status_value = 'published'
    when 'assignments' then status_value = 'published'
    else false
  end;

  if not visible_value then
    delete from public.calendar_events
    where source_table = requested_source_table and source_id = source_id_value;
    return;
  end if;

  teacher_value := coalesce(
    nullif(requested_record ->> 'teacher_id', ''),
    nullif(requested_record ->> 'teacher_user_id', '')
  );
  if teacher_value is null then
    raise exception 'Calendar activity source %.teacher_id is required', requested_source_table;
  end if;

  select teacher.id into teacher_id_value
  from public.teachers teacher
  where teacher.id::text = teacher_value or teacher.user_id::text = teacher_value
  order by (teacher.id::text = teacher_value) desc
  limit 1;
  if teacher_id_value is null then
    raise exception 'No teacher profile matches source %.teacher_id %', requested_source_table, teacher_value;
  end if;

  grade_text := coalesce(
    nullif(requested_record ->> 'grade', ''),
    nullif(requested_record ->> 'class_grade', '')
  );
  if grade_text is not null and substring(grade_text from '[0-9]+') is not null then
    grade_value := substring(grade_text from '[0-9]+')::integer;
  else
    grade_value := null;
  end if;
  if grade_value is not null and (grade_value < 1 or grade_value > 12) then
    grade_value := null;
  end if;
  stream_value := nullif(btrim(coalesce(requested_record ->> 'stream', '')), '');

  subject_id_text := nullif(requested_record ->> 'subject_id', '');
  if subject_id_text ~ '^[0-9]+$' then
    subject_id_value := subject_id_text::bigint;
  else
    subject_id_value := null;
  end if;
  subject_text := nullif(btrim(coalesce(
    requested_record ->> 'subject',
    requested_record ->> 'subject_name'
  )), '');
  if subject_id_value is null and subject_text is not null and grade_value is not null then
    select count(*), min(subject.id)
    into matching_subject_count, subject_id_value
    from public.subjects subject
    where lower(btrim(subject.name)) = lower(subject_text)
      and coalesce(subject.grades, '{}'::integer[]) @> array[grade_value]
      and (
        grade_value < 11
        or coalesce(subject.streams, '{}'::text[]) @> array[stream_value]
      );
    if matching_subject_count <> 1 then
      visible_value := false;
    end if;
  elsif subject_text is not null and subject_id_value is null then
    visible_value := false;
  end if;

  duration_value := null;
  if coalesce(requested_record ->> 'duration_minutes', requested_record ->> 'duration') ~ '[0-9]+' then
    duration_value := substring(
      coalesce(requested_record ->> 'duration_minutes', requested_record ->> 'duration')
      from '[0-9]+'
    )::integer;
  end if;

  if requested_source_table = 'live_classes' then
    start_at_value := nullif(requested_record ->> 'start_at', '')::timestamptz;
    if start_at_value is null
      and nullif(requested_record ->> 'class_date', '') is not null
      and nullif(requested_record ->> 'start_time', '') is not null then
      start_at_value := (
        (requested_record ->> 'class_date')::date
        + (requested_record ->> 'start_time')::time
      ) at time zone 'UTC';
    end if;
  elsif requested_source_table = 'materials' then
    start_at_value := coalesce(
      nullif(requested_record ->> 'uploaded_at', '')::timestamptz,
      nullif(requested_record ->> 'created_at', '')::timestamptz
    );
  elsif requested_source_table = 'quizzes' then
    start_at_value := coalesce(
      nullif(requested_record ->> 'start_at', '')::timestamptz,
      nullif(requested_record ->> 'published_at', '')::timestamptz,
      nullif(requested_record ->> 'created_at', '')::timestamptz
    );
  elsif requested_source_table = 'announcements' then
    start_at_value := coalesce(
      nullif(requested_record ->> 'published_at', '')::timestamptz,
      nullif(requested_record ->> 'created_at', '')::timestamptz
    );
  else
    start_at_value := coalesce(
      nullif(requested_record ->> 'due_at', '')::timestamptz,
      nullif(requested_record ->> 'start_at', '')::timestamptz
    );
  end if;

  if start_at_value is null then
    delete from public.calendar_events
    where source_table = requested_source_table and source_id = source_id_value;
    return;
  end if;

  end_at_value := coalesce(
    nullif(requested_record ->> 'end_at', '')::timestamptz,
    nullif(requested_record ->> 'due_at', '')::timestamptz,
    nullif(requested_record ->> 'deadline', '')::timestamptz
  );
  if end_at_value is null and duration_value > 0 then
    end_at_value := start_at_value + make_interval(mins => duration_value);
  end if;
  if end_at_value <= start_at_value then
    end_at_value := null;
  end if;

  event_type_value := case requested_source_table
    when 'materials' then 'material'
    when 'quizzes' then
      case
        when lower(coalesce(
          requested_record ->> 'event_type',
          requested_record ->> 'quiz_type',
          requested_record ->> 'assessment_type',
          ''
        )) = 'exam'
          then 'exam'
        else 'quiz'
      end
    when 'live_classes' then 'live_class'
    when 'announcements' then 'announcement'
    when 'assignments' then 'assignment'
  end;

  title_value := coalesce(
    nullif(btrim(requested_record ->> 'title'), ''),
    nullif(btrim(requested_record ->> 'name'), ''),
    nullif(btrim(requested_record ->> 'topic'), ''),
    'Academic event'
  );
  if requested_source_table = 'materials' then
    title_value := 'Material Uploaded: ' || title_value;
  elsif requested_source_table = 'quizzes' then
    title_value := 'Quiz: ' || title_value;
  end if;

  description_value := coalesce(
    nullif(requested_record ->> 'description', ''),
    nullif(requested_record ->> 'instructions', ''),
    nullif(requested_record ->> 'message', ''),
    nullif(requested_record ->> 'topic', '')
  );
  meeting_url_value := nullif(coalesce(
    requested_record ->> 'meeting_url',
    requested_record ->> 'join_url'
  ), '');
  location_value := nullif(coalesce(
    requested_record ->> 'location',
    requested_record ->> 'file_url',
    requested_record ->> 'external_url'
  ), '');

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
    location,
    meeting_url,
    source_table,
    source_id,
    status,
    is_visible_to_students,
    updated_at
  ) values (
    teacher_id_value,
    title_value,
    description_value,
    event_type_value,
    grade_value,
    stream_value,
    subject_id_value,
    start_at_value,
    end_at_value,
    false,
    location_value,
    meeting_url_value,
    requested_source_table,
    source_id_value,
    status_value,
    visible_value,
    now()
  )
  on conflict (source_table, source_id) where source_table is not null and source_id is not null
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
    location = excluded.location,
    meeting_url = excluded.meeting_url,
    status = excluded.status,
    is_visible_to_students = excluded.is_visible_to_students,
    updated_at = now();
end;
$$;

alter function public.sync_calendar_activity(text, jsonb) owner to postgres;
revoke all on function public.sync_calendar_activity(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_calendar_activity_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record jsonb;
begin
  if tg_op = 'DELETE' then
    source_record := to_jsonb(old) || jsonb_build_object('operation', 'delete');
    perform public.sync_calendar_activity(tg_table_name, source_record);
    return old;
  end if;

  perform public.sync_calendar_activity(tg_table_name, to_jsonb(new));
  return new;
end;
$$;

alter function public.sync_calendar_activity_trigger() owner to postgres;
revoke all on function public.sync_calendar_activity_trigger() from public, anon, authenticated;

do $$
declare
  source_table_name text;
  source_record record;
begin
  foreach source_table_name in array array[
    'materials',
    'quizzes',
    'live_classes',
    'announcements',
    'assignments'
  ] loop
    execute format('drop trigger if exists sync_calendar_activity on public.%I', source_table_name);
    execute format(
      'create trigger sync_calendar_activity after insert or update or delete on public.%I for each row execute function public.sync_calendar_activity_trigger()',
      source_table_name
    );

    for source_record in execute format(
      'select to_jsonb(source_row) as row_data from public.%I source_row',
      source_table_name
    ) loop
      perform public.sync_calendar_activity(source_table_name, source_record.row_data);
    end loop;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'calendar_events'
    ) then
      alter publication supabase_realtime add table public.calendar_events;
    end if;
  end if;
end;
$$;

create or replace function public.get_student_calendar_events(requested_student_id uuid)
returns table (
  id text,
  source text,
  event_type text,
  title text,
  description text,
  class_grade text,
  stream text,
  subject text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  teacher_name text,
  location text,
  file_url text,
  duration_minutes integer,
  question_count integer,
  original_start_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    'class-' || live.id::text,
    'live_classes',
    case when lower(live.status) in ('cancelled', 'canceled') then 'rescheduled_class' else 'live_class' end,
    live.title,
    live.topic,
    live.class_grade::text,
    live.stream,
    live.subject,
    live.start_at,
    live.start_at + make_interval(mins => live.duration_minutes),
    live.status,
    null::text,
    live.meeting_url,
    null::text,
    live.duration_minutes,
    null::integer,
    null::timestamptz
  from public.live_classes live
  join public.student_profiles student_profile
    on student_profile.student_id = (select auth.uid())
  where requested_student_id = (select auth.uid())
    and live.class_grade = student_profile.grade
    and (live.stream is null or live.stream = '' or lower(live.stream) = lower(coalesce(student_profile.stream, '')))
    and lower(live.subject) = any(
      select lower(registered.subject_name)
      from unnest(student_profile.eligible_subjects) as registered(subject_name)
    )

  union all

  select
    'material-' || material.id::text,
    'materials',
    'material',
    coalesce(material.title, material.name),
    material.description,
    material.class_grade::text,
    material.stream,
    material.subject,
    coalesce(material.uploaded_at, material.created_at),
    coalesce(material.uploaded_at, material.created_at),
    material.status,
    material.teacher_name,
    material.file_url,
    material.file_url,
    null::integer,
    null::integer,
    null::timestamptz
  from public.materials material
  join public.student_profiles student_profile
    on student_profile.student_id = (select auth.uid())
  where requested_student_id = (select auth.uid())
    and material.status = 'published'
    and material.class_grade = student_profile.grade
    and (material.stream is null or material.stream = '' or lower(material.stream) = lower(coalesce(student_profile.stream, '')))
    and lower(material.subject) = any(
      select lower(registered.subject_name)
      from unnest(student_profile.eligible_subjects) as registered(subject_name)
    )

  union all

  select
    'quiz-' || quiz.id::text,
    'quizzes',
    'quiz',
    quiz.title,
    coalesce(quiz.description, quiz.instructions),
    quiz.class_grade::text,
    quiz.stream,
    quiz.subject,
    coalesce(quiz.start_at, quiz.published_at, quiz.created_at),
    coalesce(quiz.end_at, quiz.start_at, quiz.published_at, quiz.created_at),
    quiz.status,
    null::text,
    null::text,
    null::text,
    quiz.duration_minutes,
    quiz.question_count,
    null::timestamptz
  from public.quizzes quiz
  join public.student_profiles student_profile
    on student_profile.student_id = (select auth.uid())
  where requested_student_id = (select auth.uid())
    and quiz.status in ('published', 'scheduled')
    and quiz.class_grade = student_profile.grade
    and (quiz.stream is null or quiz.stream = '' or lower(quiz.stream) = lower(coalesce(student_profile.stream, '')))
    and lower(quiz.subject) = any(
      select lower(registered.subject_name)
      from unnest(student_profile.eligible_subjects) as registered(subject_name)
    )

  union all

  select
    'assignment-' || assignment.id::text,
    'assignments',
    'assignment',
    assignment.title,
    coalesce(assignment.description, assignment.instructions),
    assignment.class_grade::text,
    assignment.stream,
    assignment.subject,
    assignment.due_at,
    assignment.due_at,
    assignment.status,
    null::text,
    null::text,
    null::text,
    null::integer,
    null::integer,
    null::timestamptz
  from public.assignments assignment
  join public.student_profiles student_profile
    on student_profile.student_id = (select auth.uid())
  where requested_student_id = (select auth.uid())
    and assignment.status = 'published'
    and assignment.class_grade = student_profile.grade
    and (assignment.stream is null or assignment.stream = '' or lower(assignment.stream) = lower(coalesce(student_profile.stream, '')))
    and lower(assignment.subject) = any(
      select lower(registered.subject_name)
      from unnest(student_profile.eligible_subjects) as registered(subject_name)
    )

  union all

  select
    'announcement-' || announcement.id::text,
    'announcements',
    'announcement',
    announcement.title,
    announcement.message,
    announcement.grade::text,
    announcement.stream,
    subject.name,
    coalesce(announcement.published_at, announcement.publish_at),
    coalesce(announcement.published_at, announcement.publish_at),
    announcement.status,
    null::text,
    null::text,
    null::text,
    null::integer,
    null::integer,
    null::timestamptz
  from public.announcements announcement
  join public.announcement_recipients recipient
    on recipient.announcement_id = announcement.id
  join public.students student
    on student.id = recipient.student_id
   and student.user_id = (select auth.uid())
  left join public.subjects subject
    on subject.id::text = announcement.subject_id::text
  where requested_student_id = (select auth.uid())
    and announcement.status = 'published'

  union all

  select
    'calendar-' || calendar_event.id::text,
    'calendar_events',
    calendar_event.event_type,
    calendar_event.title,
    calendar_event.description,
    coalesce(calendar_event.grade::text, student.grade::text),
    calendar_event.stream,
    subject.name,
    calendar_event.start_at,
    calendar_event.end_at,
    calendar_event.status,
    null::text,
    coalesce(calendar_event.location, calendar_event.meeting_url),
    null::text,
    null::integer,
    null::integer,
    null::timestamptz
  from public.calendar_events calendar_event
  join public.students student
    on student.user_id = (select auth.uid())
  join public.student_profiles student_profile
    on student_profile.student_id = student.user_id
  left join public.subjects subject
    on subject.id::text = calendar_event.subject_id::text
  where requested_student_id = (select auth.uid())
    and calendar_event.is_visible_to_students
    and calendar_event.grade = student.grade
    and (
      (student.grade between 5 and 10 and nullif(btrim(coalesce(calendar_event.stream, '')), '') is null)
      or
      (student.grade in (11, 12)
        and lower(btrim(coalesce(calendar_event.stream, ''))) = lower(btrim(coalesce(student.stream, ''))))
    )
    and (
      calendar_event.subject_id is null
      or (
        subject.id is not null
        and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
        and (
          student.grade < 11
          or coalesce(subject.streams, '{}'::text[]) @> array[student.stream]
        )
        and (
          cardinality(student_profile.eligible_subjects) = 0
          or lower(subject.name) = any(
            select lower(registered.subject_name)
            from unnest(student_profile.eligible_subjects) as registered(subject_name)
          )
        )
      )
    )
    and calendar_event.source_table is null;
$$;

alter function public.get_student_calendar_events(uuid) owner to postgres;
revoke all on function public.get_student_calendar_events(uuid) from public, anon;
grant execute on function public.get_student_calendar_events(uuid) to authenticated;

commit;
