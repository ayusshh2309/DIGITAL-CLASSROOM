-- Teacher and student read access for the existing achievement tables.
-- This script does not create or alter tables or foreign keys.

drop policy if exists "Anyone can view active achievement definitions"
  on public.achievement_definitions;
drop policy if exists "Authenticated users view active achievement definitions"
  on public.achievement_definitions;
create policy "Authenticated users view active achievement definitions"
  on public.achievement_definitions
  for select to authenticated
  using (is_active = true);

drop policy if exists "Students view their achievements"
  on public.student_achievements;
create policy "Students view their achievements"
  on public.student_achievements
  for select to authenticated
  using (exists (
    select 1
    from public.students as student
    where student.id = student_achievements.student_id
      and student.user_id = (select auth.uid())
  ));

drop policy if exists "Teachers view achievements for registered students"
  on public.student_achievements;
create policy "Teachers view achievements for registered students"
  on public.student_achievements
  for select to authenticated
  using (exists (
    select 1
    from public.students as student
    where student.id = student_achievements.student_id
      and public.teacher_can_access_student_scope(student.grade, student.stream)
  ));

drop policy if exists "Teachers view definitions unlocked by registered students"
  on public.achievement_definitions;
create policy "Teachers view definitions unlocked by registered students"
  on public.achievement_definitions
  for select to authenticated
  using (exists (
    select 1
    from public.student_achievements as achievement
    join public.students as student
      on student.id = achievement.student_id
    where achievement.achievement_id = achievement_definitions.id
      and public.teacher_can_access_student_scope(student.grade, student.stream)
  ));

drop policy if exists "Students unlock their achievements"
  on public.student_achievements;
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_achievements'
      and cmd in ('INSERT', 'ALL')
  loop
    execute format(
      'drop policy %I on public.student_achievements',
      policy_record.policyname
    );
  end loop;
end;
$$;
revoke insert on public.student_achievements from public, anon, authenticated;
grant select on public.achievement_definitions, public.student_achievements
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'student_achievements'
    ) then
      alter publication supabase_realtime add table public.student_achievements;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'achievement_definitions'
    ) then
      alter publication supabase_realtime add table public.achievement_definitions;
    end if;
  end if;
end;
$$;
