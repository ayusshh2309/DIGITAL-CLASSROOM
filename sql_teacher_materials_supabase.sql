begin;

do $$
declare
  materials_teacher_type oid;
  teachers_id_type oid;
  subjects_id_type oid;
  teacher_id_attnum smallint;
  subject_id_attnum smallint;
  foreign_key record;
  has_teacher_profile_fk boolean := false;
  had_auth_user_fk boolean := false;
begin
  if to_regclass('public.materials') is null then
    raise exception 'Expected public.materials to exist; this migration will not create a second materials table';
  end if;
  if to_regclass('public.teachers') is null or to_regclass('public.subjects') is null then
    raise exception 'Expected public.teachers and public.subjects to exist';
  end if;

  select attnum, atttypid into teacher_id_attnum, materials_teacher_type
  from pg_attribute
  where attrelid = 'public.materials'::regclass
    and attname = 'teacher_id'
    and not attisdropped;
  select atttypid into teachers_id_type
  from pg_attribute
  where attrelid = 'public.teachers'::regclass
    and attname = 'id'
    and not attisdropped;
  if materials_teacher_type is null or teachers_id_type is null
    or materials_teacher_type <> teachers_id_type then
    raise exception 'public.materials.teacher_id must use the same type as public.teachers.id';
  end if;

  for foreign_key in
    select constraint_record.conname, constraint_record.confrelid
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.materials'::regclass
      and constraint_record.contype = 'f'
      and teacher_id_attnum = any(constraint_record.conkey)
  loop
    if foreign_key.confrelid = 'auth.users'::regclass then
      execute format(
        'alter table public.materials drop constraint %I',
        foreign_key.conname
      );
      had_auth_user_fk := true;
    elsif foreign_key.confrelid = 'public.teachers'::regclass then
      has_teacher_profile_fk := true;
    else
      raise exception 'Unexpected foreign key % on public.materials.teacher_id', foreign_key.conname;
    end if;
  end loop;

  if had_auth_user_fk then
    update public.materials as material
    set teacher_id = teacher.id
    from public.teachers as teacher
    where material.teacher_id = teacher.user_id;
  else
    update public.materials as material
    set teacher_id = teacher.id
    from public.teachers as teacher
    where material.teacher_id = teacher.user_id
      and not exists (
        select 1 from public.teachers as existing_teacher
        where existing_teacher.id = material.teacher_id
      );
  end if;

  if exists (
    select 1
    from public.materials as material
    where not exists (
      select 1 from public.teachers as teacher
      where teacher.id = material.teacher_id
    )
  ) then
    raise exception 'Some existing materials cannot be mapped to public.teachers.id; resolve those rows before applying this migration';
  end if;

  if not has_teacher_profile_fk then
    alter table public.materials
      add constraint materials_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;

  select attnum, atttypid into subject_id_attnum, subjects_id_type
  from pg_attribute
  where attrelid = 'public.subjects'::regclass
    and attname = 'id'
    and not attisdropped;
  if subjects_id_type <> 'int8'::regtype then
    raise exception 'Expected public.subjects.id to be bigint; inspect the live schema before adding materials.subject_id';
  end if;
end;
$$;

alter table public.materials
  add column if not exists grade text,
  add column if not exists stream text,
  add column if not exists subject_id bigint,
  add column if not exists file_path text,
  add column if not exists storage_bucket text,
  add column if not exists mime_type text,
  add column if not exists external_url text;

do $$
declare
  materials_subject_type oid;
  subjects_id_type oid;
begin
  select atttypid into materials_subject_type
  from pg_attribute
  where attrelid = 'public.materials'::regclass
    and attname = 'subject_id'
    and not attisdropped;
  select atttypid into subjects_id_type
  from pg_attribute
  where attrelid = 'public.subjects'::regclass
    and attname = 'id'
    and not attisdropped;
  if materials_subject_type <> subjects_id_type then
    raise exception 'public.materials.subject_id must match public.subjects.id';
  end if;

  if not exists (
    select 1 from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.materials'::regclass
      and constraint_record.confrelid = 'public.subjects'::regclass
      and constraint_record.contype = 'f'
      and exists (
        select 1 from unnest(constraint_record.conkey) as key_column(attnum)
        join pg_attribute as column_record
          on column_record.attrelid = constraint_record.conrelid
          and column_record.attnum = key_column.attnum
        where column_record.attname = 'subject_id'
      )
  ) then
    alter table public.materials
      add constraint materials_subject_id_fkey
      foreign key (subject_id) references public.subjects(id) on delete restrict;
  end if;
end;
$$;

update public.materials
set grade = class_grade
where grade is null or grade = '';

update public.materials as material
set subject_id = (
  select subject_record.id
  from public.subjects as subject_record
  where lower(subject_record.name) = lower(material.subject)
  order by subject_record.id
  limit 1
)
where material.subject_id is null
  and exists (
    select 1 from public.subjects as subject_record
    where lower(subject_record.name) = lower(material.subject)
  );

create index if not exists materials_teacher_grade_subject_idx
  on public.materials (teacher_id, grade, subject_id, created_at desc);

alter table public.materials enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'materials'
  loop
    execute format('drop policy %I on public.materials', policy_record.policyname);
  end loop;
end;
$$;

create policy materials_teacher_select_own on public.materials
for select to authenticated
using (exists (
  select 1 from public.teachers as teacher
  where teacher.id = materials.teacher_id
    and teacher.user_id = (select auth.uid())
));

create policy materials_teacher_insert_assigned on public.materials
for insert to authenticated
with check (exists (
  select 1 from public.teachers as teacher
  where teacher.id = materials.teacher_id
    and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups as grade_group
  where grade_group.teacher_id = materials.teacher_id
    and grade_group.grade::text = materials.grade
    and grade_group.stream is not distinct from materials.stream
) and exists (
  select 1 from public.teacher_subject_assignments as assignment
  where assignment.teacher_id = materials.teacher_id
    and assignment.subject_id = materials.subject_id
    and assignment.grade::text = materials.grade
    and assignment.stream is not distinct from materials.stream
));

create policy materials_teacher_update_assigned on public.materials
for update to authenticated
using (exists (
  select 1 from public.teachers as teacher
  where teacher.id = materials.teacher_id
    and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.teachers as teacher
  where teacher.id = materials.teacher_id
    and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups as grade_group
  where grade_group.teacher_id = materials.teacher_id
    and grade_group.grade::text = materials.grade
    and grade_group.stream is not distinct from materials.stream
) and exists (
  select 1 from public.teacher_subject_assignments as assignment
  where assignment.teacher_id = materials.teacher_id
    and assignment.subject_id = materials.subject_id
    and assignment.grade::text = materials.grade
    and assignment.stream is not distinct from materials.stream
));

create policy materials_teacher_delete_own on public.materials
for delete to authenticated
using (exists (
  select 1 from public.teachers as teacher
  where teacher.id = materials.teacher_id
    and teacher.user_id = (select auth.uid())
));

revoke all on public.materials from anon;
grant select, insert, update, delete on public.materials to authenticated;

drop policy if exists materials_bucket_owner_access on storage.objects;
create policy materials_bucket_owner_access on storage.objects
for all to authenticated
using (
  bucket_id in ('pdfs', 'videos', 'photos', 'documents')
  and exists (
    select 1 from public.teachers as teacher
    where teacher.id::text = (storage.foldername(name))[1]
      and teacher.user_id = (select auth.uid())
  )
)
with check (
  bucket_id in ('pdfs', 'videos', 'photos', 'documents')
  and exists (
    select 1 from public.teachers as teacher
    where teacher.id::text = (storage.foldername(name))[1]
      and teacher.user_id = (select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'materials'
  ) then
    alter publication supabase_realtime add table public.materials;
  end if;
end;
$$;

commit;