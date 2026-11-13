begin;

do $$
begin
  if to_regclass('public.recorded_classes') is null then
    raise exception 'public.recorded_classes must already exist before enabling manual recording uploads.';
  end if;
  if to_regclass('public.live_classes') is null or to_regclass('public.teachers') is null then
    raise exception 'Manual recording uploads require public.live_classes and public.teachers.';
  end if;
  if to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)') is null then
    raise exception 'Manual recordings require public.live_class_student_can_view(uuid,integer,text,text).';
  end if;
  if not exists (
    select 1
    from storage.buckets
    where id = 'recorded-class-videos'
  ) then
    raise exception 'The recorded-class-videos Storage bucket must already exist.';
  end if;
end;
$$;

alter table public.recorded_classes
  add column if not exists storage_path text,
  add column if not exists recording_started_at timestamptz,
  add column if not exists recording_verified_at timestamptz;

do $$
declare
  missing_columns text[];
begin
  select array_agg(required.column_name order by required.column_name)
    into missing_columns
  from (values
    ('id'),
    ('live_class_id'),
    ('teacher_id'),
    ('title'),
    ('description'),
    ('grade'),
    ('stream'),
    ('subject_id'),
    ('chapter'),
    ('topic'),
    ('provider'),
    ('provider_recording_id'),
    ('playback_url'),
    ('storage_path'),
    ('recording_status'),
    ('recording_started_at'),
    ('recording_verified_at'),
    ('started_at'),
    ('duration_seconds'),
    ('ready_at')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns actual
    where actual.table_schema = 'public'
      and actual.table_name = 'recorded_classes'
      and actual.column_name = required.column_name
  );
  if missing_columns is not null then
    raise exception 'public.recorded_classes is missing required columns: %', array_to_string(missing_columns, ', ');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recorded_classes'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recorded_classes'
      and column_name = 'teacher_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recorded_classes'
      and column_name = 'live_class_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recorded_classes'
      and column_name = 'grade' and data_type in ('smallint', 'integer')
  ) then
    raise exception 'recorded_classes identifiers and grade must use UUID and integer types.';
  end if;
  if not exists (
    select 1
    from pg_index index_definition
    join pg_attribute column_definition
      on column_definition.attrelid = index_definition.indrelid
     and column_definition.attname = 'id'
     and not column_definition.attisdropped
    where index_definition.indrelid = 'public.recorded_classes'::regclass
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indpred is null
      and index_definition.indnkeyatts = 1
      and index_definition.indkey[0] = column_definition.attnum
  ) then
    raise exception 'public.recorded_classes.id must have a unique constraint for idempotent finalization.';
  end if;
end;
$$;

alter table public.recorded_classes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recorded_classes'
      and policyname = 'recorded_classes_authorized_student_select'
  ) then
    create policy recorded_classes_authorized_student_select
      on public.recorded_classes
      for select
      to authenticated
      using (
        recording_status = 'available'
        and recording_verified_at is not null
        and storage_path is not null
        and public.live_class_student_can_view(
          teacher_id,
          grade,
          stream,
          subject_id::text
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recorded_classes'
      and policyname = 'recorded_classes_published_live_class_guard'
  ) then
    create policy recorded_classes_published_live_class_guard
      on public.recorded_classes
      as restrictive
      for select
      to authenticated
      using (
        recording_status = 'available'
        and recording_verified_at is not null
        and storage_path is not null
        and public.live_class_student_can_view(
          teacher_id,
          grade,
          stream,
          subject_id::text
        )
        and exists (
          select 1
          from public.live_classes class
          where class.id = live_class_id
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
      );
  end if;
end;
$$;

revoke insert, update, delete on public.recorded_classes from public, anon, authenticated;
revoke select on public.recorded_classes from public, anon;
grant select on public.recorded_classes to authenticated;

update storage.buckets
set public = false
where id = 'recorded-class-videos';

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'recorded_class_video_objects_private'
  ) then
    create policy recorded_class_video_objects_private
      on storage.objects
      as restrictive
      for all
      to anon, authenticated
      using (bucket_id <> 'recorded-class-videos')
      with check (bucket_id <> 'recorded-class-videos');
  end if;
end;
$$;

commit;
