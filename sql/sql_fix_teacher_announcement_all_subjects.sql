begin;

drop function if exists public.create_teacher_announcement(text, text, text, smallint, text, uuid, text, timestamptz);

create or replace function public.create_teacher_announcement(
  p_grade integer,
  p_title text,
  p_publish_at timestamptz,
  p_message text,
  p_type text,
  p_subject_id bigint,
  p_status text,
  p_stream text
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
  stream_value text;
begin
  select teacher.id
  into teacher_id_value
  from public.teachers teacher
  where teacher.user_id = (select auth.uid());

  if teacher_id_value is null then
    raise exception 'A teacher profile is not linked to the authenticated account';
  end if;
  if p_grade is null or p_grade < 5 or p_grade > 12 then
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
    stream_value := null;
  else
    stream_value := lower(btrim(p_stream));
    if stream_value is null or stream_value not in ('science_pcm', 'science_pcb', 'commerce', 'arts_humanities') then
      raise exception 'Choose a valid registered stream';
    end if;
  end if;

  if not exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = teacher_id_value
      and grade_group.grade::integer = p_grade
      and (
        (p_grade between 5 and 10 and grade_group.stream is null)
        or
        (p_grade between 11 and 12
          and lower(btrim(coalesce(grade_group.stream, ''))) = stream_value)
      )
  ) then
    raise exception 'Teacher is not registered for this class';
  end if;

  if p_subject_id is not null and not exists (
    select 1
    from public.teacher_subject_assignments assignment
    where assignment.teacher_id = teacher_id_value
      and assignment.grade::integer = p_grade
      and (
        (p_grade between 5 and 10 and assignment.stream is null)
        or
        (p_grade between 11 and 12
          and lower(btrim(coalesce(assignment.stream, ''))) = stream_value)
      )
      and assignment.subject_id = p_subject_id
  ) then
    raise exception 'This subject is not assigned to you for the selected class and stream';
  end if;

  if p_subject_id is null and not exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = teacher_id_value
      and grade_group.grade::integer = p_grade
      and grade_group.teach_all_subjects
      and (
        (p_grade between 5 and 10 and grade_group.stream is null)
        or
        (p_grade between 11 and 12
          and lower(btrim(coalesce(grade_group.stream, ''))) = stream_value)
      )
  ) then
    raise exception 'All-subject announcements are not enabled for this class and stream';
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
    stream_value,
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
      and (
        (announcement_row.grade::integer between 5 and 10 and student.stream is null)
        or
        (announcement_row.grade::integer between 11 and 12
          and lower(btrim(coalesce(student.stream, ''))) = announcement_row.stream)
      )
    on conflict (announcement_id, student_id) do nothing;
  end if;

  return announcement_row;
end;
$$;

alter function public.create_teacher_announcement(integer, text, timestamptz, text, text, bigint, text, text) owner to postgres;
revoke all on function public.create_teacher_announcement(integer, text, timestamptz, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.create_teacher_announcement(integer, text, timestamptz, text, text, bigint, text, text) to authenticated;

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
        (announcements.grade::integer between 1 and 10
          and grade_group.stream is null
          and announcements.stream is null)
        or
        (announcements.grade::integer in (11, 12)
          and lower(btrim(coalesce(grade_group.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
      )
  )
  and (
    (
      announcements.subject_id is null
      and exists (
        select 1 from public.teacher_grade_groups grade_group
        where grade_group.teacher_id = announcements.teacher_id
          and grade_group.grade::text = announcements.grade::text
          and (
            (announcements.grade::integer between 1 and 10
              and grade_group.stream is null
              and announcements.stream is null)
            or
            (announcements.grade::integer in (11, 12)
              and lower(btrim(coalesce(grade_group.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
          )
          and grade_group.teach_all_subjects
      )
    )
    or
    (
      announcements.subject_id is not null
      and exists (
        select 1 from public.teacher_subject_assignments assignment
        where assignment.teacher_id = announcements.teacher_id
          and assignment.grade::text = announcements.grade::text
          and (
            (announcements.grade::integer between 1 and 10
              and assignment.stream is null
              and announcements.stream is null)
            or
            (announcements.grade::integer in (11, 12)
              and lower(btrim(coalesce(assignment.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
          )
          and assignment.subject_id = announcements.subject_id
      )
    )
  )
);

drop policy if exists announcements_teacher_update_own on public.announcements;
create policy announcements_teacher_update_own
on public.announcements
for update to authenticated
using (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = announcements.teacher_id
      and teacher.user_id = (select auth.uid())
  )
)
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
        (announcements.grade::integer between 1 and 10
          and grade_group.stream is null
          and announcements.stream is null)
        or
        (announcements.grade::integer in (11, 12)
          and lower(btrim(coalesce(grade_group.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
      )
  )
  and (
    (
      announcements.subject_id is null
      and exists (
        select 1 from public.teacher_grade_groups grade_group
        where grade_group.teacher_id = announcements.teacher_id
          and grade_group.grade::text = announcements.grade::text
          and (
            (announcements.grade::integer between 1 and 10
              and grade_group.stream is null
              and announcements.stream is null)
            or
            (announcements.grade::integer in (11, 12)
              and lower(btrim(coalesce(grade_group.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
          )
          and grade_group.teach_all_subjects
      )
    )
    or
    (
      announcements.subject_id is not null
      and exists (
        select 1 from public.teacher_subject_assignments assignment
        where assignment.teacher_id = announcements.teacher_id
          and assignment.grade::text = announcements.grade::text
          and (
            (announcements.grade::integer between 1 and 10
              and assignment.stream is null
              and announcements.stream is null)
            or
            (announcements.grade::integer in (11, 12)
              and lower(btrim(coalesce(assignment.stream, ''))) = lower(btrim(coalesce(announcements.stream, ''))))
          )
          and assignment.subject_id = announcements.subject_id
      )
    )
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
      (announcement.grade::integer between 1 and 10
        and student.stream is null
        and announcement.stream is null)
      or
      (announcement.grade::integer in (11, 12)
        and lower(btrim(coalesce(student.stream, ''))) = lower(btrim(coalesce(announcement.stream, ''))))
    )
));

commit;
