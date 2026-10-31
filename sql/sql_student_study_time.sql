begin;

do $$
begin
  if to_regclass('public.students') is null
    or to_regclass('public.subjects') is null then
    raise exception 'Study Time requires the existing public.students and public.subjects tables';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'user_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'grade' and data_type = 'integer'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'stream' and data_type = 'text'
  ) then
    raise exception 'Expected public.students(user_id uuid, grade integer, stream text)';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'id' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'name' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'grades' and udt_name = '_int4'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subjects'
      and column_name = 'streams' and udt_name = '_text'
  ) then
    raise exception 'Expected public.subjects(id bigint, name text, grades integer[], streams text[])';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'students'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(user_id)%'
  ) then
    raise exception 'public.students.user_id must be unique before Study Time can be enabled';
  end if;
end;
$$;

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject_id bigint not null references public.subjects(id) on delete restrict,
  subject text not null,
  topic text,
  start_time timestamptz not null default statement_timestamp(),
  last_resumed_at timestamptz not null default statement_timestamp(),
  pause_time timestamptz,
  end_time timestamptz,
  duration_seconds bigint not null default 0 check (duration_seconds >= 0),
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint study_sessions_state_check check (
    (status = 'active' and pause_time is null and end_time is null)
    or (status = 'paused' and pause_time is not null and end_time is null)
    or (status = 'completed' and end_time is not null)
  ),
  constraint study_sessions_id_student_unique unique (id, student_id)
);

create table if not exists public.study_session_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  student_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_seconds bigint not null check (duration_seconds >= 0),
  created_at timestamptz not null default statement_timestamp(),
  constraint study_session_segments_time_check check (end_time > start_time),
  constraint study_session_segments_session_owner_fkey
    foreign key (session_id, student_id)
    references public.study_sessions(id, student_id)
    on delete cascade
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_sessions'
      and column_name = 'subject_id' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_sessions'
      and column_name = 'student_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_sessions'
      and column_name = 'duration_seconds' and data_type = 'bigint'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_sessions'
      and column_name = 'last_resumed_at' and data_type = 'timestamp with time zone'
  ) then
    raise exception 'An existing public.study_sessions table has an incompatible schema';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_session_segments'
      and column_name = 'session_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_session_segments'
      and column_name = 'student_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_session_segments'
      and column_name = 'duration_seconds' and data_type = 'bigint'
  ) then
    raise exception 'An existing public.study_session_segments table has an incompatible schema';
  end if;
end;
$$;

create index if not exists study_sessions_student_start_idx
  on public.study_sessions (student_id, start_time desc);
create index if not exists study_sessions_student_subject_start_idx
  on public.study_sessions (student_id, subject_id, start_time desc);
create unique index if not exists study_sessions_one_open_per_student_idx
  on public.study_sessions (student_id)
  where status in ('active', 'paused');
create index if not exists study_session_segments_student_start_idx
  on public.study_session_segments (student_id, start_time desc);
create index if not exists study_session_segments_session_start_idx
  on public.study_session_segments (session_id, start_time);

alter table public.study_sessions enable row level security;
alter table public.study_session_segments enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('study_sessions', 'study_session_segments')
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

create policy study_sessions_select_own
  on public.study_sessions
  for select to authenticated
  using (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.students
      where students.user_id = (select auth.uid())
    )
  );

create policy study_session_segments_select_own
  on public.study_session_segments
  for select to authenticated
  using (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.students
      where students.user_id = (select auth.uid())
    )
  );

revoke all on public.study_sessions, public.study_session_segments
  from public, anon, authenticated;
grant select on public.study_sessions, public.study_session_segments
  to authenticated;

do $$
declare
  goal_column information_schema.columns%rowtype;
begin
  select *
  into goal_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'students'
    and column_name = 'daily_study_goal_minutes';

  if found then
    if goal_column.data_type <> 'integer' then
      raise exception 'students.daily_study_goal_minutes exists but is not integer';
    end if;
  else
    execute $create_goal_table$
      create table if not exists public.student_study_goals (
        student_id uuid primary key references auth.users(id) on delete cascade,
        daily_study_goal_minutes integer not null default 360
          check (daily_study_goal_minutes between 1 and 1440),
        updated_at timestamptz not null default statement_timestamp()
      )
    $create_goal_table$;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'student_study_goals'
        and column_name = 'student_id' and data_type = 'uuid'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'student_study_goals'
        and column_name = 'daily_study_goal_minutes' and data_type = 'integer'
    ) then
      raise exception 'An existing public.student_study_goals table has an incompatible schema';
    end if;

    alter table public.student_study_goals enable row level security;
    drop policy if exists student_study_goals_select_own
      on public.student_study_goals;
    create policy student_study_goals_select_own
      on public.student_study_goals
      for select to authenticated
      using (student_id = (select auth.uid()));
    revoke all on public.student_study_goals from public, anon, authenticated;
    grant select on public.student_study_goals to authenticated;
  end if;
end;
$$;

create or replace function public.get_student_daily_study_goal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  saved_minutes integer;
begin
  if current_user_id is null then
    raise exception 'Sign in to read your daily study goal';
  end if;
  if not exists (
    select 1 from public.students
    where students.user_id = current_user_id
  ) then
    raise exception 'No student profile is linked to this account';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'daily_study_goal_minutes'
  ) then
    execute
      'select daily_study_goal_minutes from public.students where user_id = $1'
      into saved_minutes
      using current_user_id;
  else
    execute
      'select daily_study_goal_minutes from public.student_study_goals where student_id = $1'
      into saved_minutes
      using current_user_id;
  end if;

  return greatest(1, least(1440, coalesce(saved_minutes, 360)));
end;
$$;

create or replace function public.set_student_daily_study_goal(requested_minutes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  saved_minutes integer;
begin
  if current_user_id is null then
    raise exception 'Sign in to update your daily study goal';
  end if;
  if requested_minutes is null or requested_minutes < 1 or requested_minutes > 1440 then
    raise exception 'Daily goal must be between 1 and 1440 minutes';
  end if;
  if not exists (
    select 1 from public.students
    where students.user_id = current_user_id
  ) then
    raise exception 'No student profile is linked to this account';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'daily_study_goal_minutes'
  ) then
    execute
      'update public.students
       set daily_study_goal_minutes = $1, updated_at = statement_timestamp()
       where user_id = $2
       returning daily_study_goal_minutes'
      into saved_minutes
      using requested_minutes, current_user_id;
  else
    execute
      'insert into public.student_study_goals
         (student_id, daily_study_goal_minutes, updated_at)
       values ($1, $2, statement_timestamp())
       on conflict (student_id) do update
         set daily_study_goal_minutes = excluded.daily_study_goal_minutes,
             updated_at = excluded.updated_at
       returning daily_study_goal_minutes'
      into saved_minutes
      using current_user_id, requested_minutes;
  end if;

  if saved_minutes is null then
    raise exception 'No student profile is linked to this account';
  end if;
  return saved_minutes;
end;
$$;

drop function if exists public.start_student_study_session(text, text);

create or replace function public.start_student_study_session(
  requested_subject_id bigint,
  requested_topic text default null
)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  student_exists boolean;
  registered_subject_name text;
  started_at timestamptz;
  created_session public.study_sessions;
begin
  if current_user_id is null then
    raise exception 'Sign in to start a study session';
  end if;
  perform 1
  from public.students
  where students.user_id = current_user_id
  for update;
  student_exists := found;
  if not student_exists then
    raise exception 'No student profile is linked to this account';
  end if;
  if requested_subject_id is null then
    raise exception 'Choose a subject in your registered curriculum';
  end if;
  if requested_topic is not null and char_length(btrim(requested_topic)) > 120 then
    raise exception 'Study topic must be 120 characters or fewer';
  end if;

  select subject.name
  into registered_subject_name
  from public.students student
  join public.subjects subject on subject.id = requested_subject_id
  where student.user_id = current_user_id
    and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
    and (
      student.grade between 5 and 10
      or exists (
        select 1
        from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
        where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
      )
    );

  if registered_subject_name is null then
    raise exception 'Choose a subject in your registered curriculum';
  end if;

  if exists (
    select 1 from public.study_sessions
    where student_id = current_user_id
      and status in ('active', 'paused')
  ) then
    raise exception 'A study session is already active. Resume or finish it first.';
  end if;
  started_at := clock_timestamp();

  insert into public.study_sessions (
    student_id, subject_id, subject, topic, start_time, last_resumed_at,
    status, duration_seconds
  )
  values (
    current_user_id, requested_subject_id, registered_subject_name,
    nullif(btrim(requested_topic), ''), started_at,
    started_at, 'active', 0
  )
  returning * into created_session;

  return created_session;
exception
  when unique_violation then
    raise exception 'A study session is already active. Resume or finish it first.';
end;
$$;

create or replace function public.pause_student_study_session(requested_session_id uuid)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session public.study_sessions;
  updated_session public.study_sessions;
  pause_at timestamptz;
  segment_seconds bigint;
begin
  if current_user_id is null then
    raise exception 'Sign in to pause a study session';
  end if;

  select * into current_session
  from public.study_sessions
  where id = requested_session_id
    and student_id = current_user_id
    and status = 'active'
  for update;

  if current_session.id is null then
    raise exception 'This study session is not active or is no longer available';
  end if;

  pause_at := clock_timestamp();
  segment_seconds := greatest(
    floor(extract(epoch from (pause_at - current_session.last_resumed_at)))::bigint,
    0
  );
  update public.study_sessions
  set duration_seconds = duration_seconds + segment_seconds,
      pause_time = pause_at,
      status = 'paused',
      updated_at = pause_at
  where id = current_session.id
    and student_id = current_user_id
  returning * into updated_session;

  if pause_at > current_session.last_resumed_at then
    insert into public.study_session_segments (
      session_id, student_id, start_time, end_time, duration_seconds
    )
    values (
      updated_session.id, updated_session.student_id,
      current_session.last_resumed_at, pause_at,
      segment_seconds
    );
  end if;

  return updated_session;
end;
$$;

create or replace function public.resume_student_study_session(requested_session_id uuid)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_session public.study_sessions;
begin
  if current_user_id is null then
    raise exception 'Sign in to resume a study session';
  end if;

  update public.study_sessions
  set last_resumed_at = clock_timestamp(),
      pause_time = null,
      status = 'active',
      updated_at = clock_timestamp()
  where id = requested_session_id
    and student_id = current_user_id
    and status = 'paused'
  returning * into updated_session;

  if updated_session.id is null then
    raise exception 'This study session is not paused or is no longer available';
  end if;
  return updated_session;
end;
$$;

create or replace function public.finish_student_study_session(requested_session_id uuid)
returns public.study_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session public.study_sessions;
  updated_session public.study_sessions;
  finish_at timestamptz;
  added_seconds bigint := 0;
begin
  if current_user_id is null then
    raise exception 'Sign in to finish a study session';
  end if;

  select * into current_session
  from public.study_sessions
  where id = requested_session_id
    and student_id = current_user_id
    and status in ('active', 'paused')
  for update;

  if current_session.id is null then
    raise exception 'This study session is not active or paused, or is no longer available';
  end if;

  finish_at := clock_timestamp();
  if current_session.status = 'active' then
    added_seconds := greatest(
      floor(extract(epoch from (finish_at - current_session.last_resumed_at)))::bigint,
      0
    );
    if finish_at > current_session.last_resumed_at then
      insert into public.study_session_segments (
        session_id, student_id, start_time, end_time, duration_seconds
      )
      values (
        current_session.id, current_session.student_id,
        current_session.last_resumed_at, finish_at, added_seconds
      );
    end if;
  end if;

  update public.study_sessions
  set duration_seconds = duration_seconds + added_seconds,
      end_time = finish_at,
      status = 'completed',
      updated_at = finish_at
  where id = current_session.id
    and student_id = current_user_id
    and status in ('active', 'paused')
  returning * into updated_session;

  if updated_session.id is null then
    raise exception 'This study session changed before it could be finished';
  end if;
  return updated_session;
end;
$$;

revoke all on function public.get_student_daily_study_goal()
  from public, anon, authenticated;
revoke all on function public.set_student_daily_study_goal(integer)
  from public, anon, authenticated;
revoke all on function public.start_student_study_session(bigint, text)
  from public, anon, authenticated;
revoke all on function public.pause_student_study_session(uuid)
  from public, anon, authenticated;
revoke all on function public.resume_student_study_session(uuid)
  from public, anon, authenticated;
revoke all on function public.finish_student_study_session(uuid)
  from public, anon, authenticated;

grant execute on function public.get_student_daily_study_goal()
  to authenticated;
grant execute on function public.set_student_daily_study_goal(integer)
  to authenticated;
grant execute on function public.start_student_study_session(bigint, text)
  to authenticated;
grant execute on function public.pause_student_study_session(uuid)
  to authenticated;
grant execute on function public.resume_student_study_session(uuid)
  to authenticated;
grant execute on function public.finish_student_study_session(uuid)
  to authenticated;

alter table public.study_sessions replica identity full;
alter table public.study_session_segments replica identity full;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not (
    select puballtables from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'study_sessions'
    ) then
      alter publication supabase_realtime add table public.study_sessions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'study_session_segments'
    ) then
      alter publication supabase_realtime add table public.study_session_segments;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
