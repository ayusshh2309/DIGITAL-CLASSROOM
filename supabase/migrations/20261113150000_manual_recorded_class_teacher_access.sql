begin;

do $$
begin
  if to_regclass('public.recorded_classes') is null
    or to_regclass('public.live_classes') is null
    or to_regclass('public.teachers') is null then
    raise exception 'Teacher recording access requires recorded_classes, live_classes, and teachers.';
  end if;
  if to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)') is null then
    raise exception 'Teacher recording access requires live_class_student_can_view(uuid,integer,text,text).';
  end if;
end;
$$;

drop policy if exists recorded_classes_teacher_owner_select
  on public.recorded_classes;

create policy recorded_classes_teacher_owner_select
  on public.recorded_classes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teachers teacher
      where teacher.id = recorded_classes.teacher_id
        and teacher.user_id = auth.uid()
    )
  );

drop policy if exists recorded_classes_published_live_class_guard
  on public.recorded_classes;

create policy recorded_classes_published_live_class_guard
  on public.recorded_classes
  as restrictive
  for select
  to authenticated
  using (
    recording_status = 'available'
    and recording_verified_at is not null
    and storage_path is not null
    and live_class_id is not null
    and storage_path ~* (
      '^manual/' || teacher_id::text || '/' || live_class_id::text || '/' ||
      '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\.(mp4|webm|mov)$'
    )
    and exists (
      select 1
      from public.live_classes class
      where class.id = recorded_classes.live_class_id
        and class.teacher_id = recorded_classes.teacher_id
    )
    and (
      exists (
        select 1
        from public.teachers teacher
        where teacher.id = recorded_classes.teacher_id
          and teacher.user_id = auth.uid()
      )
      or (
        exists (
          select 1
          from public.live_classes class
          where class.id = recorded_classes.live_class_id
            and class.teacher_id = recorded_classes.teacher_id
            and lower(btrim(coalesce(class.publication_status, ''))) = 'published'
            and lower(btrim(coalesce(class.status, ''))) not in ('cancelled', 'canceled')
            and public.live_class_student_can_view(
              class.teacher_id,
              class.grade::integer,
              class.stream,
              class.subject_id::text
            )
        )
      )
    )
  );

commit;
