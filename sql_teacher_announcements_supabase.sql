begin;

do $$
begin
  if to_regclass('public.announcements') is null then
    raise exception 'Expected public.announcements to exist; this migration will not create an announcements table';
  end if;
  if to_regclass('public.announcement_recipients') is null then
    raise exception 'Expected public.announcement_recipients to exist; this migration will not create a notification table';
  end if;
  if to_regclass('public.teachers') is null
    or to_regclass('public.students') is null then
    raise exception 'Expected public.teachers and public.students to exist before applying announcement policies';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.announcement_recipients
    group by announcement_id, student_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate announcement recipients exist; resolve duplicate announcement_id/student_id rows before applying this migration';
  end if;
end;
$$;

create unique index if not exists announcement_recipients_announcement_student_key
  on public.announcement_recipients (announcement_id, student_id);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;

create or replace function public.current_user_is_announcement_recipient(requested_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.announcement_recipients recipient
    join public.students student on student.id = recipient.student_id
    where recipient.announcement_id = requested_announcement_id
      and student.user_id = (select auth.uid())
  );
$$;

alter function public.current_user_is_announcement_recipient(uuid) owner to postgres;
revoke all on function public.current_user_is_announcement_recipient(uuid) from public, anon;
grant execute on function public.current_user_is_announcement_recipient(uuid) to authenticated;

create or replace function public.current_user_owns_announcement(requested_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.announcements announcement
    join public.teachers teacher on teacher.id = announcement.teacher_id
    where announcement.id = requested_announcement_id
      and teacher.user_id = (select auth.uid())
  );
$$;

alter function public.current_user_owns_announcement(uuid) owner to postgres;
revoke all on function public.current_user_owns_announcement(uuid) from public, anon;
grant execute on function public.current_user_owns_announcement(uuid) to authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('announcements', 'announcement_recipients')
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

drop policy if exists announcements_teacher_select_own on public.announcements;
create policy announcements_teacher_select_own
on public.announcements
for select to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = announcements.teacher_id
    and teacher.user_id = (select auth.uid())
));

drop policy if exists announcements_teacher_insert_own on public.announcements;
create policy announcements_teacher_insert_own
on public.announcements
for insert to authenticated
with check (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = announcements.teacher_id
      and teacher.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = announcements.teacher_id
      and grade_group.grade::text = announcements.grade::text
      and (
        (announcements.grade::integer between 1 and 10 and announcements.stream is null)
        or
        (announcements.grade::integer in (11, 12) and grade_group.stream is not distinct from announcements.stream)
      )
  )
  and (
    announcements.subject_id is null
    or exists (
      select 1 from public.teacher_subject_assignments assignment
      where assignment.teacher_id = announcements.teacher_id
        and assignment.grade::text = announcements.grade::text
        and assignment.stream is not distinct from announcements.stream
        and assignment.subject_id = announcements.subject_id
    )
    or exists (
      select 1 from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = announcements.teacher_id
        and grade_group.grade::text = announcements.grade::text
        and grade_group.stream is not distinct from announcements.stream
        and grade_group.teach_all_subjects
    )
  )
);

drop policy if exists announcements_teacher_update_own on public.announcements;
create policy announcements_teacher_update_own
on public.announcements
for update to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = announcements.teacher_id
    and teacher.user_id = (select auth.uid())
))
with check (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = announcements.teacher_id
      and teacher.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = announcements.teacher_id
      and grade_group.grade::text = announcements.grade::text
      and (
        (announcements.grade::integer between 1 and 10 and announcements.stream is null)
        or
        (announcements.grade::integer in (11, 12) and grade_group.stream is not distinct from announcements.stream)
      )
  )
  and (
    announcements.subject_id is null
    or exists (
      select 1 from public.teacher_subject_assignments assignment
      where assignment.teacher_id = announcements.teacher_id
        and assignment.grade::text = announcements.grade::text
        and assignment.stream is not distinct from announcements.stream
        and assignment.subject_id = announcements.subject_id
    )
    or exists (
      select 1 from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = announcements.teacher_id
        and grade_group.grade::text = announcements.grade::text
        and grade_group.stream is not distinct from announcements.stream
        and grade_group.teach_all_subjects
    )
  )
);

drop policy if exists announcements_teacher_delete_own on public.announcements;
create policy announcements_teacher_delete_own
on public.announcements
for delete to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = announcements.teacher_id
    and teacher.user_id = (select auth.uid())
));

drop policy if exists announcements_student_select_assigned on public.announcements;
create policy announcements_student_select_assigned
on public.announcements
for select to authenticated
using (
  announcements.status = 'published'
  and public.current_user_is_announcement_recipient(announcements.id)
);

drop policy if exists announcement_recipients_select_authorized on public.announcement_recipients;
create policy announcement_recipients_select_authorized
on public.announcement_recipients
for select to authenticated
using (
  exists (
    select 1 from public.students student
    where student.id = announcement_recipients.student_id
      and student.user_id = (select auth.uid())
  )
  or public.current_user_owns_announcement(announcement_recipients.announcement_id)
);

drop policy if exists announcement_recipients_teacher_insert_matching_students on public.announcement_recipients;
create policy announcement_recipients_teacher_insert_matching_students
on public.announcement_recipients
for insert to authenticated
with check (exists (
  select 1
  from public.announcements announcement
  join public.teachers teacher on teacher.id = announcement.teacher_id
  join public.students student on student.id = announcement_recipients.student_id
  where announcement.id = announcement_recipients.announcement_id
    and announcement.status = 'published'
    and teacher.user_id = (select auth.uid())
    and student.grade::text = announcement.grade::text
    and (
      (announcement.grade::integer between 1 and 10 and student.stream is null)
      or
      (announcement.grade::integer in (11, 12) and student.stream is not distinct from announcement.stream)
    )
));

drop policy if exists announcement_recipients_student_mark_read on public.announcement_recipients;
create policy announcement_recipients_student_mark_read
on public.announcement_recipients
for update to authenticated
using (
  read_at is null
  and exists (
    select 1 from public.students student
    where student.id = announcement_recipients.student_id
      and student.user_id = (select auth.uid())
  )
)
with check (
  read_at is not null
  and exists (
    select 1 from public.students student
    where student.id = announcement_recipients.student_id
      and student.user_id = (select auth.uid())
  )
);

drop policy if exists announcement_recipients_teacher_delete_own on public.announcement_recipients;
create policy announcement_recipients_teacher_delete_own
on public.announcement_recipients
for delete to authenticated
using (public.current_user_owns_announcement(announcement_recipients.announcement_id));

create or replace function public.create_teacher_announcement(
  p_title text,
  p_message text,
  p_type text,
  p_grade smallint,
  p_stream text,
  p_subject_id uuid,
  p_status text,
  p_publish_at timestamptz
)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  teacher_id_value uuid;
  announcement_row public.announcements;
  published_at_value timestamptz;
  publish_at_value timestamptz;
begin
  select teacher.id
  into teacher_id_value
  from public.teachers teacher
  where teacher.user_id = (select auth.uid());

  if teacher_id_value is null then
    raise exception 'A teacher profile is not linked to the authenticated account';
  end if;
  if p_grade < 5 or p_grade > 12 then
    raise exception 'Choose a registered class between grades 5 and 12';
  end if;
  if p_type is null or p_type not in ('Exam', 'Material', 'Reminder', 'Assignment', 'Notice') then
    raise exception 'Choose a valid announcement type';
  end if;
  if p_status is null or p_status not in ('draft', 'scheduled', 'published') then
    raise exception 'Choose a valid publishing option';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 or length(btrim(p_title)) > 160 then
    raise exception 'Title must be between 1 and 160 characters';
  end if;
  if p_message is null or length(btrim(p_message)) = 0 or length(btrim(p_message)) > 5000 then
    raise exception 'Message must be between 1 and 5000 characters';
  end if;
  if p_grade between 5 and 10 then
    if p_stream is not null then
      raise exception 'Grades 5 through 10 do not have a stream';
    end if;
  elsif p_stream is null or p_stream not in ('science_pcm', 'science_pcb', 'commerce', 'arts_humanities') then
    raise exception 'Choose a valid registered stream';
  end if;

  if not exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = teacher_id_value
      and grade_group.grade = p_grade
      and grade_group.stream is not distinct from p_stream
  ) then
    raise exception 'This class and stream are not in your registered teaching scope';
  end if;
  if p_subject_id is not null and not exists (
    select 1
    from public.teacher_subject_assignments assignment
    where assignment.teacher_id = teacher_id_value
      and assignment.grade = p_grade
      and assignment.stream is not distinct from p_stream
      and assignment.subject_id = p_subject_id
  ) then
    raise exception 'This subject is not assigned to you for the selected class and stream';
  end if;

  if p_status = 'scheduled' then
    if p_publish_at is null or p_publish_at <= now() then
      raise exception 'Choose a future date and time';
    end if;
    publish_at_value := p_publish_at;
    published_at_value := null;
  elsif p_status = 'published' then
    publish_at_value := now();
    published_at_value := now();
  else
    publish_at_value := null;
    published_at_value := null;
  end if;

  insert into public.announcements (
    teacher_id,
    title,
    message,
    type,
    grade,
    stream,
    subject_id,
    status,
    publish_at,
    published_at,
    updated_at
  )
  values (
    teacher_id_value,
    btrim(p_title),
    btrim(p_message),
    p_type,
    p_grade,
    p_stream,
    p_subject_id,
    p_status,
    publish_at_value,
    published_at_value,
    now()
  )
  returning * into announcement_row;

  if p_status = 'published' then
    insert into public.announcement_recipients (announcement_id, student_id)
    select announcement_row.id, student.id
    from public.students student
    where student.grade::text = announcement_row.grade::text
      and student.stream is not distinct from announcement_row.stream
    on conflict (announcement_id, student_id) do nothing;
  end if;

  return announcement_row;
end;
$$;

alter function public.create_teacher_announcement(text, text, text, smallint, text, uuid, text, timestamptz) owner to postgres;
revoke all on function public.create_teacher_announcement(text, text, text, smallint, text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_teacher_announcement(text, text, text, smallint, text, uuid, text, timestamptz) to authenticated;

create or replace function public.delete_teacher_announcement(requested_announcement_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.announcement_recipients
  where announcement_id = requested_announcement_id;

  delete from public.announcements announcement
  where announcement.id = requested_announcement_id
    and exists (
      select 1
      from public.teachers teacher
      where teacher.id = announcement.teacher_id
        and teacher.user_id = (select auth.uid())
    );
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'Announcement not found or not owned by the authenticated teacher';
  end if;
end;
$$;

revoke all on function public.delete_teacher_announcement(uuid) from public, anon;
grant execute on function public.delete_teacher_announcement(uuid) to authenticated;

grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, delete on public.announcement_recipients to authenticated;
revoke update on public.announcement_recipients from authenticated;
revoke update (id, announcement_id, student_id, read_at, created_at)
  on public.announcement_recipients from authenticated;
grant update (read_at) on public.announcement_recipients to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'announcements'
    ) then
      alter publication supabase_realtime add table public.announcements;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'announcement_recipients'
    ) then
      alter publication supabase_realtime add table public.announcement_recipients;
    end if;
  end if;
end;
$$;

commit;
