begin;

do $$
declare
  teacher_attnum smallint;
  foreign_key record;
begin
  if to_regclass('public.quizzes') is null then
    raise exception 'Expected public.quizzes to exist; this migration will not create a duplicate quiz table';
  end if;

  if to_regclass('public.teachers') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null
    or to_regclass('public.subjects') is null then
    raise exception 'Expected the normalized teacher and subject tables to exist';
  end if;

  select attnum into teacher_attnum
  from pg_attribute
  where attrelid = 'public.quizzes'::regclass
    and attname = 'teacher_id'
    and not attisdropped;
  if teacher_attnum is null then
    raise exception 'public.quizzes.teacher_id is required';
  end if;

  if exists (
    select 1
    from public.quizzes quiz
    where not exists (
      select 1 from public.teachers teacher
      where teacher.id = quiz.teacher_id or teacher.user_id = quiz.teacher_id
    )
  ) then
    raise exception 'Some quizzes cannot be mapped to public.teachers; resolve those records before migration';
  end if;

  for foreign_key in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.quizzes'::regclass
      and constraint_record.contype = 'f'
      and teacher_attnum = any(constraint_record.conkey)
      and constraint_record.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.quizzes drop constraint %I', foreign_key.conname);
  end loop;

  update public.quizzes quiz
  set teacher_id = teacher.id
  from public.teachers teacher
  where quiz.teacher_id = teacher.user_id
    and not exists (
      select 1 from public.teachers existing_teacher
      where existing_teacher.id = quiz.teacher_id
    );

  if not exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.quizzes'::regclass
      and constraint_record.confrelid = 'public.teachers'::regclass
      and constraint_record.contype = 'f'
      and teacher_attnum = any(constraint_record.conkey)
  ) then
    alter table public.quizzes
      add constraint quizzes_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;
end;
$$;

do $$
declare
  grade_type oid;
  subject_id_type oid;
  subjects_id_type oid;
  subject_id_attnum smallint;
begin
  select atttypid into grade_type
  from pg_attribute
  where attrelid = 'public.quizzes'::regclass
    and attname = 'grade'
    and not attisdropped;
  if grade_type is null then
    alter table public.quizzes add column grade integer;
  elsif grade_type <> 'int4'::regtype then
    execute $sql$
      alter table public.quizzes alter column grade type integer
      using nullif(substring(coalesce(nullif(grade::text, ''), class_grade) from '(1[0-2]|[1-9])'), '')::integer
    $sql$;
  end if;
  update public.quizzes
  set grade = nullif(substring(coalesce(nullif(grade::text, ''), class_grade) from '(1[0-2]|[1-9])'), '')::integer
  where grade is null;

  select atttypid into subjects_id_type
  from pg_attribute
  where attrelid = 'public.subjects'::regclass
    and attname = 'id'
    and not attisdropped;
  if subjects_id_type is null then
    raise exception 'public.subjects.id is required';
  end if;

  select attnum, atttypid into subject_id_attnum, subject_id_type
  from pg_attribute
  where attrelid = 'public.quizzes'::regclass
    and attname = 'subject_id'
    and not attisdropped;
  if subject_id_type is null then
    execute format(
      'alter table public.quizzes add column subject_id %s',
      format_type(subjects_id_type, null)
    );
    select attnum, atttypid into subject_id_attnum, subject_id_type
    from pg_attribute
    where attrelid = 'public.quizzes'::regclass
      and attname = 'subject_id'
      and not attisdropped;
  end if;
  if subject_id_type <> subjects_id_type then
    raise exception 'public.quizzes.subject_id must match public.subjects.id';
  end if;

  alter table public.quizzes
    add column if not exists file_name text,
    add column if not exists file_path text,
    add column if not exists storage_bucket text default 'quizzes',
    add column if not exists quiz_type text,
    add column if not exists file_size bigint,
    add column if not exists mime_type text;

  update public.quizzes quiz
  set subject_id = subject_record.id
  from public.subjects subject_record
  where quiz.subject_id is null
    and lower(trim(subject_record.name)) = lower(trim(quiz.subject));

  if not exists (
    select 1 from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.quizzes'::regclass
      and constraint_record.confrelid = 'public.subjects'::regclass
      and constraint_record.contype = 'f'
      and subject_id_attnum = any(constraint_record.conkey)
  ) then
    alter table public.quizzes
      add constraint quizzes_subject_id_fkey
      foreign key (subject_id) references public.subjects(id) on delete restrict;
  end if;
end;
$$;

create index if not exists quizzes_teacher_grade_stream_subject_idx
  on public.quizzes (teacher_id, grade, stream, subject_id, created_at desc);

alter table public.quizzes enable row level security;
drop policy if exists "Teachers manage their quizzes" on public.quizzes;
drop policy if exists quizzes_teacher_select_own on public.quizzes;
drop policy if exists quizzes_teacher_insert_assigned on public.quizzes;
drop policy if exists quizzes_teacher_update_assigned on public.quizzes;
drop policy if exists quizzes_teacher_delete_own on public.quizzes;

create policy quizzes_teacher_select_own on public.quizzes
for select to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
));

create policy quizzes_teacher_insert_assigned on public.quizzes
for insert to authenticated
with check (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups grade_group
  where grade_group.teacher_id = quizzes.teacher_id
    and grade_group.grade = quizzes.grade
    and grade_group.stream is not distinct from quizzes.stream
) and exists (
  select 1 from public.teacher_subject_assignments assignment
  where assignment.teacher_id = quizzes.teacher_id
    and assignment.subject_id = quizzes.subject_id
    and assignment.grade = quizzes.grade
    and assignment.stream is not distinct from quizzes.stream
)) and quizzes.file_path is not null
  and quizzes.file_name is not null
  and quizzes.storage_bucket = 'quizzes';

create policy quizzes_teacher_update_assigned on public.quizzes
for update to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups grade_group
  where grade_group.teacher_id = quizzes.teacher_id
    and grade_group.grade = quizzes.grade
    and grade_group.stream is not distinct from quizzes.stream
) and exists (
  select 1 from public.teacher_subject_assignments assignment
  where assignment.teacher_id = quizzes.teacher_id
    and assignment.subject_id = quizzes.subject_id
    and assignment.grade = quizzes.grade
    and assignment.stream is not distinct from quizzes.stream
)) and quizzes.file_path is not null
  and quizzes.file_name is not null
  and quizzes.storage_bucket = 'quizzes';

create policy quizzes_teacher_delete_own on public.quizzes
for delete to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
));

drop policy if exists quizzes_teacher_guard on public.quizzes;
create policy quizzes_teacher_guard on public.quizzes
as restrictive for all to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id
    and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups grade_group
  where grade_group.teacher_id = quizzes.teacher_id
    and grade_group.grade = quizzes.grade
    and grade_group.stream is not distinct from quizzes.stream
) and exists (
  select 1 from public.teacher_subject_assignments assignment
  where assignment.teacher_id = quizzes.teacher_id
    and assignment.subject_id = quizzes.subject_id
    and assignment.grade = quizzes.grade
    and assignment.stream is not distinct from quizzes.stream
) and quizzes.file_path is not null
  and quizzes.file_name is not null
  and quizzes.storage_bucket = 'quizzes');

revoke all on public.quizzes from anon;
grant select, insert, update, delete on public.quizzes to authenticated;

update storage.buckets set public = false where id = 'quizzes';
drop policy if exists quizzes_teacher_storage_access on storage.objects;
create policy quizzes_teacher_storage_access on storage.objects
for all to authenticated
using (
  bucket_id = 'quizzes'
  and exists (
    select 1 from public.teachers teacher
    where teacher.id::text = (storage.foldername(name))[1]
      and teacher.user_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'quizzes'
  and exists (
    select 1 from public.teachers teacher
    where teacher.id::text = (storage.foldername(name))[1]
      and teacher.user_id = (select auth.uid())
  )
);

drop policy if exists quizzes_teacher_storage_guard on storage.objects;
create policy quizzes_teacher_storage_guard on storage.objects
as restrictive for all to public
using (
  bucket_id <> 'quizzes'
  or exists (
    select 1 from public.teachers teacher
    where teacher.id::text = (storage.foldername(name))[1]
      and teacher.user_id = (select auth.uid())
  )
)
with check (
  bucket_id <> 'quizzes'
  or exists (
    select 1 from public.teachers teacher
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
      and tablename = 'quizzes'
  ) then
    alter publication supabase_realtime add table public.quizzes;
  end if;
end;
$$;

commit;