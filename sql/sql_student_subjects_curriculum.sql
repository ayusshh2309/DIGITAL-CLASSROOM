begin;

do $$
begin
  if to_regclass('public.students') is null or to_regclass('public.subjects') is null then
    raise exception 'Apply the existing student registration and subjects migrations first.';
  end if;
end;
$$;

alter table public.subjects
  add column if not exists grades integer[] not null default '{}',
  add column if not exists streams text[] not null default '{}';

update public.subjects set grades = '{}'::integer[] where grades is null;
update public.subjects set streams = '{}'::text[] where streams is null;

alter table public.subjects
  alter column grades set default '{}',
  alter column grades set not null,
  alter column streams set default '{}',
  alter column streams set not null;

create index if not exists subjects_grades_gin_idx
  on public.subjects using gin (grades);
create index if not exists subjects_streams_gin_idx
  on public.subjects using gin (streams);

do $$
begin
  if to_regclass('public.teacher_subject_assignments') is not null then
    execute 'drop policy if exists "Students read their registered class subject assignments" on public.teacher_subject_assignments';
  end if;
end;
$$;

do $$
declare
  curriculum record;
  existing_subject_id public.subjects.id%type;
begin
  for curriculum in
    select *
    from (values
      ('English', array[5,6,7,8,9,10,11,12]::integer[], array['science_pcm','science_pcb','commerce','arts_humanities']::text[]),
      ('Mathematics', array[5,6,7,8,9,10,11,12]::integer[], array['science_pcm']::text[]),
      ('Environmental Studies', array[5]::integer[], array[]::text[]),
      ('Hindi', array[5,6,7,8,9,10]::integer[], array[]::text[]),
      ('Computer Science', array[5,6,7,8,9,10,11,12]::integer[], array['science_pcm','science_pcb','commerce','arts_humanities']::text[]),
      ('General Knowledge', array[5]::integer[], array[]::text[]),
      ('Art', array[5]::integer[], array[]::text[]),
      ('Physical Education', array[5,6,7,8,9,10,11,12]::integer[], array['science_pcm','science_pcb','commerce','arts_humanities']::text[]),
      ('Science', array[6,7,8,9,10]::integer[], array[]::text[]),
      ('Social Science', array[6,7,8,9,10]::integer[], array[]::text[]),
      ('Sanskrit', array[6,7,8]::integer[], array[]::text[]),
      ('Physics', array[11,12]::integer[], array['science_pcm','science_pcb']::text[]),
      ('Chemistry', array[11,12]::integer[], array['science_pcm','science_pcb']::text[]),
      ('Biology', array[11,12]::integer[], array['science_pcb']::text[]),
      ('Accountancy', array[11,12]::integer[], array['commerce']::text[]),
      ('Business Studies', array[11,12]::integer[], array['commerce']::text[]),
      ('Economics', array[11,12]::integer[], array['commerce']::text[]),
      ('History', array[11,12]::integer[], array['arts_humanities']::text[]),
      ('Political Science', array[11,12]::integer[], array['arts_humanities']::text[]),
      ('Geography', array[11,12]::integer[], array['arts_humanities']::text[]),
      ('Sociology', array[11,12]::integer[], array['arts_humanities']::text[])
    ) as curriculum_data(name, grades, streams)
  loop
    existing_subject_id := null;
    select subject.id
      into existing_subject_id
      from public.subjects as subject
      where lower(btrim(subject.name)) = lower(curriculum.name)
        or (
          curriculum.name = 'Environmental Studies'
          and lower(btrim(subject.name)) = 'evs'
        )
      order by (lower(btrim(subject.name)) = lower(curriculum.name)) desc,
        subject.id::text
      limit 1;

    if existing_subject_id is null then
      insert into public.subjects (name, grades, streams)
      values (curriculum.name, curriculum.grades, curriculum.streams);
    else
      update public.subjects
      set name = curriculum.name,
          grades = curriculum.grades,
          streams = curriculum.streams
      where id = existing_subject_id;
    end if;
  end loop;
end;
$$;

alter table public.subjects enable row level security;

drop policy if exists "Students read their registered class subjects"
  on public.subjects;
create policy "Students read their registered class subjects"
  on public.subjects
  for select to authenticated
  using (exists (
    select 1
    from public.students as student
    where student.user_id = (select auth.uid())
      and subjects.grades @> array[student.grade]
      and (
        student.grade between 5 and 10
        or exists (
          select 1
          from unnest(subjects.streams) as subject_stream(stream)
          where lower(btrim(subject_stream.stream)) = lower(btrim(student.stream))
        )
      )
  ));

do $$
begin
  if to_regclass('public.teachers') is not null then
    execute 'drop policy if exists "Teachers read the subject catalog" on public.subjects';
    execute $policy$
      create policy "Teachers read the subject catalog"
        on public.subjects
        for select to authenticated
        using (exists (
          select 1
          from public.teachers as teacher
          where teacher.user_id = (select auth.uid())
        ))
    $policy$;
  end if;
end;
$$;

grant select on public.subjects to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if to_regclass('public.subjects') is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'subjects'
      ) then
      execute 'alter publication supabase_realtime add table public.subjects';
    end if;
    if to_regclass('public.materials') is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'materials'
      ) then
      execute 'alter publication supabase_realtime add table public.materials';
    end if;
    if to_regclass('public.quizzes') is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'quizzes'
      ) then
      execute 'alter publication supabase_realtime add table public.quizzes';
    end if;
    if to_regclass('public.quiz_attempts') is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'quiz_attempts'
      ) then
      execute 'alter publication supabase_realtime add table public.quiz_attempts';
    end if;
    if to_regclass('public.student_video_progress') is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'student_video_progress'
      ) then
      execute 'alter publication supabase_realtime add table public.student_video_progress';
    end if;
  end if;
end;
$$;

commit;
