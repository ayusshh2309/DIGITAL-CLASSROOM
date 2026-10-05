alter table public.students enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'students'
      and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.students', policy_record.policyname);
  end loop;
end;
$$;

create policy "Students read their own registration"
  on public.students
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Teachers read students in registered classes"
  on public.students
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teachers as teacher
      join public.teacher_grade_groups as grade_group
        on grade_group.teacher_id = teacher.id
      where teacher.user_id = (select auth.uid())
        and grade_group.grade = students.grade
        and grade_group.stream is not distinct from students.stream
    )
  );

drop policy if exists "Students create their own registration" on public.students;
create policy "Students create their own registration"
  on public.students
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Students update their own registration" on public.students;
create policy "Students update their own registration"
  on public.students
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.students to authenticated;

drop policy if exists "Teachers view registered students profile images" on storage.objects;
create policy "Teachers view registered students profile images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-profile-images'
    and exists (
      select 1
      from public.students as student
      where student.user_id::text = (storage.foldername(name))[1]
    )
  );

alter table public.students replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'students'
    ) then
    alter publication supabase_realtime add table public.students;
  end if;
end;
$$;
