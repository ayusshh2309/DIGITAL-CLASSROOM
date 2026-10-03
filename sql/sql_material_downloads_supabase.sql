-- Retire download-event tracking while retaining student material access policies.
begin;

do $$
begin
  if to_regclass('public.materials') is null then
    raise exception 'Expected public.materials to exist; this migration will not create a materials table';
  end if;
  if to_regclass('public.students') is null then
    raise exception 'Expected public.students to exist before applying student material access policies';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'grade'
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'stream'
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'file_path'
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'storage_bucket'
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'status'
      and not attisdropped
  ) then
    raise exception 'Expected public.materials grade, stream, file_path, storage_bucket and status columns; apply the existing materials migration first';
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
        select 1 from pg_publication_tables
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
where grade in ('5', '6', '7', '8', '9', '10')
  and stream = '';

drop policy if exists materials_students_select_eligible on public.materials;
create policy materials_students_select_eligible
on public.materials
for select to authenticated
using (exists (
  select 1
  from public.students as student
  where student.user_id = (select auth.uid())
    and materials.grade = student.grade::text
    and materials.status = 'published'
    and (
      (student.grade between 5 and 10 and materials.stream is null)
      or
      (student.grade in (11, 12) and materials.stream is not distinct from student.stream)
    )
));

drop policy if exists materials_students_read_eligible_storage on storage.objects;
create policy materials_students_read_eligible_storage
on storage.objects
for select to authenticated
using (
  bucket_id in ('pdfs', 'videos', 'photos', 'documents')
  and exists (
    select 1
    from public.materials as material
    join public.students as student on student.user_id = (select auth.uid())
    where material.storage_bucket = storage.objects.bucket_id
      and material.file_path = storage.objects.name
      and material.grade = student.grade::text
      and material.status = 'published'
      and (
        (student.grade between 5 and 10 and material.stream is null)
        or
        (student.grade in (11, 12) and material.stream is not distinct from student.stream)
      )
  )
);

commit;
