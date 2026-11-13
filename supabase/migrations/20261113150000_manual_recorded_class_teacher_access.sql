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
    and exists (
      select 1
      from public.live_classes class
      where class.id = recorded_classes.live_class_id
        and class.teacher_id = recorded_classes.teacher_id
        and class.grade = recorded_classes.grade
        and class.stream is not distinct from recorded_classes.stream
        and class.subject_id::text = recorded_classes.subject_id::text
    )
    and (
      exists (
        select 1
        from public.teachers teacher
        where teacher.id = recorded_classes.teacher_id
          and teacher.user_id = auth.uid()
      )
      or (
        public.live_class_student_can_view(
          teacher_id,
          grade,
          stream,
          subject_id::text
        )
        and exists (
          select 1
          from public.live_classes class
          where class.id = recorded_classes.live_class_id
            and class.teacher_id = recorded_classes.teacher_id
            and class.grade = recorded_classes.grade
            and class.stream is not distinct from recorded_classes.stream
            and class.subject_id::text = recorded_classes.subject_id::text
            and lower(btrim(coalesce(class.publication_status, ''))) = 'published'
            and lower(btrim(coalesce(class.status, ''))) not in ('cancelled', 'canceled')
            and case
              when lower(btrim(coalesce(class.meeting_platform, ''))) like '%zoom%'
                then 'zoom'
              when lower(btrim(coalesce(class.meeting_platform, ''))) like '%google%'
                or lower(btrim(coalesce(class.meeting_platform, ''))) like '%meet%'
                then 'google meet'
              else lower(btrim(coalesce(class.meeting_platform, '')))
            end = case
              when lower(btrim(coalesce(recorded_classes.provider, ''))) like '%zoom%'
                then 'zoom'
              when lower(btrim(coalesce(recorded_classes.provider, ''))) like '%google%'
                or lower(btrim(coalesce(recorded_classes.provider, ''))) like '%meet%'
                then 'google meet'
              else lower(btrim(coalesce(recorded_classes.provider, '')))
            end
        )
      )
    )
  );

commit;
