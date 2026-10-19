begin;

do $$
begin
  if to_regclass('public.teachers') is null
    or to_regclass('public.students') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null
    or to_regclass('public.announcements') is null then
    raise exception
      'Calendar requires public.teachers, students, subjects, teacher_grade_groups, teacher_subject_assignments, and announcements.';
  end if;

  if to_regprocedure('public.current_user_is_announcement_recipient(uuid)') is null then
    raise exception
      'Calendar requires public.current_user_is_announcement_recipient(uuid) to preserve announcement recipient access.';
  end if;

  if exists (
    select 1
    from (values
      ('teachers', 'id', 'uuid'),
      ('teachers', 'user_id', 'uuid'),
      ('students', 'user_id', 'uuid'),
      ('students', 'grade', 'integer'),
      ('students', 'stream', 'text'),
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
    ) as required(table_name, column_name, data_type)
    where not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
        and actual.data_type = required.data_type
    )
  ) then
    raise exception
      'Calendar dependency columns do not match the verified Supabase schema.';
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
        from public.teacher_subject_assignments assignment
        where assignment.teacher_id = requested_teacher_id
          and assignment.grade = requested_grade
          and assignment.stream is not distinct from requested_stream
          and assignment.subject_id = requested_subject_id
      )
      or exists (
        select 1
        from public.teacher_grade_groups grade_group
        join public.subjects subject
          on subject.id = requested_subject_id
        where grade_group.teacher_id = requested_teacher_id
          and grade_group.grade = requested_grade
          and grade_group.stream is not distinct from requested_stream
          and grade_group.teach_all_subjects
          and coalesce(subject.grades, '{}'::integer[]) @> array[requested_grade]
          and (
            requested_grade between 5 and 10
            or coalesce(subject.streams, '{}'::text[]) @> array[requested_stream]
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
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
      and (
        requested_source_table is distinct from 'announcements'
        or (
          requested_source_id is not null
          and exists (
            select 1
            from public.announcements announcement
            where announcement.id = requested_source_id
              and announcement.status = 'published'
              and public.current_user_is_announcement_recipient(announcement.id)
          )
        )
      )
  );
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

create or replace function public.sync_announcement_calendar_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  calendar_status text;
  calendar_start timestamptz;
begin
  if tg_op = 'DELETE' then
    delete from public.calendar_events
    where source_table = 'announcements'
      and source_id = old.id;
    return old;
  end if;

  calendar_status := case lower(new.status)
    when 'published' then 'published'
    when 'scheduled' then 'scheduled'
    when 'archived' then 'cancelled'
    else 'draft'
  end;

  calendar_start := case lower(new.status)
    when 'published' then coalesce(new.published_at, new.publish_at, new.created_at)
    else coalesce(new.publish_at, new.published_at, new.created_at)
  end;

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
    new.teacher_id,
    new.title,
    new.message,
    'announcement',
    new.grade,
    new.stream,
    new.subject_id,
    calendar_start,
    null,
    false,
    calendar_status,
    lower(new.status) = 'published',
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

alter function public.calendar_teacher_owns_event(uuid) owner to postgres;
alter function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) owner to postgres;
alter function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) owner to postgres;
alter function public.get_student_calendar_events(uuid) owner to postgres;

revoke all on function public.calendar_teacher_owns_event(uuid) from public, anon;
revoke all on function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) from public, anon;
revoke all on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) from public, anon;
revoke all on function public.get_student_calendar_events(uuid) from public, anon;
revoke all on function public.sync_announcement_calendar_event() from public, anon, authenticated;

grant execute on function public.calendar_teacher_owns_event(uuid) to authenticated;
grant execute on function public.calendar_teacher_scope_allowed(uuid, integer, text, bigint) to authenticated;
grant execute on function public.calendar_student_can_view_event(integer, text, bigint, text, uuid) to authenticated;
grant execute on function public.get_student_calendar_events(uuid) to authenticated;

alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from anon;
grant select, insert, update, delete on public.calendar_events to authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_events'
  loop
    execute format(
      'drop policy %I on public.calendar_events',
      existing_policy.policyname
    );
  end loop;
end;
$$;

create policy calendar_teacher_select
  on public.calendar_events
  for select to authenticated
  using (public.calendar_teacher_owns_event(teacher_id));

create policy calendar_teacher_insert
  on public.calendar_events
  for insert to authenticated
  with check (
    public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_teacher_update
  on public.calendar_events
  for update to authenticated
  using (public.calendar_teacher_owns_event(teacher_id))
  with check (
    public.calendar_teacher_scope_allowed(teacher_id, grade, stream, subject_id)
  );

create policy calendar_teacher_delete
  on public.calendar_events
  for delete to authenticated
  using (public.calendar_teacher_owns_event(teacher_id));

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

drop trigger if exists announcements_sync_calendar_event on public.announcements;
create trigger announcements_sync_calendar_event
  after insert or update of
    teacher_id, title, message, grade, stream, subject_id, status,
    publish_at, published_at
  on public.announcements
  for each row execute function public.sync_announcement_calendar_event();

drop trigger if exists announcements_delete_calendar_event on public.announcements;
create trigger announcements_delete_calendar_event
  after delete on public.announcements
  for each row execute function public.sync_announcement_calendar_event();

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
