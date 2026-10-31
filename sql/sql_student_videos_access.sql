begin;

do $$
begin
  if to_regclass('public.materials') is null
    or to_regclass('public.students') is null
    or to_regclass('public.subjects') is null
    or to_regclass('storage.objects') is null then
    raise exception 'Expected public.materials, public.students, public.subjects and storage.objects to exist';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'videos'
  ) then
    raise exception 'The videos Storage bucket used by teacher uploads does not exist';
  end if;

  if to_regprocedure('public.student_can_view_material(uuid)') is null then
    raise exception 'Apply sql/sql_student_calendar_sources.sql first to install the student material access helper';
  end if;
end;
$$;

drop policy if exists materials_students_select_published_videos
  on public.materials;
drop policy if exists materials_students_select_eligible_videos
  on public.materials;
create policy materials_students_select_eligible_videos
on public.materials
for select to authenticated
using (
  material_type = 'video'
  and storage_bucket = 'videos'
  and public.student_can_view_material(id)
);

drop policy if exists materials_students_read_eligible_videos_storage
  on storage.objects;
create policy materials_students_read_eligible_videos_storage
on storage.objects
for select to authenticated
using (
  bucket_id = 'videos'
  and exists (
    select 1
    from public.materials as material
    where material.storage_bucket = storage.objects.bucket_id
      and material.file_path = storage.objects.name
      and material.material_type = 'video'
      and public.student_can_view_material(material.id)
  )
);

commit;
