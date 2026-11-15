begin;

do $$
begin
  if to_regclass('public.recorded_classes') is null
    or to_regclass('public.live_classes') is null
    or to_regclass('public.teachers') is null then
    raise exception 'Live-class recording centralization requires recorded_classes, live_classes, and teachers.';
  end if;
  if to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)') is null then
    raise exception 'Student recording access requires live_class_student_can_view(uuid,integer,text,text).';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recorded_classes'
      and column_name = 'live_class_id'
      and data_type = 'uuid'
  ) then
    raise exception 'public.recorded_classes.live_class_id must be UUID-compatible.';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recorded_classes'
      and policyname = 'recorded_classes_authorized_student_select'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recorded_classes'
      and policyname = 'recorded_classes_teacher_owner_select'
  ) then
    raise exception 'Existing student authorization and teacher-owner policies must be installed first.';
  end if;
  if exists (
    select live_class_id
    from public.recorded_classes
    where live_class_id is not null
    group by live_class_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate live-class recordings exist. Resolve them before applying the unique index.';
  end if;
end;
$$;

create unique index if not exists recorded_classes_one_recording_per_live_class
  on public.recorded_classes (live_class_id)
  where live_class_id is not null;

drop policy if exists recorded_classes_authorized_student_select
  on public.recorded_classes;

create policy recorded_classes_authorized_student_select
  on public.recorded_classes
  for select
  to authenticated
  using (
    recording_status = 'available'
    and recording_verified_at is not null
    and storage_path is not null
    and live_class_id is not null
    and exists (
      select 1
      from public.live_classes class
      where class.id = recorded_classes.live_class_id
        and class.teacher_id = recorded_classes.teacher_id
        and public.live_class_student_can_view(
          class.teacher_id,
          class.grade::integer,
          class.stream,
          class.subject_id::text
        )
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
