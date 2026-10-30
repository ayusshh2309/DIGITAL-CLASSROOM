begin;

do $$
declare
  subject_id_type text;
  invalid_rows boolean;
  existing_fk record;
begin
  if to_regclass('public.live_classes') is null
    or to_regclass('public.teachers') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null
    or to_regclass('public.students') is null
    or to_regclass('public.subjects') is null then
    raise exception
      'Live classes require live_classes, teachers, teaching-scope tables, students, and subjects.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'id' and data_type = 'uuid'
  ) then
    raise exception 'public.live_classes.id must be uuid.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'teacher_id' and data_type = 'uuid'
  ) then
    raise exception 'public.live_classes.teacher_id must be uuid.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'title' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'status' and data_type = 'text'
  ) then
    raise exception 'public.live_classes must contain text title and status columns.';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into subject_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.subjects'::regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if subject_id_type is null then
    raise exception 'public.subjects.id was not found.';
  end if;
  if (
    select format_type(attribute.atttypid, attribute.atttypmod)
    from pg_attribute attribute
    where attribute.attrelid = 'public.teacher_subject_assignments'::regclass
      and attribute.attname = 'subject_id'
      and not attribute.attisdropped
  ) is distinct from subject_id_type then
    raise exception
      'teacher_subject_assignments.subject_id and subjects.id have incompatible types; correct the registration schema before applying this migration.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'subject_id'
  ) then
    execute format(
      'alter table public.live_classes add column subject_id %s',
      subject_id_type
    );
  else
    if (
      select format_type(attribute.atttypid, attribute.atttypmod)
      from pg_attribute attribute
      where attribute.attrelid = 'public.live_classes'::regclass
        and attribute.attname = 'subject_id'
        and not attribute.attisdropped
    ) <> subject_id_type then
      raise exception
        'public.live_classes.subject_id and public.subjects.id have incompatible types; inspect the schema before retrying.';
    end if;
  end if;
  if to_regclass('public.calendar_events') is not null and (
    select format_type(attribute.atttypid, attribute.atttypmod)
    from pg_attribute attribute
    where attribute.attrelid = 'public.calendar_events'::regclass
        and attribute.attname = 'subject_id'
        and not attribute.attisdropped
  ) is distinct from subject_id_type then
    raise exception
        'calendar_events.subject_id and subjects.id have incompatible types; resolve the Calendar schema mismatch before applying this migration.';
  end if;

  alter table public.live_classes
    add column if not exists grade integer,
    add column if not exists stream text,
    add column if not exists class_grade text,
    add column if not exists subject text,
    add column if not exists description text,
    add column if not exists topic text,
    add column if not exists chapter text,
    add column if not exists class_date date,
    add column if not exists start_time time without time zone,
    add column if not exists end_time time without time zone,
    add column if not exists start_at timestamptz,
    add column if not exists end_at timestamptz,
    add column if not exists duration_minutes integer,
    add column if not exists meeting_platform text,
    add column if not exists meeting_url text,
    add column if not exists publication_status text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

  if exists (
    select 1
    from (values
      ('grade', 'integer'),
      ('stream', 'text'),
      ('class_grade', 'text'),
      ('subject', 'text'),
      ('description', 'text'),
      ('topic', 'text'),
      ('chapter', 'text'),
      ('class_date', 'date'),
      ('start_time', 'time without time zone'),
      ('end_time', 'time without time zone'),
      ('start_at', 'timestamp with time zone'),
      ('end_at', 'timestamp with time zone'),
      ('duration_minutes', 'integer'),
      ('meeting_platform', 'text'),
      ('meeting_url', 'text'),
      ('publication_status', 'text')
    ) as expected(column_name, data_type)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'live_classes'
        and actual.column_name = expected.column_name
        and actual.data_type = expected.data_type
    )
    and expected.column_name <> 'grade'
  ) then
    raise exception
      'live_classes schedule or publication columns have incompatible types; inspect the catalog before applying this migration.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'grade' and data_type in ('smallint', 'integer', 'text')
  ) then
    raise exception 'public.live_classes.grade must be smallint, integer, or convertible text.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'grade' and data_type not in ('smallint', 'integer')
  ) then
    execute $migration$
      select exists (
        select 1
        from public.live_classes
        where grade is not null
          and btrim(grade::text) !~* '^(?:(class|grade)[[:space:]]*)?(5|6|7|8|9|10|11|12)$'
      )
    $migration$ into invalid_rows;
    if invalid_rows then
      raise exception
        'public.live_classes.grade contains unrecognized values; correct them before applying this migration.';
    end if;
    alter table public.live_classes
      alter column grade type integer
      using nullif(regexp_replace(grade::text, '[^0-9]', '', 'g'), '')::integer;
  end if;

  if exists (
    select 1
    from (values
      ('students', 'user_id', 'uuid'),
      ('students', 'grade', 'integer'),
      ('students', 'stream', 'text'),
      ('teachers', 'id', 'uuid'),
      ('teachers', 'user_id', 'uuid'),
      ('teacher_grade_groups', 'teacher_id', 'uuid'),
      ('teacher_grade_groups', 'stream', 'text'),
      ('teacher_grade_groups', 'teach_all_subjects', 'boolean'),
      ('teacher_subject_assignments', 'teacher_id', 'uuid'),
      ('teacher_subject_assignments', 'stream', 'text'),
      ('subjects', 'name', 'text'),
      ('subjects', 'grades', 'ARRAY'),
      ('subjects', 'streams', 'ARRAY')
    ) as expected(table_name, column_name, data_type)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = expected.table_name
        and actual.column_name = expected.column_name
        and actual.data_type = expected.data_type
    )
  ) then
    raise exception
      'Student, teacher, registration, or subject columns do not match the supported schema; inspect the catalog before applying this migration.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name = 'grades'
      and udt_name = '_int4'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name = 'streams'
      and udt_name = '_text'
  ) then
    raise exception
      'subjects.grades must be integer[] and subjects.streams must be text[] for live-class eligibility checks.';
  end if;
  if exists (
    select 1
    from (values
      ('teacher_grade_groups'),
      ('teacher_subject_assignments')
    ) as scope_table(table_name)
    where not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = scope_table.table_name
        and actual.column_name = 'grade'
        and actual.data_type in ('smallint', 'integer')
    )
  ) then
    raise exception
      'Teaching-scope grade columns must be smallint or integer.';
  end if;

  if to_regclass('public.calendar_events') is not null then
    if not exists (
      select 1
      from pg_trigger trigger_row
      join pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
      where relation_schema.nspname = 'public'
        and relation.relname = 'live_classes'
        and trigger_row.tgname = 'live_classes_sync_calendar_event'
        and not trigger_row.tgisinternal
    ) then
      raise exception
        'Calendar exists but live-class Calendar synchronization is not installed.';
    end if;
    execute 'drop trigger live_classes_sync_calendar_event on public.live_classes';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'class_grade'
  ) then
    update public.live_classes
    set grade = nullif(regexp_replace(class_grade, '[^0-9]', '', 'g'), '')::integer
    where grade is null and class_grade ~ '[0-9]';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'start_at'
  ) then
    update public.live_classes
    set class_date = (start_at at time zone 'Asia/Kolkata')::date,
        start_time = (start_at at time zone 'Asia/Kolkata')::time
    where start_at is not null
      and (class_date is null or start_time is null);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'duration_minutes'
  ) then
    update public.live_classes
    set duration_minutes = 60
    where duration_minutes is null or duration_minutes <= 0;
  end if;

  if exists (
    select 1
    from public.live_classes live
    where live.subject_id is null
      and live.subject is not null
      and (
        select count(*)
        from public.subjects subject
        where lower(btrim(subject.name)) = lower(btrim(live.subject))
      ) > 1
  ) then
    raise exception
      'Some legacy live classes have ambiguous subject names; assign subject IDs manually before applying this migration.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_classes'
      and column_name = 'subject'
  ) then
    execute $migration$
      update public.live_classes live
      set subject_id = subject.id
      from public.subjects subject
      where live.subject_id is null
        and lower(btrim(live.subject)) = lower(btrim(subject.name))
    $migration$;
  end if;

  update public.live_classes
  set class_grade = coalesce(class_grade, grade::text),
      duration_minutes = coalesce(duration_minutes, 60),
      publication_status = coalesce(
        publication_status,
        case
          when lower(coalesce(status, 'scheduled')) = 'cancelled'
            or nullif(btrim(meeting_platform), '') is null
            or nullif(btrim(meeting_url), '') is null
            then 'draft'
          else 'published'
        end
      ),
      created_at = coalesce(created_at, now()),
      updated_at = coalesce(updated_at, now());

  update public.live_classes
  set publication_status = 'draft'
  where publication_status = 'published'
    and (
      nullif(btrim(meeting_platform), '') is null
      or nullif(btrim(meeting_url), '') is null
    );

  if exists (
    select 1
    from public.live_classes live
    where live.grade is null
      or live.grade not between 5 and 12
      or live.subject_id is null
      or live.class_date is null
      or live.start_time is null
      or live.duration_minutes is null
      or live.duration_minutes <= 0
      or live.status is null
      or (live.end_time is not null and live.end_time <= live.start_time)
  ) then
    raise exception
      'Existing live-class rows are missing a grade, subject, schedule, duration, or valid status; repair them before applying this migration.';
  end if;

  if exists (
    select 1
    from public.live_classes live
    where lower(coalesce(live.publication_status, '')) not in ('draft', 'published')
  ) then
    raise exception
      'Existing live_classes.publication_status values must be draft or published.';
  end if;
  if exists (
    select 1
    from public.live_classes live
    where lower(live.status) not in (
      'scheduled', 'live', 'completed', 'cancelled', 'missed', 'attended'
    )
  ) then
    raise exception
      'Existing live_classes.status values are outside the supported lifecycle.';
  end if;

  if exists (
    select 1
    from public.live_classes live
    where not exists (
      select 1 from public.teachers teacher
      where teacher.id = live.teacher_id or teacher.user_id = live.teacher_id
    )
  ) then
    raise exception
      'Some live classes are not linked to a teacher profile or teacher auth user; resolve them before applying this migration.';
  end if;

  for existing_fk in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.live_classes'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.live_classes'::regclass and attname = 'teacher_id')
      ]::smallint[]
      and constraint_row.confrelid <> 'public.teachers'::regclass
  loop
    execute format(
      'alter table public.live_classes drop constraint %I',
      existing_fk.conname
    );
  end loop;

  update public.live_classes live
  set teacher_id = teacher.id
  from public.teachers teacher
  where live.teacher_id = teacher.user_id
    and not exists (
      select 1 from public.teachers current_teacher
      where current_teacher.id = live.teacher_id
    );

  update public.live_classes
  set start_at = (class_date + start_time) at time zone 'Asia/Kolkata',
      end_at = ((class_date + start_time) at time zone 'Asia/Kolkata')
        + make_interval(mins => duration_minutes)
  where start_at is null or end_at is null;

  if exists (
    select 1
    from public.live_classes live
    where live.meeting_url is not null
      and btrim(live.meeting_url) <> ''
      and live.meeting_url !~* '^https://[^[:space:]]+$'
  ) then
    raise exception
      'Some live-class meeting links are not valid HTTPS URLs; correct them before applying this migration.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and conname = 'live_classes_publication_status_check'
  ) then
    alter table public.live_classes
      add constraint live_classes_publication_status_check
      check (publication_status in ('draft', 'published'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and conname = 'live_classes_supported_status_check'
  ) then
    alter table public.live_classes
      add constraint live_classes_supported_status_check
      check (lower(status) in (
        'scheduled', 'live', 'completed', 'cancelled', 'missed', 'attended'
      )) not valid;
    alter table public.live_classes
      validate constraint live_classes_supported_status_check;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and conname = 'live_classes_https_meeting_url_check'
  ) then
    alter table public.live_classes
      add constraint live_classes_https_meeting_url_check
      check (
        meeting_url is null
        or btrim(meeting_url) = ''
        or meeting_url ~* '^https://[^[:space:]]+$'
      ) not valid;
    alter table public.live_classes
      validate constraint live_classes_https_meeting_url_check;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and conname = 'live_classes_valid_schedule_check'
  ) then
    alter table public.live_classes
      add constraint live_classes_valid_schedule_check
      check (
        grade between 5 and 12
        and duration_minutes > 0
        and end_at >= start_at
        and (end_time is null or end_time > start_time)
      ) not valid;
    alter table public.live_classes
      validate constraint live_classes_valid_schedule_check;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and conname = 'live_classes_published_meeting_required_check'
  ) then
    alter table public.live_classes
      add constraint live_classes_published_meeting_required_check
      check (
        publication_status <> 'published'
        or (
          meeting_platform is not null
          and btrim(meeting_platform) <> ''
          and meeting_url is not null
          and meeting_url ~* '^https://[[:alnum:]][^[:space:]]*$'
        )
      ) not valid;
    alter table public.live_classes
      validate constraint live_classes_published_meeting_required_check;
  end if;

  alter table public.live_classes
    alter column duration_minutes set default 60,
    alter column publication_status set default 'draft',
    alter column updated_at set default now();

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and contype = 'f'
      and confrelid = 'public.subjects'::regclass
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.live_classes'::regclass and attname = 'subject_id')
      ]::smallint[]
  ) then
    execute
      'alter table public.live_classes add constraint live_classes_subject_id_fkey '
      || 'foreign key (subject_id) references public.subjects(id) on delete restrict';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_classes'::regclass
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.live_classes'::regclass and attname = 'teacher_id')
      ]::smallint[]
      and confrelid = 'public.teachers'::regclass
  ) then
    alter table public.live_classes
      add constraint live_classes_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;
end;
$$;

create or replace function public.live_classes_normalize_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher_timezone text;
begin
  if to_regclass('public.teacher_settings') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'teacher_settings'
        and column_name = 'timezone'
    ) then
    execute
      'select nullif(btrim(settings.timezone), '''')
       from public.teacher_settings settings
       where settings.teacher_id = $1'
      into teacher_timezone
      using new.teacher_id;
  end if;

  teacher_timezone := coalesce(teacher_timezone, 'Asia/Kolkata');
  if not exists (
    select 1 from pg_timezone_names zone
    where zone.name = teacher_timezone
  ) then
    raise exception 'Invalid teacher timezone configured for live classes: %', teacher_timezone;
  end if;

  if new.class_date is null or new.start_time is null then
    raise exception 'A class date and start time are required.';
  end if;
  if new.end_time is null then
    new.end_time := new.start_time + make_interval(mins => coalesce(new.duration_minutes, 60));
  end if;
  if new.end_time <= new.start_time then
    raise exception 'The class end time must be later than its start time.';
  end if;

  new.start_at := (new.class_date + new.start_time) at time zone teacher_timezone;
  new.end_at := (new.class_date + new.end_time) at time zone teacher_timezone;
  new.duration_minutes := floor(extract(epoch from (new.end_at - new.start_at)) / 60)::integer;
  return new;
end;
$$;

alter function public.live_classes_normalize_schedule() owner to postgres;
revoke all on function public.live_classes_normalize_schedule() from public, anon, authenticated;
drop trigger if exists live_classes_normalize_schedule on public.live_classes;
create trigger live_classes_normalize_schedule
  before insert or update on public.live_classes
  for each row execute function public.live_classes_normalize_schedule();

update public.live_classes
set start_at = start_at;

create index if not exists live_classes_scope_schedule_idx
  on public.live_classes (grade, stream, class_date, start_time);
create index if not exists live_classes_teacher_schedule_idx
  on public.live_classes (teacher_id, class_date, start_time desc);

create or replace function public.live_class_teacher_scope_valid(
  requested_teacher_id uuid,
  requested_grade integer,
  requested_stream text,
  requested_subject_id text
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
    join public.teacher_grade_groups grade_group
      on grade_group.teacher_id = teacher.id
    join public.subjects subject
      on subject.id::text = requested_subject_id
    where teacher.id = requested_teacher_id
      and grade_group.grade = requested_grade
      and grade_group.stream is not distinct from nullif(btrim(requested_stream), '')
      and coalesce(subject.grades, '{}'::integer[]) @> array[requested_grade]
      and (
        requested_grade between 5 and 10
        or exists (
          select 1
          from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
          where lower(btrim(allowed_stream.stream)) = lower(btrim(requested_stream))
        )
      )
      and (
        coalesce(grade_group.teach_all_subjects, false)
        or exists (
          select 1
          from public.teacher_subject_assignments assignment
          where assignment.teacher_id = teacher.id
            and assignment.grade = requested_grade
            and assignment.stream is not distinct from nullif(btrim(requested_stream), '')
            and assignment.subject_id::text = requested_subject_id
        )
      )
  );
$$;

create or replace function public.live_class_teacher_scope_allowed(
  requested_teacher_id uuid,
  requested_grade integer,
  requested_stream text,
  requested_subject_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1 from public.teachers teacher
      where teacher.id = requested_teacher_id
        and teacher.user_id = (select auth.uid())
        and public.live_class_teacher_scope_valid(
          requested_teacher_id, requested_grade, requested_stream, requested_subject_id
        )
    );
$$;

create or replace function public.live_class_student_can_view(
  requested_teacher_id uuid,
  requested_grade integer,
  requested_stream text,
  requested_subject_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and public.live_class_teacher_scope_valid(
      requested_teacher_id, requested_grade, requested_stream, requested_subject_id
    )
    and exists (
      select 1
      from public.students student
      join public.subjects subject
        on subject.id::text = requested_subject_id
      where student.user_id = (select auth.uid())
        and student.grade = requested_grade
        and lower(coalesce(student.stream, '')) =
          lower(coalesce(nullif(btrim(requested_stream), ''), ''))
        and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
        and (
          student.grade between 5 and 10
          or exists (
            select 1
            from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
            where lower(btrim(allowed_stream.stream))
              = lower(btrim(student.stream))
          )
        )
    );
$$;

alter function public.live_class_teacher_scope_allowed(uuid, integer, text, text)
  owner to postgres;
alter function public.live_class_teacher_scope_valid(uuid, integer, text, text)
  owner to postgres;
alter function public.live_class_student_can_view(uuid, integer, text, text)
  owner to postgres;
revoke all on function public.live_class_teacher_scope_valid(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.live_class_teacher_scope_allowed(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.live_class_student_can_view(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.live_class_teacher_scope_allowed(uuid, integer, text, text)
  to authenticated;
grant execute on function public.live_class_student_can_view(uuid, integer, text, text)
  to authenticated;
do $$
begin
  if to_regprocedure('public.live_class_student_can_view(integer,text,text)') is not null then
    execute
      'revoke all on function public.live_class_student_can_view(integer, text, text) from public, anon, authenticated';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.get_student_calendar_events(uuid)') is not null then
    execute $migration$
      create or replace function public.get_student_calendar_events(
        requested_student_id uuid
      )
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
      security definer
      set search_path = ''
      as $function$
        select
          'class-' || live.id::text,
          'live_classes',
          case
            when lower(live.status) in ('cancelled', 'canceled')
              then 'rescheduled_class'
            else 'class'
          end,
          live.title,
          coalesce(live.description, live.topic, live.chapter),
          coalesce(live.class_grade, live.grade::text),
          live.stream,
          subject.name,
          live.start_at,
          live.end_at,
          live.status,
          teacher.full_name,
          null::text,
          null::text,
          live.duration_minutes,
          null::integer,
          null::timestamptz
        from public.live_classes live
        join public.students registered_student
          on registered_student.user_id = (select auth.uid())
        join public.teachers teacher on teacher.id = live.teacher_id
        join public.subjects subject on subject.id::text = live.subject_id::text
        where requested_student_id = (select auth.uid())
          and live.publication_status = 'published'
          and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
          and public.live_class_student_can_view(
            live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
          )

        union all

        select
          'material-' || material.id::text,
          'materials',
          'material',
          coalesce(material.title, material.name),
          material.description,
          material.class_grade,
          material.stream,
          material.subject,
          material.uploaded_at,
          material.uploaded_at,
          material.status,
          material.teacher_name,
          material.file_url,
          material.file_url,
          null::integer,
          null::integer,
          null::timestamptz
        from public.materials material
        join public.student_profiles student on student.student_id = (select auth.uid())
        where requested_student_id = (select auth.uid())
          and material.status = 'published'
          and material.class_grade = student.grade
          and (
            material.stream is null or material.stream = ''
            or lower(material.stream) = lower(coalesce(student.stream, ''))
          )
          and lower(material.subject) = any(
            select lower(value) from unnest(student.eligible_subjects) value
          )

        union all

        select
          'quiz-' || quiz.id::text,
          'quizzes',
          case when quiz.status = 'exam' then 'exam' else 'quiz' end,
          quiz.title,
          coalesce(quiz.description, quiz.instructions),
          quiz.class_grade,
          quiz.stream,
          quiz.subject,
          coalesce(quiz.start_at, quiz.published_at),
          coalesce(quiz.end_at, quiz.start_at, quiz.published_at),
          quiz.status,
          null::text,
          null::text,
          null::text,
          quiz.duration_minutes,
          quiz.question_count,
          null::timestamptz
        from public.quizzes quiz
        join public.student_profiles student on student.student_id = (select auth.uid())
        where requested_student_id = (select auth.uid())
          and quiz.status in ('published', 'scheduled')
          and quiz.class_grade = student.grade
          and (
            quiz.stream is null or quiz.stream = ''
            or lower(quiz.stream) = lower(coalesce(student.stream, ''))
          )
          and lower(quiz.subject) = any(
            select lower(value) from unnest(student.eligible_subjects) value
          )

        union all

        select
          'assignment-' || assignment.id::text,
          'assignments',
          'assignment',
          assignment.title,
          coalesce(assignment.description, assignment.instructions),
          assignment.class_grade,
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
        join public.student_profiles student on student.student_id = (select auth.uid())
        where requested_student_id = (select auth.uid())
          and assignment.status = 'published'
          and assignment.class_grade = student.grade
          and (
            assignment.stream is null or assignment.stream = ''
            or lower(assignment.stream) = lower(coalesce(student.stream, ''))
          )
          and lower(assignment.subject) = any(
            select lower(value) from unnest(student.eligible_subjects) value
          )

        union all

        select
          'holiday-' || holiday.id::text,
          'academic_calendar',
          holiday.event_type,
          holiday.title,
          holiday.description,
          coalesce(holiday.class_grade, student.grade),
          holiday.stream,
          null::text,
          holiday.start_at,
          coalesce(holiday.end_at, holiday.start_at),
          holiday.status,
          null::text,
          null::text,
          null::text,
          null::integer,
          null::integer,
          null::timestamptz
        from public.academic_calendar holiday
        join public.student_profiles student on student.student_id = (select auth.uid())
        where requested_student_id = (select auth.uid())
          and holiday.status = 'published'
          and (
            holiday.class_grade is null or holiday.class_grade = ''
            or holiday.class_grade = student.grade
          )
          and (
            holiday.stream is null or holiday.stream = ''
            or lower(holiday.stream) = lower(coalesce(student.stream, ''))
          )
      $function$
    $migration$;

    execute
      'alter function public.get_student_calendar_events(uuid) owner to postgres';
    execute
      'revoke all on function public.get_student_calendar_events(uuid) from public, anon';
    execute
      'grant execute on function public.get_student_calendar_events(uuid) to authenticated';
  end if;
end;
$$;

alter table public.live_classes enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'live_classes'
  loop
    execute format('drop policy %I on public.live_classes', existing_policy.policyname);
  end loop;
end;
$$;

create policy live_classes_teacher_select
  on public.live_classes for select to authenticated
  using (exists (
    select 1 from public.teachers teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  ));

create policy live_classes_teacher_insert
  on public.live_classes for insert to authenticated
  with check (
    publication_status in ('draft', 'published')
    and public.live_class_teacher_scope_allowed(
      teacher_id, grade::integer, stream, subject_id::text
    )
  );

create policy live_classes_teacher_update
  on public.live_classes for update to authenticated
  using (exists (
    select 1 from public.teachers teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  ))
  with check (
    publication_status in ('draft', 'published')
    and public.live_class_teacher_scope_allowed(
      teacher_id, grade::integer, stream, subject_id::text
    )
  );

create policy live_classes_teacher_delete
  on public.live_classes for delete to authenticated
  using (exists (
    select 1 from public.teachers teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  ));

create policy live_classes_student_select
  on public.live_classes for select to authenticated
  using (
    publication_status = 'published'
    and lower(coalesce(status, '')) not in ('cancelled', 'canceled')
    and public.live_class_student_can_view(
      teacher_id, grade::integer, stream, subject_id::text
    )
  );

revoke all on public.live_classes from public, anon, authenticated;
revoke select (meeting_url) on public.live_classes from public, anon, authenticated;
grant select (
  id, teacher_id, title, class_grade, subject, topic, grade, stream, subject_id,
  description, chapter, class_date, start_time, end_time, start_at, end_at,
  duration_minutes, meeting_platform, status, publication_status, created_at, updated_at
) on public.live_classes to authenticated;
grant insert (
  teacher_id, title, class_grade, subject, topic, grade, stream, subject_id,
  description, chapter, class_date, start_time, end_time, start_at, end_at,
  duration_minutes, meeting_platform, meeting_url, status, publication_status,
  created_at, updated_at
) on public.live_classes to authenticated;
grant update (
  teacher_id, title, class_grade, subject, topic, grade, stream, subject_id,
  description, chapter, class_date, start_time, end_time, start_at, end_at,
  duration_minutes, meeting_platform, meeting_url, status, publication_status,
  updated_at
) on public.live_classes to authenticated;
grant delete on public.live_classes to authenticated;

create table if not exists public.live_class_updates (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  teacher_id uuid not null,
  grade integer not null,
  stream text,
  subject_id text not null,
  publication_status text not null,
  status text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  updated_at timestamptz not null default now()
);

create index if not exists live_class_updates_teacher_idx
  on public.live_class_updates (teacher_id, updated_at desc);
alter table public.live_class_updates enable row level security;
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'live_class_updates'
  loop
    execute format('drop policy %I on public.live_class_updates', existing_policy.policyname);
  end loop;
end;
$$;
create policy live_class_updates_teacher_select
  on public.live_class_updates for select to authenticated
  using (exists (
    select 1 from public.teachers teacher
    where teacher.id = live_class_updates.teacher_id
      and teacher.user_id = (select auth.uid())
  ));
create policy live_class_updates_student_select
  on public.live_class_updates for select to authenticated
  using (
    publication_status = 'published'
    and public.live_class_student_can_view(teacher_id, grade, stream, subject_id)
  );
revoke all on public.live_class_updates from public, anon, authenticated;
grant select on public.live_class_updates to authenticated;

create or replace function public.live_classes_publish_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.live_class_updates
  where updated_at < now() - interval '30 days';

  if tg_op = 'DELETE' then
    if old.publication_status = 'published' then
      insert into public.live_class_updates (
        class_id, teacher_id, grade, stream, subject_id,
        publication_status, status, operation
      )
      values (
        old.id, old.teacher_id, old.grade::integer, old.stream, old.subject_id::text,
        old.publication_status, old.status, 'delete'
      );
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.publication_status = 'published' then
      insert into public.live_class_updates (
        class_id, teacher_id, grade, stream, subject_id,
        publication_status, status, operation
      )
      values (
        old.id, old.teacher_id, old.grade::integer, old.stream, old.subject_id::text,
        old.publication_status, old.status, 'update'
      );
    end if;
  end if;

  if new.publication_status = 'published' then
    insert into public.live_class_updates (
      class_id, teacher_id, grade, stream, subject_id,
      publication_status, status, operation
    )
    values (
      new.id, new.teacher_id, new.grade::integer, new.stream, new.subject_id::text,
      new.publication_status, new.status,
      case when tg_op = 'INSERT' then 'insert' else 'update' end
    );
  end if;

  return new;
end;
$$;

alter function public.live_classes_publish_update() owner to postgres;
revoke all on function public.live_classes_publish_update() from public, anon, authenticated;
drop trigger if exists live_classes_publish_update on public.live_classes;
create trigger live_classes_publish_update
  after insert or update or delete on public.live_classes
  for each row execute function public.live_classes_publish_update();

create or replace function public.get_student_live_classes()
returns table (
  id uuid,
  teacher_id uuid,
  teacher_name text,
  title text,
  description text,
  topic text,
  grade integer,
  stream text,
  subject_id text,
  subject_name text,
  start_at timestamptz,
  end_at timestamptz,
  class_date date,
  start_time time without time zone,
  end_time time without time zone,
  duration_minutes integer,
  status text,
  publication_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    live.id,
    live.teacher_id,
    teacher.full_name,
    live.title,
    live.description,
    live.topic,
    live.grade::integer,
    live.stream,
    live.subject_id::text,
    subject.name,
    live.start_at,
    live.end_at,
    live.class_date,
    live.start_time,
    live.end_time,
    live.duration_minutes,
    live.status,
    live.publication_status,
    live.created_at
  from public.live_classes live
  join public.teachers teacher on teacher.id = live.teacher_id
  join public.subjects subject on subject.id::text = live.subject_id::text
  where (select auth.uid()) is not null
    and live.publication_status = 'published'
    and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
    and public.live_class_student_can_view(
      live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
    )
  order by live.start_at asc, live.id;
$$;

create or replace function public.get_student_live_class_join_url(
  requested_class_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  meeting_link text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select live.meeting_url
    into meeting_link
  from public.live_classes live
  where live.id = requested_class_id
    and live.publication_status = 'published'
    and lower(coalesce(live.status, '')) in ('scheduled', 'live')
    and live.start_at - interval '10 minutes' <= now()
    and live.end_at >= now()
    and exists (
      select 1 from public.teachers teacher
      where teacher.id = live.teacher_id
    )
    and public.live_class_student_can_view(
      live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
    );

  if meeting_link is null or meeting_link !~* '^https://[^[:space:]]+$' then
    raise exception 'This class is not available to join right now.'
      using errcode = '42501';
  end if;
  return meeting_link;
end;
$$;

create or replace function public.get_teacher_live_class_meeting_url(
  requested_class_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  meeting_link text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  select live.meeting_url
    into meeting_link
  from public.live_classes live
  join public.teachers teacher on teacher.id = live.teacher_id
  where live.id = requested_class_id
    and teacher.user_id = (select auth.uid());

  if meeting_link is null or meeting_link !~* '^https://[[:alnum:]][^[:space:]]*$' then
    raise exception 'Meeting link not found or access denied.'
      using errcode = '42501';
  end if;
  return meeting_link;
end;
$$;

alter function public.get_student_live_classes() owner to postgres;
alter function public.get_student_live_class_join_url(uuid) owner to postgres;
alter function public.get_teacher_live_class_meeting_url(uuid) owner to postgres;
revoke all on function public.get_student_live_classes() from public, anon;
revoke all on function public.get_student_live_class_join_url(uuid) from public, anon;
revoke all on function public.get_teacher_live_class_meeting_url(uuid) from public, anon;
grant execute on function public.get_student_live_classes() to authenticated;
grant execute on function public.get_student_live_class_join_url(uuid) to authenticated;
grant execute on function public.get_teacher_live_class_meeting_url(uuid) to authenticated;

create or replace function public.live_classes_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.live_classes_set_updated_at() from public, anon, authenticated;
drop trigger if exists live_classes_set_updated_at on public.live_classes;
create trigger live_classes_set_updated_at
  before update on public.live_classes
  for each row execute function public.live_classes_set_updated_at();

do $$
begin
  if to_regclass('public.calendar_events') is not null then
    if to_regprocedure('public.calendar_teacher_profile_id(uuid)') is null
      or to_regprocedure('public.calendar_normalize_grade(text)') is null
      or to_regprocedure(
        'public.calendar_live_class_start_at(uuid,date,time without time zone)'
      ) is null then
      raise exception
        'Calendar live-class synchronization helpers are missing; review the Calendar migration before continuing.';
    end if;

    execute $migration$
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
      as $function$
      declare
        announcement_allowed boolean;
        source_allowed boolean;
      begin
        if requested_source_table = 'live_classes' then
          return requested_source_id is not null
            and exists (
              select 1
              from public.live_classes live
              where live.id = requested_source_id
                and live.publication_status = 'published'
                and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
                and live.grade::integer = requested_grade
                and live.stream is not distinct from requested_stream
                and live.subject_id::text = requested_subject_id::text
                and public.live_class_student_can_view(
                  live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
                )
            );
        end if;

        if requested_source_table = 'announcements' then
          if requested_source_id is null
            or to_regclass('public.announcements') is null
            or to_regprocedure('public.current_user_is_announcement_recipient(uuid)') is null then
            return false;
          end if;
          execute
            'select exists (
               select 1 from public.announcements announcement
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
          if requested_source_id is null then return false; end if;
          execute
            'select exists (
               select 1 from public.materials material
               where material.id = $1
                 and lower(btrim(material.status)) = ''published''
                 and public.calendar_normalize_grade(material.grade::text) = $2
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
                join public.student_profiles student_profile
                  on student_profile.student_id = student.user_id
                where subject.id = requested_subject_id
                  and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
                  and (
                    student.grade between 5 and 10
                    or exists (
                      select 1
                      from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
                      where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
                    )
                  )
                  and subject.name = any(student_profile.eligible_subjects)
              )
            )
        );
      end;
      $function$
    $migration$;

    execute
      'alter function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) owner to postgres';
    execute
      'revoke all on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) from public, anon';
    execute
      'grant execute on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) to authenticated';

    execute $migration$
      create or replace function public.sync_live_class_calendar_event()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $function$
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
          new.teacher_id, new.class_date, new.start_time
        );

        if calendar_start is null
          or calendar_teacher_id is null
          or calendar_grade is null then
          update public.calendar_events
          set status = 'draft',
              is_visible_to_students = false,
              meeting_url = null
          where source_table = 'live_classes'
            and source_id = new.id;
          return new;
        end if;

        calendar_status := case
          when new.publication_status <> 'published' then 'draft'
          when normalized_status in ('scheduled', 'live') then 'published'
          when normalized_status in ('completed', 'missed', 'attended') then 'completed'
          when normalized_status in ('cancelled', 'canceled') then 'cancelled'
          else null
        end;

        if calendar_status is null then
          raise exception 'Unsupported live_classes.status value: %', new.status;
        end if;

        student_visible :=
          new.publication_status = 'published'
          and normalized_status in ('scheduled', 'live');

        insert into public.calendar_events (
          teacher_id, title, description, event_type, grade, stream,
          subject_id, start_at, end_at, all_day, meeting_url, status,
          is_visible_to_students, source_table, source_id
        )
        values (
          calendar_teacher_id, new.title,
          coalesce(new.description, new.topic, new.chapter),
          'live_class', calendar_grade, new.stream, new.subject_id,
          calendar_start,
          calendar_start + make_interval(mins => new.duration_minutes),
          false, null, calendar_status, student_visible,
          'live_classes', new.id
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
      $function$
    $migration$;

    execute
      'alter function public.sync_live_class_calendar_event() owner to postgres';
    execute
      'revoke all on function public.sync_live_class_calendar_event() from public, anon, authenticated';
    execute 'drop trigger if exists zz_live_classes_calendar_access_sync on public.live_classes';
    execute 'drop trigger if exists live_classes_sync_calendar_event on public.live_classes';
    execute $migration$
      create trigger live_classes_sync_calendar_event
      after insert or update or delete on public.live_classes
      for each row execute function public.sync_live_class_calendar_event()
    $migration$;

    execute 'update public.live_classes set start_at = start_at';

    execute $migration$
      update public.calendar_events event
      set status = case
            when lower(coalesce(live.status, '')) in ('cancelled', 'canceled')
              then 'cancelled'
            when live.publication_status <> 'published' then 'draft'
            when lower(coalesce(live.status, '')) in ('completed', 'missed', 'attended')
              then 'completed'
            else 'published'
          end,
          is_visible_to_students =
            live.publication_status = 'published'
            and lower(coalesce(live.status, '')) in ('scheduled', 'live'),
          meeting_url = null
      from public.live_classes live
      where event.source_table = 'live_classes'
        and event.source_id = live.id
    $migration$;

    if to_regprocedure(
      'public.calendar_student_can_view_event(integer,text,bigint,text,uuid)'
    ) is null then
      raise exception
        'Calendar exists but its student-access function is missing; review the Calendar migration before continuing.';
    end if;

    execute 'drop policy if exists calendar_student_select on public.calendar_events';
    execute 'drop policy if exists calendar_student_classwide_select on public.calendar_events';
    execute $policy$
      create policy calendar_student_select
      on public.calendar_events
      for select to authenticated
      using (
        status = 'published'
        and is_visible_to_students
        and (
          (
            source_table = 'live_classes'
            and exists (
              select 1
              from public.live_classes live
              where live.id = calendar_events.source_id
                and live.publication_status = 'published'
                and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
                and live.grade::integer = calendar_events.grade
                and live.stream is not distinct from calendar_events.stream
                and live.subject_id::text = calendar_events.subject_id::text
                and public.live_class_student_can_view(
                  live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
                )
            )
          )
          or (
            coalesce(source_table, '') <> 'live_classes'
            and public.calendar_student_can_view_event(
              grade, stream, subject_id, source_table, source_id
            )
          )
        )
      )
    $policy$;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_classes'
    ) then
    if exists (
      select 1 from pg_publication
      where pubname = 'supabase_realtime' and puballtables
    ) or exists (
      select 1
      from pg_publication_namespace publication_namespace
      join pg_namespace relation_schema
        on relation_schema.oid = publication_namespace.pnnspid
      join pg_publication publication
        on publication.oid = publication_namespace.pnpubid
      where publication.pubname = 'supabase_realtime'
        and relation_schema.nspname = 'public'
    ) then
      raise exception
        'supabase_realtime includes all public tables; narrow its publication before exposing live-class updates.';
    end if;
    alter publication supabase_realtime drop table public.live_classes;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_class_updates'
    ) then
    alter publication supabase_realtime add table public.live_class_updates;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
