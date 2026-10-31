begin;

do $$
begin
  if to_regclass('public.students') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.student_profiles') is null
    or to_regclass('public.study_sessions') is null
    or to_regclass('public.study_session_segments') is null then
    raise exception 'Apply the existing student, subject, and study-session migrations first';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'student_id'
      and data_type = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'subject'
      and data_type = 'text'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'start_time'
      and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'end_time'
      and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'duration_seconds'
      and data_type = 'bigint'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_sessions'
      and column_name = 'status'
      and data_type = 'text'
  ) then
    raise exception 'The existing study_sessions schema does not match the verified study-tracking schema';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_session_segments'
      and column_name = 'session_id'
      and data_type = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_session_segments'
      and column_name = 'student_id'
      and data_type = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_session_segments'
      and column_name = 'start_time'
      and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_session_segments'
      and column_name = 'end_time'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'The existing study_session_segments schema does not match the verified session schema';
  end if;
end;
$$;

alter table public.student_profiles
  add column if not exists daily_study_goal_minutes integer not null default 360;
update public.student_profiles
set daily_study_goal_minutes = 360
where daily_study_goal_minutes is null
   or daily_study_goal_minutes < 1
   or daily_study_goal_minutes > 1440;
alter table public.student_profiles
  alter column daily_study_goal_minutes set default 360,
  alter column daily_study_goal_minutes set not null;

alter table public.study_sessions
  add column if not exists subject_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.study_sessions'::regclass
      and conname = 'study_sessions_subject_id_fkey'
  ) then
    alter table public.study_sessions
      add constraint study_sessions_subject_id_fkey
      foreign key (subject_id) references public.subjects(id) on delete set null;
  end if;
end;
$$;

with eligible_subject_matches as (
  select
    session.id as session_id,
    min(subject.id) as subject_id
  from public.study_sessions session
  join public.students student on student.user_id = session.student_id
  join public.subjects subject
    on lower(btrim(subject.name)) = lower(btrim(session.subject))
   and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
   and (
     student.grade between 5 and 10
     or exists (
       select 1
       from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
       where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
     )
   )
  where session.subject_id is null
  group by session.id
  having count(*) = 1
)
update public.study_sessions session
set subject_id = eligible_subject_matches.subject_id
from eligible_subject_matches
where session.id = eligible_subject_matches.session_id;

create index if not exists study_sessions_student_subject_time_idx
  on public.study_sessions (student_id, subject_id, start_time desc);
create unique index if not exists study_sessions_one_active_per_student
  on public.study_sessions (student_id)
  where status in ('active', 'paused');
create index if not exists study_session_segments_student_time_idx
  on public.study_session_segments (student_id, start_time desc);

alter table public.study_sessions enable row level security;
alter table public.study_session_segments enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('study_sessions', 'study_session_segments')
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;

create policy study_sessions_student_select_own
  on public.study_sessions
  for select to authenticated
  using (student_id = (select auth.uid()));

create policy study_session_segments_student_select_own
  on public.study_session_segments
  for select to authenticated
  using (student_id = (select auth.uid()));

revoke all on public.study_sessions, public.study_session_segments
  from public, anon, authenticated;
grant select on public.study_sessions, public.study_session_segments
  to authenticated;

drop policy if exists "Students update own profile goal" on public.student_profiles;
revoke insert, update, delete on public.student_profiles from anon, authenticated;
grant select on public.student_profiles to authenticated;

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
  current_grade integer;
  current_stream text;
  subject_name text;
  created_session public.study_sessions;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to start a study session';
  end if;

  select student.grade, student.stream, subject.name
  into current_grade, current_stream, subject_name
  from public.students student
  join public.subjects subject on subject.id = requested_subject_id
  where student.user_id = (select auth.uid())
    and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
    and (
      student.grade between 5 and 10
      or exists (
        select 1
        from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
        where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
      )
    );

  if subject_name is null then
    raise exception 'Choose a subject in your registered curriculum';
  end if;

  if exists (
    select 1
    from public.study_sessions session
    where session.student_id = (select auth.uid())
      and session.status in ('active', 'paused')
  ) then
    raise exception 'A study session is already active. Resume or finish it first.';
  end if;

  insert into public.study_sessions (
    student_id,
    subject,
    subject_id,
    topic,
    start_time,
    last_resumed_at,
    duration_seconds,
    status
  )
  values (
    (select auth.uid()),
    subject_name,
    requested_subject_id,
    nullif(btrim(requested_topic), ''),
    statement_timestamp(),
    statement_timestamp(),
    0,
    'active'
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
  updated_session public.study_sessions;
  pause_at timestamptz := statement_timestamp();
  segment_seconds bigint;
begin
  update public.study_sessions
  set duration_seconds = duration_seconds + greatest(
        floor(extract(epoch from (pause_at - last_resumed_at)))::bigint,
        0
      ),
      pause_time = pause_at,
      status = 'paused',
      updated_at = pause_at
  where id = requested_session_id
    and student_id = (select auth.uid())
    and status = 'active'
  returning * into updated_session;

  if updated_session.id is null then
    raise exception 'This study session is not active or is no longer available';
  end if;

  segment_seconds := greatest(
    floor(extract(epoch from (updated_session.pause_time - updated_session.last_resumed_at)))::bigint,
    0
  );
  insert into public.study_session_segments (
    session_id, student_id, start_time, end_time, duration_seconds
  )
  values (
    updated_session.id,
    updated_session.student_id,
    updated_session.last_resumed_at,
    updated_session.pause_time,
    segment_seconds
  );

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
  updated_session public.study_sessions;
begin
  update public.study_sessions
  set last_resumed_at = statement_timestamp(),
      status = 'active',
      updated_at = statement_timestamp()
  where id = requested_session_id
    and student_id = (select auth.uid())
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
  current_session public.study_sessions;
  updated_session public.study_sessions;
  finish_at timestamptz := statement_timestamp();
  added_seconds bigint := 0;
begin
  select *
  into current_session
  from public.study_sessions
  where id = requested_session_id
    and student_id = (select auth.uid())
    and status in ('active', 'paused')
  for update;

  if current_session.id is null then
    raise exception 'This study session is not active or paused, or is no longer available';
  end if;

  if current_session.status = 'active' then
    added_seconds := greatest(
      floor(extract(epoch from (finish_at - current_session.last_resumed_at)))::bigint,
      0
    );
    insert into public.study_session_segments (
      session_id, student_id, start_time, end_time, duration_seconds
    )
    values (
      current_session.id,
      current_session.student_id,
      current_session.last_resumed_at,
      finish_at,
      added_seconds
    );
  end if;

  update public.study_sessions
  set duration_seconds = duration_seconds + added_seconds,
      end_time = finish_at,
      status = 'completed',
      updated_at = finish_at
  where id = current_session.id
    and student_id = (select auth.uid())
    and status in ('active', 'paused')
  returning * into updated_session;

  if updated_session.id is null then
    raise exception 'This study session changed before it could be finished';
  end if;

  return updated_session;
end;
$$;

create or replace function public.set_student_daily_study_goal(requested_minutes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_minutes integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to update your daily study goal';
  end if;
  if requested_minutes is null or requested_minutes < 1 or requested_minutes > 1440 then
    raise exception 'Daily goal must be between 1 and 1440 minutes';
  end if;

  insert into public.student_profiles (
    student_id,
    student_code,
    grade,
    stream,
    eligible_subjects,
    daily_study_goal_minutes,
    updated_at
  )
  select
    student.user_id,
    student.student_id,
    student.grade::text,
    student.stream,
    coalesce((
      select array_agg(subject.name order by subject.name)
      from public.subjects subject
      where coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
        and (
          student.grade between 5 and 10
          or exists (
            select 1
            from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
            where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
          )
        )
    ), '{}'::text[]),
    requested_minutes,
    statement_timestamp()
  from public.students student
  where student.user_id = (select auth.uid())
  on conflict (student_id) do update
  set grade = excluded.grade,
      stream = excluded.stream,
      eligible_subjects = excluded.eligible_subjects,
      daily_study_goal_minutes = excluded.daily_study_goal_minutes,
      updated_at = excluded.updated_at
  returning daily_study_goal_minutes into saved_minutes;

  if saved_minutes is null then
    raise exception 'No student profile is linked to this account';
  end if;

  return saved_minutes;
end;
$$;

revoke all on function public.start_student_study_session(bigint, text)
  from public, anon, authenticated;
revoke all on function public.pause_student_study_session(uuid)
  from public, anon, authenticated;
revoke all on function public.resume_student_study_session(uuid)
  from public, anon, authenticated;
revoke all on function public.finish_student_study_session(uuid)
  from public, anon, authenticated;
revoke all on function public.set_student_daily_study_goal(integer)
  from public, anon, authenticated;
grant execute on function public.start_student_study_session(bigint, text)
  to authenticated;
grant execute on function public.pause_student_study_session(uuid)
  to authenticated;
grant execute on function public.resume_student_study_session(uuid)
  to authenticated;
grant execute on function public.finish_student_study_session(uuid)
  to authenticated;
grant execute on function public.set_student_daily_study_goal(integer)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
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
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'student_profiles'
    ) then
      alter publication supabase_realtime add table public.student_profiles;
    end if;
  end if;
end;
$$;

commit;
