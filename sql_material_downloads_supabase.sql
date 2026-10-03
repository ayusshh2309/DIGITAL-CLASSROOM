begin;

do $$
begin
  if to_regclass('public.materials') is null then
    raise exception 'Expected public.materials to exist; this migration will not create a materials table';
  end if;
  if to_regclass('public.students') is null then
    raise exception 'Expected public.students to exist before enabling material downloads';
  end if;
  if to_regclass('public.teachers') is null then
    raise exception 'Expected public.teachers to exist before enabling teacher download analytics';
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
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.materials'::regclass
      and attname = 'teacher_id'
      and not attisdropped
  ) then
    raise exception 'Expected public.materials grade, stream, file_path, storage_bucket, status and teacher_id columns; apply the existing materials migration first';
  end if;
end;
$$;

create table if not exists public.material_downloads (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  downloaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.material_downloads
  add column if not exists created_at timestamptz not null default now();

alter table public.material_downloads
  alter column student_id drop default;

do $$
declare
  student_id_attnum smallint;
  material_id_attnum smallint;
  student_id_type oid;
  material_id_type oid;
  material_table_id_type oid;
  student_table_id_type oid;
  foreign_key record;
  unique_constraint record;
begin
  select attnum, atttypid into student_id_attnum, student_id_type
  from pg_attribute
  where attrelid = 'public.material_downloads'::regclass
    and attname = 'student_id'
    and not attisdropped;
  select attnum, atttypid into material_id_attnum, material_id_type
  from pg_attribute
  where attrelid = 'public.material_downloads'::regclass
    and attname = 'material_id'
    and not attisdropped;
  select atttypid into material_table_id_type
  from pg_attribute
  where attrelid = 'public.materials'::regclass
    and attname = 'id'
    and not attisdropped;
  select atttypid into student_table_id_type
  from pg_attribute
  where attrelid = 'public.students'::regclass
    and attname = 'id'
    and not attisdropped;

  if student_id_type <> 'uuid'::regtype
    or material_id_type <> material_table_id_type
    or student_table_id_type <> 'uuid'::regtype then
    raise exception 'material_downloads IDs do not match the existing materials/students schema';
  end if;

  for foreign_key in
    select constraint_record.conname, constraint_record.confrelid, constraint_record.conkey
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.material_downloads'::regclass
      and constraint_record.contype = 'f'
      and (
        student_id_attnum = any(constraint_record.conkey)
        or material_id_attnum = any(constraint_record.conkey)
      )
  loop
    if student_id_attnum = any(foreign_key.conkey) then
      if foreign_key.confrelid not in (
        'auth.users'::regclass,
        'public.students'::regclass
      ) then
        raise exception 'Unexpected foreign key % on material_downloads.student_id', foreign_key.conname;
      end if;
      execute format('alter table public.material_downloads drop constraint %I', foreign_key.conname);
    elsif material_id_attnum = any(foreign_key.conkey) then
      if foreign_key.confrelid <> 'public.materials'::regclass then
        raise exception 'Unexpected foreign key % on material_downloads.material_id', foreign_key.conname;
      end if;
      execute format('alter table public.material_downloads drop constraint %I', foreign_key.conname);
    end if;
  end loop;

  if exists (
    select 1
    from public.material_downloads as download
    where not exists (
      select 1 from public.students as student
      where student.id = download.student_id
         or student.user_id = download.student_id
    )
  ) then
    raise exception 'Some existing material download records cannot be mapped to public.students; resolve them before applying this migration';
  end if;

  update public.material_downloads as download
  set student_id = student.id
  from public.students as student
  where student.user_id = download.student_id
    and not exists (
      select 1 from public.students as existing_student
      where existing_student.id = download.student_id
    );

  for unique_constraint in
    select constraint_record.conname
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.material_downloads'::regclass
      and constraint_record.contype = 'u'
      and cardinality(constraint_record.conkey) = 2
      and student_id_attnum = any(constraint_record.conkey)
      and material_id_attnum = any(constraint_record.conkey)
  loop
    execute format('alter table public.material_downloads drop constraint %I', unique_constraint.conname);
  end loop;

  alter table public.material_downloads
    add constraint material_downloads_material_id_fkey
    foreign key (material_id) references public.materials(id) on delete cascade;

  alter table public.material_downloads
    add constraint material_downloads_student_id_fkey
    foreign key (student_id) references public.students(id) on delete cascade;
end;
$$;

create index if not exists idx_material_downloads_material
  on public.material_downloads(material_id);
create index if not exists idx_material_downloads_student
  on public.material_downloads(student_id);
create index if not exists idx_material_downloads_downloaded_at
  on public.material_downloads(downloaded_at desc);
create index if not exists idx_material_downloads_material_date
  on public.material_downloads(material_id, downloaded_at desc);

update public.materials
set stream = null
where grade in ('5', '6', '7', '8', '9', '10')
  and stream = '';

alter table public.material_downloads enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'material_downloads'
  loop
    execute format('drop policy %I on public.material_downloads', policy_record.policyname);
  end loop;
end;
$$;

create policy material_downloads_student_select_own
on public.material_downloads
for select to authenticated
using (exists (
  select 1
  from public.students as student
  where student.id = material_downloads.student_id
    and student.user_id = (select auth.uid())
));

create policy material_downloads_teacher_select_own_materials
on public.material_downloads
for select to authenticated
using (exists (
  select 1
  from public.materials as material
  join public.teachers as teacher on teacher.id = material.teacher_id
  where material.id = material_downloads.material_id
    and teacher.user_id = (select auth.uid())
));

create policy material_downloads_student_insert_eligible
on public.material_downloads
for insert to authenticated
with check (exists (
  select 1
  from public.students as student
  join public.materials as material
    on material.id = material_downloads.material_id
  where student.id = material_downloads.student_id
    and student.user_id = (select auth.uid())
    and material.grade = student.grade::text
    and material.status = 'published'
    and (
      (student.grade between 5 and 10 and material.stream is null)
      or
      (student.grade in (11, 12) and material.stream is not distinct from student.stream)
    )
));

revoke all on table public.material_downloads from public, anon, authenticated;
grant select, insert on table public.material_downloads to authenticated;

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

create or replace function public.get_teacher_material_download_counts()
returns table (material_id uuid, download_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select material.id, count(download.id)::bigint
  from public.materials as material
  left join public.material_downloads as download
    on download.material_id = material.id
  where exists (
    select 1
    from public.teachers as teacher
    where teacher.id = material.teacher_id
      and teacher.user_id = (select auth.uid())
  )
  group by material.id
$$;

revoke all on function public.get_teacher_material_download_counts() from public, anon;
grant execute on function public.get_teacher_material_download_counts() to authenticated;

alter table public.material_downloads replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'material_downloads'
    ) then
    alter publication supabase_realtime add table public.material_downloads;
  end if;
end;
$$;

commit;
