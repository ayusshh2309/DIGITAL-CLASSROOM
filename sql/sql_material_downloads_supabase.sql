-- Retire download-event tracking and align student file access with materials RLS.
begin;

do $$
begin
  if to_regclass('public.materials') is null
    or to_regclass('public.students') is null
    or to_regclass('public.subjects') is null
    or to_regclass('storage.objects') is null then
    raise exception 'Expected materials, students, subjects, and storage.objects to exist';
  end if;

  if to_regprocedure('public.student_can_view_material(uuid)') is null then
    raise exception 'Apply sql/sql_student_calendar_sources.sql first to install the student material access helper';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'materials'
      and column_name = 'grade'
      and data_type = 'integer'
  ) then
    raise exception 'Expected public.materials.grade to use the verified integer type';
  end if;
end;
$$;

drop function if exists public.get_teacher_material_download_counts();

do $$
declare
  has_history boolean;
  policy_record record;
begin
  if to_regclass('public.material_downloads') is not null then
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'material_downloads'
    loop
      execute format('drop policy %I on public.material_downloads', policy_record.policyname);
    end loop;
    revoke all on table public.material_downloads from public, anon, authenticated;

    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
      and exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'material_downloads'
      ) then
      alter publication supabase_realtime drop table public.material_downloads;
    end if;

    execute 'select exists (select 1 from public.material_downloads)' into has_history;
    if has_history then
      raise notice 'Preserving public.material_downloads because it contains historical rows; archive or explicitly remove those rows before dropping the table';
    else
      drop table public.material_downloads;
    end if;
  end if;
end;
$$;

update public.materials
set stream = null
where grade between 5 and 10
  and stream = '';

drop policy if exists materials_students_select_eligible on public.materials;
drop policy if exists materials_students_select_published_videos on public.materials;
drop policy if exists materials_students_select_eligible_videos on public.materials;
drop policy if exists materials_students_calendar_select on public.materials;
create policy materials_students_calendar_select
  on public.materials
  for select to authenticated
  using (public.student_can_view_material(id));

drop policy if exists materials_students_read_eligible_storage on storage.objects;
drop policy if exists materials_students_read_eligible_videos_storage on storage.objects;
drop policy if exists materials_students_calendar_storage_select on storage.objects;
create policy materials_students_calendar_storage_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id in ('pdfs', 'videos', 'photos', 'documents')
    and exists (
      select 1
      from public.materials material
      where material.storage_bucket = storage.objects.bucket_id
        and material.file_path = storage.objects.name
        and public.student_can_view_material(material.id)
    )
  );

commit;
