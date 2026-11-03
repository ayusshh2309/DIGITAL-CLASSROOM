begin;

do $$
begin
  if to_regclass('public.teacher_settings') is null
    or to_regclass('public.teachers') is null
    or to_regclass('public.students') is null
    or to_regclass('public.calendar_events') is null
    or to_regclass('public.live_classes') is null
    or to_regclass('public.materials') is null
    or to_regclass('public.quizzes') is null
    or to_regclass('public.announcements') is null then
    raise exception 'Run the existing teacher, calendar, live-class, material, quiz, and announcement migrations first.';
  end if;

  if to_regprocedure('public.calendar_student_can_view_event(integer,text,bigint,text,uuid)') is null
    or to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)') is null
    or to_regprocedure('public.student_can_view_material(uuid)') is null
    or to_regprocedure('public.quiz_student_is_eligible(uuid)') is null
    or to_regprocedure('public.current_user_is_announcement_recipient(uuid)') is null then
    raise exception 'Required existing student-visibility functions are missing.';
  end if;
end;
$$;

create or replace function public.get_student_visible_timezones(
  requested_resource_type text,
  requested_resource_ids uuid[]
)
returns table (
  resource_id uuid,
  timezone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  normalized_resource_type text := lower(btrim(requested_resource_type));
begin
  if authenticated_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if normalized_resource_type is null or normalized_resource_type not in (
    'calendar_events',
    'live_classes',
    'materials',
    'quizzes',
    'announcements'
  ) then
    raise exception 'Unsupported student resource type.'
      using errcode = '22023';
  end if;

  if coalesce(cardinality(requested_resource_ids), 0) > 1000 then
    raise exception 'At most 1000 resource IDs may be requested.'
      using errcode = '22023';
  end if;

  if normalized_resource_type = 'calendar_events' then
    return query
      select event.id, settings.timezone
      from public.calendar_events event
      join public.teacher_settings settings on settings.teacher_id = event.teacher_id
      join public.teachers teacher on teacher.id = event.teacher_id
      where event.id = any(coalesce(requested_resource_ids, '{}'::uuid[]))
        and event.status = 'published'
        and event.is_visible_to_students
        and public.calendar_student_can_view_event(
          event.grade,
          event.stream,
          event.subject_id,
          event.source_table,
          event.source_id
        );
    return;
  end if;

  if normalized_resource_type = 'live_classes' then
    return query
      select live.id, settings.timezone
      from public.live_classes live
      join public.teacher_settings settings on settings.teacher_id = live.teacher_id
      where live.id = any(coalesce(requested_resource_ids, '{}'::uuid[]))
        and live.publication_status = 'published'
        and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
        and public.live_class_student_can_view(
          live.teacher_id, live.grade::integer, live.stream, live.subject_id::text
        );
    return;
  end if;

  if normalized_resource_type = 'materials' then
    return query
      select material.id, settings.timezone
      from public.materials material
      join public.teacher_settings settings on settings.teacher_id = material.teacher_id
      where material.id = any(coalesce(requested_resource_ids, '{}'::uuid[]))
        and public.student_can_view_material(material.id);
    return;
  end if;

  if normalized_resource_type = 'quizzes' then
    return query
      select quiz.id, settings.timezone
      from public.quizzes quiz
      join public.teacher_settings settings on settings.teacher_id = quiz.teacher_id
      where quiz.id = any(coalesce(requested_resource_ids, '{}'::uuid[]))
        and public.quiz_student_is_eligible(quiz.id);
    return;
  end if;

  return query
    select announcement.id, settings.timezone
    from public.announcements announcement
    join public.teacher_settings settings on settings.teacher_id = announcement.teacher_id
    where announcement.id = any(coalesce(requested_resource_ids, '{}'::uuid[]))
      and lower(btrim(announcement.status)) = 'published'
      and public.current_user_is_announcement_recipient(announcement.id);
end;
$$;

alter function public.get_student_visible_timezones(text, uuid[]) owner to postgres;
revoke all on function public.get_student_visible_timezones(text, uuid[]) from public, anon;
grant execute on function public.get_student_visible_timezones(text, uuid[]) to authenticated;

commit;
