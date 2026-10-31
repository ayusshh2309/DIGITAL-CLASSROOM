begin;

do $$
declare
  invalid_source_status boolean;
begin
  if to_regclass('public.teachers') is null
    or to_regclass('public.students') is null
    or to_regclass('public.materials') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null
    or to_regclass('public.quizzes') is null then
    raise exception
      'Calendar requires teachers, students, materials, subjects, teaching-scope tables, and quizzes.';
  end if;

  if to_regclass('public.announcements') is not null
    and to_regprocedure('public.current_user_is_announcement_recipient(uuid)') is null then
    raise exception
      'Announcements exist but recipient-access protection is unavailable.';
  end if;

  if exists (
    select 1
    from (values
      ('teachers', 'id', 'uuid'),
      ('teachers', 'user_id', 'uuid'),
      ('students', 'user_id', 'uuid'),
      ('students', 'grade', 'integer'),
      ('students', 'stream', 'text'),
      ('materials', 'id', 'uuid'),
      ('materials', 'teacher_id', 'uuid'),
      ('materials', 'title', 'text'),
      ('materials', 'description', 'text'),
      ('materials', 'stream', 'text'),
      ('materials', 'subject_id', 'bigint'),
      ('materials', 'grade', 'integer'),
      ('materials', 'created_at', 'timestamp with time zone'),
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
      ('teacher_subject_assignments', 'stream', 'text'),
      ('quizzes', 'id', 'uuid'),
      ('quizzes', 'teacher_id', 'uuid'),
      ('quizzes', 'title', 'text'),
      ('quizzes', 'description', 'text'),
      ('quizzes', 'grade', 'integer'),
      ('quizzes', 'stream', 'text'),
      ('quizzes', 'subject_id', 'bigint'),
      ('quizzes', 'start_at', 'timestamp with time zone'),
      ('quizzes', 'end_at', 'timestamp with time zone'),
      ('quizzes', 'duration_minutes', 'integer'),
      ('quizzes', 'status', 'text'),
      ('quizzes', 'student_access', 'text'),
      ('live_classes', 'id', 'uuid'),
      ('live_classes', 'teacher_id', 'uuid'),
      ('live_classes', 'stream', 'text'),
      ('live_classes', 'subject_id', 'bigint'),
      ('live_classes', 'title', 'text'),
      ('live_classes', 'description', 'text'),
      ('live_classes', 'topic', 'text'),
      ('live_classes', 'chapter', 'text'),
      ('live_classes', 'class_date', 'date'),
      ('live_classes', 'start_time', 'time without time zone'),
      ('live_classes', 'duration_minutes', 'integer'),
      ('live_classes', 'meeting_url', 'text'),
      ('live_classes', 'status', 'text'),
      ('announcements', 'id', 'uuid'),
      ('announcements', 'teacher_id', 'uuid'),
      ('announcements', 'title', 'text'),
      ('announcements', 'message', 'text'),
      ('announcements', 'stream', 'text'),
      ('announcements', 'subject_id', 'bigint'),
      ('announcements', 'status', 'text'),
      ('announcements', 'publish_at', 'timestamp with time zone'),
      ('announcements', 'published_at', 'timestamp with time zone')
    ) as required(table_name, column_name, data_type)
    where (
      required.table_name not in ('live_classes', 'announcements')
      or to_regclass(format('public.%I', required.table_name)) is not null
    )
    and not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
        and actual.data_type = required.data_type
    )
  ) then
    raise exception
      'Calendar dependency columns do not match the expected Supabase schema.';
  end if;

  if to_regclass('public.live_classes') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'live_classes'
      and column_name = 'grade'
      and data_type in ('integer', 'text')
  ) then
    raise exception
      'public.live_classes.grade must be integer or text; inspect the live schema before synchronization.';
  end if;

  if to_regclass('public.announcements') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'announcements'
      and column_name = 'grade'
      and data_type in ('integer', 'text')
  ) then
    raise exception
      'public.announcements.grade must be integer or text; inspect the live schema before synchronization.';
  end if;

  if exists (
    select 1 from public.quizzes
    where status is null
      or lower(btrim(status)) not in ('draft', 'published', 'scheduled', 'archived')
  ) then
    raise exception
      'public.quizzes contains a status outside draft/published/scheduled/archived; inspect those rows before synchronization.';
  end if;

  if exists (
    select 1 from public.quizzes
    where student_access is null
      or lower(btrim(student_access)) not in ('class', 'assigned')
  ) then
    raise exception
      'public.quizzes contains an unrecognized student_access value; inspect those rows before synchronization.';
  end if;

  if to_regclass('public.live_classes') is not null then
    execute
      'select exists (
         select 1 from public.live_classes
         where status is null
           or lower(btrim(status)) not in (
             ''scheduled'', ''live'', ''completed'', ''cancelled'', ''missed'', ''attended''
           )
       )'
      into invalid_source_status;
    if invalid_source_status then
      raise exception
        'public.live_classes contains an unrecognized status; inspect those rows before synchronization.';
    end if;
  end if;

  if to_regclass('public.announcements') is not null then
    execute
      'select exists (
         select 1 from public.announcements
         where status is null
           or lower(btrim(status)) not in (
             ''draft'', ''scheduled'', ''published'', ''archived''
           )
       )'
      into invalid_source_status;
    if invalid_source_status then
      raise exception
        'public.announcements contains an unrecognized status; inspect those rows before synchronization.';
    end if;
  end if;

end;
$$;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  description text,
  event_type text not null check (
    event_type in (
      'event', 'class', 'live_class', 'quiz', 'exam', 'assignment', 'material',
      'announcement', 'holiday', 'meeting', 'other'
    )
  ),
  grade integer,
  stream text,
  subject_id bigint references public.subjects(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  location text,
  meeting_url text,
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'published', 'completed', 'cancelled')
  ),
  is_visible_to_students boolean not null default false,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_grade_valid
    check (grade is null or grade between 1 and 12),
  constraint calendar_events_source_pair
    check (
      (source_table is null and source_id is null)
      or (source_table is not null and source_id is not null)
    ),
  constraint calendar_events_valid_time
    check (end_at is null or end_at >= start_at)
);

do $$
declare
  required record;
begin
  for required in
    select *
    from (values
      ('id', 'uuid'),
      ('teacher_id', 'uuid'),
      ('title', 'text'),
      ('description', 'text'),
      ('event_type', 'text'),
      ('grade', 'integer'),
      ('stream', 'text'),
      ('subject_id', 'bigint'),
      ('start_at', 'timestamp with time zone'),
      ('end_at', 'timestamp with time zone'),
      ('all_day', 'boolean'),
      ('location', 'text'),
      ('meeting_url', 'text'),
      ('status', 'text'),
      ('is_visible_to_students', 'boolean'),
      ('source_table', 'text'),
      ('source_id', 'uuid'),
      ('created_at', 'timestamp with time zone'),
      ('updated_at', 'timestamp with time zone')
    ) as expected(column_name, data_type)
  loop
    if not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'calendar_events'
        and actual.column_name = required.column_name
        and actual.data_type = required.data_type
    ) then
      raise exception
        'public.calendar_events column % is missing or has an incompatible type (expected %).',
        required.column_name, required.data_type;
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.calendar_events
    where id is null
      or teacher_id is null
      or title is null
      or event_type is null
      or start_at is null
      or all_day is null
      or status is null
      or is_visible_to_students is null
      or created_at is null
      or updated_at is null
  ) then
    raise exception
      'Calendar events contain null values in required fields; resolve them before applying this migration.';
  end if;

  if exists (
    select 1
    from public.calendar_events
    where source_table is not null
      and source_id is not null
    group by source_table, source_id
    having count(*) > 1
  ) then
    raise exception
      'Duplicate linked calendar events exist; resolve duplicate (source_table, source_id) pairs before applying this migration.';
  end if;
end;
$$;

alter table public.calendar_events
  alter column id set default gen_random_uuid(),
  alter column teacher_id set not null,
  alter column title set not null,
  alter column event_type set not null,
  alter column start_at set not null,
  alter column all_day set default false,
  alter column all_day set not null,
  alter column status set default 'draft',
  alter column status set not null,
  alter column is_visible_to_students set default false,
  alter column is_visible_to_students set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.calendar_events'::regclass and attname = 'teacher_id')
      ]::smallint[]
  ) then
    alter table public.calendar_events
      add constraint calendar_events_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.calendar_events'::regclass and attname = 'subject_id')
      ]::smallint[]
  ) then
    alter table public.calendar_events
      add constraint calendar_events_subject_id_fkey
      foreign key (subject_id) references public.subjects(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_grade_valid'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_grade_valid
      check (grade is null or grade between 1 and 12) not valid;
    alter table public.calendar_events
      validate constraint calendar_events_grade_valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_source_pair'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_source_pair
      check (
        (source_table is null and source_id is null)
        or (source_table is not null and source_id is not null)
      ) not valid;
    alter table public.calendar_events
      validate constraint calendar_events_source_pair;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_valid_time'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_valid_time
      check (end_at is null or end_at >= start_at) not valid;
    alter table public.calendar_events
      validate constraint calendar_events_valid_time;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_status_check'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_status_check
      check (status in ('draft', 'scheduled', 'published', 'completed', 'cancelled'))
      not valid;
    alter table public.calendar_events
      validate constraint calendar_events_status_check;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.calendar_events
    where event_type not in (
      'event', 'class', 'live_class', 'quiz', 'exam', 'assignment', 'material',
      'announcement', 'holiday', 'meeting', 'other'
    )
  ) then
    raise exception
      'Calendar events contain an event_type unsupported by this migration; review those rows before applying it.';
  end if;
end;
$$;

alter table public.calendar_events
  drop constraint if exists calendar_events_event_type_check;

alter table public.calendar_events
  add constraint calendar_events_event_type_check
  check (
    event_type in (
      'event', 'class', 'live_class', 'quiz', 'exam', 'assignment', 'material',
      'announcement', 'holiday', 'meeting', 'other'
    )
  ) not valid;

alter table public.calendar_events
  validate constraint calendar_events_event_type_check;

create unique index if not exists calendar_events_source_unique_idx
  on public.calendar_events (source_table, source_id)
  where source_table is not null and source_id is not null;

create index if not exists calendar_events_teacher_start_idx
  on public.calendar_events (teacher_id, start_at);

create index if not exists calendar_events_grade_stream_start_idx
  on public.calendar_events (grade, stream, start_at)
  where grade is not null;

create index if not exists calendar_events_student_feed_idx
  on public.calendar_events (status, is_visible_to_students, start_at, grade, stream);

create or replace function public.set_calendar_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_calendar_event_updated_at() from public, anon, authenticated;

drop trigger if exists calendar_events_updated_at_trigger on public.calendar_events;
create trigger calendar_events_updated_at_trigger
  before update on public.calendar_events
  for each row execute function public.set_calendar_event_updated_at();

create or replace function public.calendar_teacher_owns_event(requested_teacher_id uuid)
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

create or replace function public.calendar_teacher_scope_allowed(
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
    and (
      (requested_grade between 5 and 10 and requested_stream is null)
      or
      (requested_grade between 11 and 12 and requested_stream is not null)
    )
    and exists (
      select 1
      from public.teachers teacher
      join public.teacher_grade_groups grade_group
        on grade_group.teacher_id = teacher.id
      where teacher.id = requested_teacher_id
        and teacher.user_id = (select auth.uid())
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
              from public.teacher_grade_groups grade_group
              where grade_group.teacher_id = requested_teacher_id
                and grade_group.grade = requested_grade
                and grade_group.stream is not distinct from requested_stream
                and grade_group.teach_all_subjects
            )
          )
      )
    );
$$;

create or replace function public.calendar_student_can_view_event(
  requested_grade integer,
  requested_stream text,
  requested_subject_id bigint,
  requested_source_table text,
  requested_source_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  announcement_allowed boolean;
  source_allowed boolean;
begin
  if requested_source_table = 'live_classes' then
    if requested_source_id is null
      or to_regprocedure(
        'public.live_class_student_can_view(uuid,integer,text,text)'
      ) is null then
      return false;
    end if;

    execute
      'select exists (
         select 1
         from public.live_classes live
         where live.id = $1
           and live.publication_status = ''published''
           and lower(coalesce(live.status, '''')) not in (''cancelled'', ''canceled'')
           and live.grade::integer = $2
           and live.stream is not distinct from $3
           and live.subject_id::text = $4::text
           and public.live_class_student_can_view(
             live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
           )
       )'
      into source_allowed
      using requested_source_id, requested_grade, requested_stream, requested_subject_id;
    return coalesce(source_allowed, false);
  end if;

  if requested_source_table = 'announcements' then
    if requested_source_id is null
      or to_regclass('public.announcements') is null
      or to_regprocedure('public.current_user_is_announcement_recipient(uuid)') is null then
      return false;
    end if;

    execute
      'select exists (
         select 1
         from public.announcements announcement
         where announcement.id = $1
           and lower(btrim(announcement.status)) = ''published''
       )
       and public.current_user_is_announcement_recipient($1)'
      into announcement_allowed
      using requested_source_id;
    if not coalesce(announcement_allowed, false) then
      return false;
    end if;
  elsif requested_source_table = 'materials' then
    if requested_source_id is null then
      return false;
    end if;
    if to_regprocedure('public.student_can_view_material(uuid)') is null then
      return false;
    end if;

    execute
      'select exists (
         select 1
         from public.materials material
         where material.id = $1
           and public.student_can_view_material(material.id)
           and material.grade = $2
           and nullif(btrim(material.stream), '''') is not distinct from $3
           and material.subject_id = $4
       )'
      into source_allowed
      using requested_source_id, requested_grade, requested_stream, requested_subject_id;
    if not coalesce(source_allowed, false) then
      return false;
    end if;
  end if;

  return exists (
    select 1
    from public.students student
    where student.user_id = (select auth.uid())
      and student.grade = requested_grade
      and student.stream is not distinct from requested_stream
      and (
        requested_subject_id is null
        or exists (
          select 1
          from public.subjects subject
          where subject.id = requested_subject_id
            and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
            and (
              student.grade between 5 and 10
              or coalesce(subject.streams, '{}'::text[]) @> array[student.stream]
            )
        )
      )
  );
end;
$$;

create or replace function public.calendar_teacher_profile_id(requested_teacher_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select teacher.id
  from public.teachers teacher
  where teacher.id = requested_teacher_id
     or teacher.user_id = requested_teacher_id
  order by (teacher.id = requested_teacher_id) desc
  limit 1;
$$;

create or replace function public.calendar_normalize_grade(requested_grade text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (regexp_match(
    btrim(requested_grade),
    '^(?:(?:class|grade)\s*)?(5|6|7|8|9|10|11|12)$',
    'i'
  ))[1]::integer;
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
    event.id::text,
    coalesce(event.source_table, 'calendar_events'),
    event.event_type,
    event.title,
    event.description,
    event.grade::text,
    event.stream,
    subject.name,
    event.start_at,
    event.end_at,
    event.status,
    teacher.full_name,
    coalesce(event.location, event.meeting_url),
    null::text,
    case
      when event.end_at is null then null::integer
      else floor(extract(epoch from (event.end_at - event.start_at)) / 60)::integer
    end,
    null::integer,
    null::timestamptz
  from public.calendar_events event
  left join public.teachers teacher on teacher.id = event.teacher_id
  left join public.subjects subject on subject.id = event.subject_id
  where requested_student_id = (select auth.uid())
    and event.status = 'published'
    and event.is_visible_to_students
    and public.calendar_student_can_view_event(
      event.grade,
      event.stream,
      event.subject_id,
      event.source_table,
      event.source_id
    )
  order by event.start_at;
$$;

create or replace function public.get_student_calendar_events_v2(requested_student_id uuid)
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
  meeting_url text,
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
    event.id::text,
    coalesce(event.source_table, 'calendar_events'),
    event.event_type,
    event.title,
    event.description,
    event.grade::text,
    event.stream,
    subject.name,
    event.start_at,
    event.end_at,
    event.status,
    teacher.full_name,
    event.location,
    event.meeting_url,
    case
      when event.end_at is null then null::integer
      else floor(extract(epoch from (event.end_at - event.start_at)) / 60)::integer
    end,
    null::integer,
    null::timestamptz
  from public.calendar_events event
  left join public.teachers teacher on teacher.id = event.teacher_id
  left join public.subjects subject on subject.id = event.subject_id
  where requested_student_id = (select auth.uid())
    and event.status = 'published'
    and event.is_visible_to_students
    and public.calendar_student_can_view_event(
      event.grade,
      event.stream,
      event.subject_id,
      event.source_table,
      event.source_id
    )
  order by event.start_at;
$$;

create or replace function public.sync_announcement_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  calendar_status text;
  calendar_start timestamptz;
  calendar_teacher_id uuid;
  calendar_grade integer;
begin
  if tg_op = 'DELETE' then
    delete from public.calendar_events
    where source_table = 'announcements'
      and source_id = old.id;
    return old;
  end if;

  calendar_status := case lower(btrim(new.status))
    when 'published' then 'published'
    when 'scheduled' then 'scheduled'
    when 'archived' then 'cancelled'
    else 'draft'
  end;

  calendar_start := case lower(btrim(new.status))
    when 'published' then coalesce(new.published_at, new.publish_at)
    when 'scheduled' then new.publish_at
    else null
  end;
  calendar_teacher_id := public.calendar_teacher_profile_id(new.teacher_id);
  calendar_grade := public.calendar_normalize_grade(new.grade::text);

  if calendar_status not in ('published', 'scheduled')
    or calendar_start is null
    or calendar_teacher_id is null
    or calendar_grade is null then
    update public.calendar_events
    set title = new.title,
        description = new.message,
        event_type = 'announcement',
        grade = calendar_grade,
        stream = nullif(btrim(new.stream), ''),
        subject_id = new.subject_id,
        status = case when calendar_status = 'cancelled' then 'cancelled' else 'draft' end,
        is_visible_to_students = false
    where source_table = 'announcements'
      and source_id = new.id;
    return new;
  end if;

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
    status,
    is_visible_to_students,
    source_table,
    source_id
  )
  values (
    calendar_teacher_id,
    new.title,
    new.message,
    'announcement',
    calendar_grade,
    nullif(btrim(new.stream), ''),
    new.subject_id,
    calendar_start,
    null,
    false,
    calendar_status,
    lower(btrim(new.status)) = 'published',
    'announcements',
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
    status = excluded.status,
    is_visible_to_students = excluded.is_visible_to_students;

  return new;
end;
$$;

create or replace function public.sync_quiz_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  calendar_status text;
  calendar_teacher_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.calendar_events
    where source_table = 'quizzes'
      and source_id = old.id;
    return old;
  end if;

  calendar_status := case lower(btrim(new.status))
    when 'published' then 'published'
    when 'scheduled' then 'scheduled'
    when 'archived' then 'cancelled'
    else 'draft'
  end;
  calendar_teacher_id := public.calendar_teacher_profile_id(new.teacher_id);

  if new.start_at is null
    or new.subject_id is null
    or calendar_teacher_id is null then
    update public.calendar_events
    set title = new.title,
        description = new.description,
        event_type = 'quiz',
        grade = new.grade,
        stream = new.stream,
        subject_id = new.subject_id,
        status = case when calendar_status = 'cancelled' then 'cancelled' else 'draft' end,
        is_visible_to_students = false
    where source_table = 'quizzes'
      and source_id = new.id;
    return new;
  end if;

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
    status,
    is_visible_to_students,
    source_table,
    source_id
  )
  values (
    calendar_teacher_id,
    new.title,
    new.description,
    'quiz',
    new.grade,
    new.stream,
    new.subject_id,
    new.start_at,
    coalesce(
      new.end_at,
      case when new.duration_minutes > 0
        then new.start_at + make_interval(mins => new.duration_minutes)
        else null
      end
    ),
    false,
    calendar_status,
    lower(btrim(new.status)) = 'published'
      and lower(btrim(new.student_access)) = 'class',
    'quizzes',
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
    status = excluded.status,
    is_visible_to_students = excluded.is_visible_to_students;

  return new;
end;
$$;

create or replace function public.sync_material_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  calendar_teacher_id uuid;
  calendar_grade integer;
  calendar_status text;
begin
  if tg_op = 'DELETE' then
    delete from public.calendar_events
    where source_table = 'materials'
      and source_id = old.id;
    return old;
  end if;

  calendar_teacher_id := public.calendar_teacher_profile_id(new.teacher_id);
  calendar_grade := new.grade;
  calendar_status := 'published';

  if new.created_at is null
    or new.subject_id is null
    or calendar_teacher_id is null
    or calendar_grade is null then
    update public.calendar_events
    set title = new.title,
        description = new.description,
        event_type = 'material',
        grade = calendar_grade,
        stream = nullif(btrim(new.stream), ''),
        subject_id = new.subject_id,
        status = case when calendar_status = 'cancelled' then 'cancelled' else 'draft' end,
        is_visible_to_students = false
    where source_table = 'materials'
      and source_id = new.id;
    return new;
  end if;

  insert into public.calendar_events (
    teacher_id,
    title,
    description,
    event_type,
    grade,
    stream,
    subject_id,
    start_at,
    all_day,
    status,
    is_visible_to_students,
    source_table,
    source_id
  )
  values (
    calendar_teacher_id,
    new.title,
    new.description,
    'material',
    calendar_grade,
    nullif(btrim(new.stream), ''),
    new.subject_id,
    new.created_at,
    true,
    calendar_status,
    true,
    'materials',
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
    all_day = excluded.all_day,
    status = excluded.status,
    is_visible_to_students = excluded.is_visible_to_students;

  return new;
end;
$$;

create or replace function public.calendar_live_class_start_at(
  requested_teacher_id uuid,
  requested_date date,
  requested_time time without time zone
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  teacher_timezone text;
begin
  if requested_date is null or requested_time is null then
    return null;
  end if;

  if to_regclass('public.teacher_settings') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'teacher_settings'
        and column_name = 'timezone'
    ) then
    execute
      'select nullif(btrim(settings.timezone), '''')
       from public.teacher_settings settings
       where settings.teacher_id = $1'
      into teacher_timezone
      using requested_teacher_id;
  end if;

  teacher_timezone := coalesce(teacher_timezone, 'Asia/Kolkata');

  if not exists (
    select 1
    from pg_timezone_names
    where name = teacher_timezone
  ) then
    raise exception 'Invalid teacher timezone configured for calendar sync: %', teacher_timezone;
  end if;

  return (requested_date + requested_time) at time zone teacher_timezone;
end;
$$;

create or replace function public.sync_live_class_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  calendar_start timestamptz;
  calendar_teacher_id uuid;
  calendar_grade integer;
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
  calendar_teacher_id := public.calendar_teacher_profile_id(new.teacher_id);
  calendar_grade := public.calendar_normalize_grade(new.grade::text);
  calendar_start := public.calendar_live_class_start_at(
    new.teacher_id,
    new.class_date,
    new.start_time
  );

  if calendar_start is null
    or calendar_teacher_id is null
    or calendar_grade is null then
    update public.calendar_events
    set status = 'draft',
        is_visible_to_students = false
    where source_table = 'live_classes'
      and source_id = new.id;
    return new;
  end if;

  calendar_status := case
    when coalesce(to_jsonb(new)->>'publication_status', 'published') <> 'published'
      then 'draft'
    when normalized_status in ('scheduled', 'live') then 'published'
    when normalized_status in ('completed', 'missed', 'attended') then 'completed'
    when normalized_status in ('cancelled', 'canceled') then 'cancelled'
    else null
  end;

  if calendar_status is null then
    raise exception 'Unsupported live_classes.status value: %', new.status;
  end if;

  student_visible :=
    coalesce(to_jsonb(new)->>'publication_status', 'published') = 'published'
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
    calendar_teacher_id,
    new.title,
    coalesce(new.description, new.topic, new.chapter),
    'live_class',
    calendar_grade,
    new.stream,
    new.subject_id,
    calendar_start,
    calendar_start + make_interval(mins => new.duration_minutes),
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

-- Material events use created_at as the activity date; the materials schema has
-- no status column, so stored teacher-uploaded materials are student-visible.
insert into public.calendar_events (
  teacher_id,
  title,
  description,
  event_type,
  grade,
  stream,
  subject_id,
  start_at,
  all_day,
  status,
  is_visible_to_students,
  source_table,
  source_id
)
select
  public.calendar_teacher_profile_id(material.teacher_id),
  material.title,
  material.description,
  'material',
  material.grade,
  nullif(btrim(material.stream), ''),
  material.subject_id,
  material.created_at,
  true,
  'published',
  true,
  'materials',
  material.id
from public.materials material
where material.created_at is not null
  and material.subject_id is not null
  and material.grade between 5 and 12
  and public.calendar_teacher_profile_id(material.teacher_id) is not null
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
  all_day = excluded.all_day,
  status = excluded.status,
  is_visible_to_students = excluded.is_visible_to_students;

-- Quiz events use only the quiz's explicit availability start_at; null dates are not inferred.
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
  status,
  is_visible_to_students,
  source_table,
  source_id
)
select
  public.calendar_teacher_profile_id(quiz.teacher_id),
  quiz.title,
  quiz.description,
  'quiz',
  quiz.grade,
  quiz.stream,
  quiz.subject_id,
  quiz.start_at,
  coalesce(
    quiz.end_at,
    case when quiz.duration_minutes > 0
      then quiz.start_at + make_interval(mins => quiz.duration_minutes)
      else null
    end
  ),
  false,
  case lower(btrim(quiz.status))
    when 'published' then 'published'
    when 'scheduled' then 'scheduled'
    when 'archived' then 'cancelled'
    else 'draft'
  end,
  lower(btrim(quiz.status)) = 'published'
    and lower(btrim(quiz.student_access)) = 'class',
  'quizzes',
  quiz.id
from public.quizzes quiz
where quiz.start_at is not null
  and quiz.subject_id is not null
  and public.calendar_teacher_profile_id(quiz.teacher_id) is not null
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
  status = excluded.status,
  is_visible_to_students = excluded.is_visible_to_students;

-- Live classes have explicit class_date/start_time and are optional in deployments.
do $$
begin
  if to_regclass('public.live_classes') is not null then
    execute $sync$
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
  public.calendar_teacher_profile_id(live.teacher_id),
  live.title,
  coalesce(live.description, live.topic, live.chapter),
  'live_class',
  public.calendar_normalize_grade(live.grade::text),
  live.stream,
  live.subject_id,
  public.calendar_live_class_start_at(live.teacher_id, live.class_date, live.start_time),
  public.calendar_live_class_start_at(live.teacher_id, live.class_date, live.start_time)
    + make_interval(mins => live.duration_minutes),
  false,
  null,
  case lower(btrim(live.status))
    when 'scheduled' then 'published'
    when 'live' then 'published'
    when 'completed' then 'completed'
    when 'missed' then 'completed'
    when 'attended' then 'completed'
    when 'cancelled' then 'cancelled'
  end,
  lower(btrim(live.status)) in ('scheduled', 'live'),
  'live_classes',
  live.id
from public.live_classes live
where lower(btrim(live.status)) in (
    'scheduled', 'live', 'completed', 'cancelled', 'missed', 'attended'
  )
  and live.class_date is not null
  and live.start_time is not null
  and public.calendar_normalize_grade(live.grade::text) is not null
  and public.calendar_teacher_profile_id(live.teacher_id) is not null
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
    $sync$;
  end if;
end;
$$;

-- Announcements are optional and require an explicit publish/scheduled timestamp.
do $$
begin
  if to_regclass('public.announcements') is not null then
    execute $sync$
      insert into public.calendar_events (
  teacher_id,
  title,
  description,
  event_type,
  grade,
  stream,
  subject_id,
  start_at,
  all_day,
  status,
  is_visible_to_students,
  source_table,
  source_id
)
select
  public.calendar_teacher_profile_id(announcement.teacher_id),
  announcement.title,
  announcement.message,
  'announcement',
  public.calendar_normalize_grade(announcement.grade::text),
  announcement.stream,
  announcement.subject_id,
  case lower(btrim(announcement.status))
    when 'published' then coalesce(announcement.published_at, announcement.publish_at)
    when 'scheduled' then announcement.publish_at
  end,
  false,
  lower(btrim(announcement.status)),
  lower(btrim(announcement.status)) = 'published',
  'announcements',
  announcement.id
from public.announcements announcement
where (
  (lower(btrim(announcement.status)) = 'published'
    and coalesce(announcement.published_at, announcement.publish_at) is not null)
  or
  (lower(btrim(announcement.status)) = 'scheduled' and announcement.publish_at is not null)
)
and public.calendar_normalize_grade(announcement.grade::text) is not null
and public.calendar_teacher_profile_id(announcement.teacher_id) is not null
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
  all_day = excluded.all_day,
  status = excluded.status,
  is_visible_to_students = excluded.is_visible_to_students;
    $sync$;
  end if;
end;
$$;

alter function public.sync_quiz_calendar_event() owner to postgres;
alter function public.sync_material_calendar_event() owner to postgres;
alter function public.calendar_teacher_profile_id(uuid) owner to postgres;
alter function public.calendar_normalize_grade(text) owner to postgres;
alter function public.calendar_live_class_start_at(uuid, date, time without time zone) owner to postgres;
alter function public.sync_live_class_calendar_event() owner to postgres;
alter function public.sync_announcement_calendar_event() owner to postgres;

alter function public.calendar_teacher_owns_event(uuid) owner to postgres;
alter function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) owner to postgres;
alter function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) owner to postgres;
alter function public.get_student_calendar_events(uuid) owner to postgres;
alter function public.get_student_calendar_events_v2(uuid) owner to postgres;

revoke all on function public.calendar_teacher_owns_event(uuid) from public, anon;
revoke all on function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) from public, anon;
revoke all on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) from public, anon;
revoke all on function public.calendar_teacher_profile_id(uuid) from public, anon, authenticated;
revoke all on function public.calendar_normalize_grade(text) from public, anon, authenticated;
revoke all on function public.get_student_calendar_events(uuid) from public, anon;
revoke all on function public.get_student_calendar_events_v2(uuid) from public, anon;
revoke all on function public.sync_quiz_calendar_event() from public, anon, authenticated;
revoke all on function public.sync_material_calendar_event() from public, anon, authenticated;
revoke all on function public.sync_announcement_calendar_event() from public, anon, authenticated;
revoke all on function public.calendar_live_class_start_at(uuid, date, time without time zone) from public, anon, authenticated;
revoke all on function public.sync_live_class_calendar_event() from public, anon, authenticated;

grant execute on function public.calendar_teacher_owns_event(uuid) to authenticated;
grant execute on function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) to authenticated;
grant execute on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) to authenticated;
grant execute on function public.get_student_calendar_events(uuid) to authenticated;
grant execute on function public.get_student_calendar_events_v2(uuid) to authenticated;

alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public, anon;
grant select, insert, update, delete on public.calendar_events to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_events'
      and policyname not in (
        'calendar_student_classwide_select',
        'calendar_student_select',
        'calendar_teacher_delete',
        'calendar_teacher_insert',
        'calendar_teacher_select',
        'calendar_teacher_update'
      )
  ) then
    raise exception
      'Unexpected calendar_events RLS policies exist. Review them before applying this migration; no calendar policy was replaced.';
  end if;
end;
$$;

drop policy if exists calendar_student_classwide_select on public.calendar_events;
drop policy if exists calendar_student_select on public.calendar_events;
drop policy if exists calendar_teacher_delete on public.calendar_events;
drop policy if exists calendar_teacher_insert on public.calendar_events;
drop policy if exists calendar_teacher_select on public.calendar_events;
drop policy if exists calendar_teacher_update on public.calendar_events;

create policy calendar_teacher_select
  on public.calendar_events
  for select to authenticated
  using (
    public.calendar_teacher_owns_event(teacher_id)
    and public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_teacher_insert
  on public.calendar_events
  for insert to authenticated
  with check (
    source_table is null
    and source_id is null
    and
    public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_teacher_update
  on public.calendar_events
  for update to authenticated
  using (
    source_table is null
    and source_id is null
    and public.calendar_teacher_owns_event(teacher_id)
    and public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  )
  with check (
    source_table is null
    and source_id is null
    and
    public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_teacher_delete
  on public.calendar_events
  for delete to authenticated
  using (
    source_table is null
    and source_id is null
    and public.calendar_teacher_owns_event(teacher_id)
    and public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_student_select
  on public.calendar_events
  for select to authenticated
  using (
    status = 'published'
    and is_visible_to_students
    and public.calendar_student_can_view_event(
      grade,
      stream,
      subject_id,
      source_table,
      source_id
    )
  );

drop trigger if exists quizzes_sync_calendar_event on public.quizzes;
create trigger quizzes_sync_calendar_event
  after insert or update
  on public.quizzes
  for each row execute function public.sync_quiz_calendar_event();

drop trigger if exists quizzes_delete_calendar_event on public.quizzes;
create trigger quizzes_delete_calendar_event
  after delete on public.quizzes
  for each row execute function public.sync_quiz_calendar_event();

drop trigger if exists materials_sync_calendar_event on public.materials;
create trigger materials_sync_calendar_event
  after insert or update on public.materials
  for each row execute function public.sync_material_calendar_event();

drop trigger if exists materials_delete_calendar_event on public.materials;
create trigger materials_delete_calendar_event
  after delete on public.materials
  for each row execute function public.sync_material_calendar_event();

do $$
begin
  if to_regclass('public.live_classes') is not null then
    execute 'drop trigger if exists live_classes_sync_calendar_event on public.live_classes';
    execute 'create trigger live_classes_sync_calendar_event
      after insert or update on public.live_classes
      for each row execute function public.sync_live_class_calendar_event()';
    execute 'drop trigger if exists live_classes_delete_calendar_event on public.live_classes';
    execute 'create trigger live_classes_delete_calendar_event
      after delete on public.live_classes
      for each row execute function public.sync_live_class_calendar_event()';
  end if;

  if to_regclass('public.announcements') is not null then
    execute 'drop trigger if exists announcements_sync_calendar_event on public.announcements';
    execute 'create trigger announcements_sync_calendar_event
      after insert or update on public.announcements
      for each row execute function public.sync_announcement_calendar_event()';
    execute 'drop trigger if exists announcements_delete_calendar_event on public.announcements';
    execute 'create trigger announcements_delete_calendar_event
      after delete on public.announcements
      for each row execute function public.sync_announcement_calendar_event()';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
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
