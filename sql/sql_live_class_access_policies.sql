begin;

alter table public.live_classes enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'live_classes'
  loop
    execute format('drop policy %I on public.live_classes', policy_record.policyname);
  end loop;
end;
$$;

create policy "Teachers can select their live classes"
on public.live_classes
for select to authenticated
using (
  exists (
    select 1
    from public.teachers as teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
);

create policy "Teachers can insert their live classes"
on public.live_classes
for insert to authenticated
with check (
  exists (
    select 1
    from public.teachers as teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
);

create policy "Teachers can update their live classes"
on public.live_classes
for update to authenticated
using (
  exists (
    select 1
    from public.teachers as teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.teachers as teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
);

create policy "Teachers can delete their live classes"
on public.live_classes
for delete to authenticated
using (
  exists (
    select 1
    from public.teachers as teacher
    where teacher.id = live_classes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
);

create policy "Students can view eligible live classes"
on public.live_classes
for select to authenticated
using (
  exists (
    select 1
    from public.students as student
    join public.subjects as subject
      on subject.id = live_classes.subject_id
    where student.user_id = (select auth.uid())
      and student.grade::text = live_classes.grade::text
      and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade::integer]
      and (
        (
          student.grade::integer < 11
          and coalesce(live_classes.stream, '') = ''
        )
        or (
          student.grade::integer >= 11
          and
          lower(regexp_replace(coalesce(student.stream, ''), '[^a-z0-9]+', '', 'g'))
            = lower(regexp_replace(coalesce(live_classes.stream, ''), '[^a-z0-9]+', '', 'g'))
          and coalesce(subject.streams, '{}'::text[]) @> array[student.stream::text]
        )
      )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_classes'
  ) then
    alter publication supabase_realtime add table public.live_classes;
  end if;
end;
$$;

commit;
