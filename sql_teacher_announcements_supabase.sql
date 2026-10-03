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
  and exists (
    select 1
    from public.announcement_recipients recipient
    join public.students student on student.id = recipient.student_id
    where recipient.announcement_id = announcements.id
      and student.user_id = (select auth.uid())
  )
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
  or exists (
    select 1
    from public.announcements announcement
    join public.teachers teacher on teacher.id = announcement.teacher_id
    where announcement.id = announcement_recipients.announcement_id
      and teacher.user_id = (select auth.uid())
  )
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
using (exists (
  select 1
  from public.announcements announcement
  join public.teachers teacher on teacher.id = announcement.teacher_id
  where announcement.id = announcement_recipients.announcement_id
    and teacher.user_id = (select auth.uid())
));

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
grant select, insert, update, delete on public.announcement_recipients to authenticated;

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
