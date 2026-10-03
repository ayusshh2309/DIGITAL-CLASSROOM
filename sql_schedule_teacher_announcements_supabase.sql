begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not enabled in this Supabase project; no scheduled job was created';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'pg_cron scheduling functions are unavailable; no scheduled job was created';
  end if;
  if to_regclass('public.announcements') is null
    or to_regclass('public.announcement_recipients') is null
    or to_regclass('public.students') is null then
    raise exception 'Announcement and student tables must already exist; no scheduled job was created';
  end if;
  if to_regclass('public.announcement_recipients_announcement_student_key') is null then
    raise exception 'Apply sql_teacher_announcements_supabase.sql first to install duplicate protection; no scheduled job was created';
  end if;
  if exists (
    select required.table_name, required.column_name
    from (values
      ('announcements', 'id'),
      ('announcements', 'grade'),
      ('announcements', 'stream'),
      ('announcements', 'status'),
      ('announcements', 'publish_at'),
      ('announcements', 'published_at'),
      ('announcements', 'updated_at'),
      ('announcement_recipients', 'announcement_id'),
      ('announcement_recipients', 'student_id'),
      ('students', 'id'),
      ('students', 'grade'),
      ('students', 'stream')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns existing
      where existing.table_schema = 'public'
        and existing.table_name = required.table_name
        and existing.column_name = required.column_name
    )
  ) then
    raise exception 'Required announcement or student columns are missing; no scheduled job was created';
  end if;
end;
$$;

create or replace function public.publish_due_teacher_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  published_count integer;
begin
  with due as (
    select announcement.id
    from public.announcements announcement
    where announcement.status = 'scheduled'
      and announcement.publish_at <= now()
    for update skip locked
  ),
  published as (
    update public.announcements announcement
    set status = 'published',
        published_at = now(),
        updated_at = now()
    from due
    where announcement.id = due.id
    returning announcement.id, announcement.grade, announcement.stream
  ),
  inserted_recipients as (
    insert into public.announcement_recipients (announcement_id, student_id)
    select published.id, student.id
    from published
    join public.students student
      on student.grade::text = published.grade::text
     and (
       (published.grade::integer between 1 and 10 and student.stream is null)
       or
       (published.grade::integer in (11, 12) and student.stream is not distinct from published.stream)
     )
    on conflict (announcement_id, student_id) do nothing
    returning 1
  )
  select count(*)::integer into published_count from published;

  return coalesce(published_count, 0);
end;
$$;

alter function public.publish_due_teacher_announcements() owner to postgres;
revoke all on function public.publish_due_teacher_announcements() from public, anon, authenticated;
grant execute on function public.publish_due_teacher_announcements() to postgres;

do $$
declare
  job_record record;
begin
  for job_record in
    select jobid
    from cron.job
    where jobname = 'teacher-announcements-publish-due'
  loop
    perform cron.unschedule(job_record.jobid);
  end loop;

  perform cron.schedule(
    'teacher-announcements-publish-due',
    '* * * * *',
    'select public.publish_due_teacher_announcements();'
  );
end;
$$;

commit;
