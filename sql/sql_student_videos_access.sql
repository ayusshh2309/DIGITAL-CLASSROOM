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
  and exists (
    select 1
    from public.students as student
    where student.user_id = (select auth.uid())
      and materials.grade = student.grade
      and (
        student.grade between 5 and 10
        or (
          student.grade in (11, 12)
          and lower(btrim(materials.stream)) = lower(btrim(student.stream))
        )
      )
  )
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
    join public.students as student
      on student.user_id = (select auth.uid())
    where material.storage_bucket = storage.objects.bucket_id
      and material.file_path = storage.objects.name
      and material.material_type = 'video'
      and material.grade = student.grade
      and (
        student.grade between 5 and 10
        or (
          student.grade in (11, 12)
          and lower(btrim(material.stream)) = lower(btrim(student.stream))
        )
      )
  )
);

commit;
