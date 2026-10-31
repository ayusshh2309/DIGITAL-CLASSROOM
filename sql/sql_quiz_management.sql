-- Smart Learning DC quiz management schema.
-- Run with the public anon key only; never expose the service-role key in the browser.
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  grade text,
  class_grade text not null,
  stream text,
  subject text not null,
  topic text not null,
  description text,
  instructions text,
  difficulty text not null default 'Medium' check (difficulty in ('Easy', 'Medium', 'Hard')),
  status text not null default 'draft' check (status in ('draft', 'published', 'scheduled', 'archived')),
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  attempts_allowed integer not null default 1 check (attempts_allowed > 0),
  marks_per_question numeric not null default 1 check (marks_per_question > 0),
  negative_marking numeric not null default 0 check (negative_marking <= 0),
  passing_percentage numeric not null default 40 check (passing_percentage between 0 and 100),
  shuffle_questions boolean not null default false,
  shuffle_options boolean not null default false,
  start_at timestamptz,
  end_at timestamptz,
  published_at timestamptz,
  question_count integer not null default 0,
  total_marks numeric not null default 0,
  response_count integer not null default 0,
  average_score numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_availability_order check (end_at is null or start_at is null or end_at > start_at)
);

alter table public.quizzes add column if not exists grade text;
alter table public.quizzes add column if not exists stream text;
alter table public.quizzes add column if not exists published_at timestamptz;
alter table public.quizzes add column if not exists duration_minutes integer not null default 30;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quizzes' and column_name = 'time_limit'
  ) then
    execute 'update public.quizzes set duration_minutes = time_limit where duration_minutes = 30 and time_limit <> 30';
  end if;
end;
$$;

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 1,
  text text not null,
  type text not null check (type in ('Multiple Choice', 'True/False')),
  marks numeric not null default 1 check (marks > 0),
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb,
  explanation text,
  image_path text,
  created_at timestamptz not null default now()
);

create index if not exists quizzes_teacher_updated_idx on public.quizzes(teacher_id, updated_at desc);
create index if not exists quizzes_target_idx on public.quizzes(class_grade, stream, subject, status, start_at);
create index if not exists quiz_questions_quiz_position_idx on public.quiz_questions(quiz_id, position);

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;

drop policy if exists "Teachers manage their quizzes" on public.quizzes;
create policy "Teachers manage their quizzes" on public.quizzes for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

drop policy if exists "Teachers manage their quiz questions" on public.quiz_questions;
create policy "Teachers manage their quiz questions" on public.quiz_questions for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- Realtime publication is project-level and may already include these tables.
alter publication supabase_realtime add table public.quizzes;
alter publication supabase_realtime add table public.quiz_questions;

-- Materials remain the only source for uploaded files.
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  name text,
  description text,
  type text not null default 'document',
  material_type text,
  class_grade text not null,
  subject text not null,
  file_url text,
  storage_path text,
  file_name text,
  file_size bigint not null default 0,
  size bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists materials_teacher_created_idx on public.materials(teacher_id, created_at desc);

-- Teacher live-class scheduling and attendance state
create table if not exists public.live_classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  class_grade text not null,
  subject text not null,
  topic text,
  start_at timestamptz not null,
  status text not null default 'scheduled' check (lower(status) in ('scheduled', 'live', 'completed', 'cancelled', 'missed', 'attended')),
  attended_at timestamptz,
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_classes_teacher_start_idx on public.live_classes(teacher_id, start_at);
alter table public.live_classes enable row level security;

drop policy if exists "Teachers manage their live classes" on public.live_classes;
create policy "Teachers manage their live classes" on public.live_classes
for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

alter publication supabase_realtime add table public.live_classes;

alter table public.materials enable row level security;

drop policy if exists "Teachers manage their own materials" on public.materials;
drop policy if exists "Students can view shared class materials" on public.materials;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'materials'
      and policyname = 'materials_teacher_insert_assigned'
  ) then
    execute $policy$
      create policy "Teachers manage their own materials" on public.materials
      for all to authenticated
      using (exists (
        select 1 from public.teachers as teacher
        where teacher.id = materials.teacher_id
          and teacher.user_id = (select auth.uid())
      ))
      with check (exists (
        select 1 from public.teachers as teacher
        where teacher.id = materials.teacher_id
          and teacher.user_id = (select auth.uid())
      ))
    $policy$;
  end if;
end;
$$;

drop policy if exists "Teachers can upload to teacher_resources" on storage.objects;
create policy "Teachers can upload to teacher_resources" on storage.objects
for insert to authenticated with check (
  bucket_id = 'teacher_resources'
  and (storage.foldername(name))[1] = 'teacher-resources'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Teachers can update their own resource files" on storage.objects;
create policy "Teachers can update their own resource files" on storage.objects
for update to authenticated
using (
  bucket_id = 'teacher_resources'
  and (storage.foldername(name))[1] = 'teacher-resources'
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'teacher_resources'
  and (storage.foldername(name))[1] = 'teacher-resources'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Teachers can delete their own resource files" on storage.objects;
create policy "Teachers can delete their own resource files" on storage.objects
for delete to authenticated using (
  bucket_id = 'teacher_resources'
  and (storage.foldername(name))[1] = 'teacher-resources'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Teachers can view their own resource files" on storage.objects;
create policy "Teachers can view their own resource files" on storage.objects
for select to authenticated using (
  bucket_id = 'teacher_resources'
  and (storage.foldername(name))[1] = 'teacher-resources'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

alter publication supabase_realtime add table public.materials;

-- Student material authorization. Keep this table populated from the authenticated registration flow.
create table if not exists public.student_profiles (
  student_id uuid primary key references auth.users(id) on delete cascade,
  student_code text,
  grade text not null,
  stream text,
  eligible_subjects text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.materials add column if not exists material_id uuid;
alter table public.materials add column if not exists teacher_name text;
alter table public.materials add column if not exists grade text;
alter table public.materials add column if not exists stream text;
alter table public.materials add column if not exists chapter text;
alter table public.materials add column if not exists video_url text;
alter table public.materials add column if not exists thumbnail_url text;
alter table public.materials add column if not exists duration text;
alter table public.materials add column if not exists duration_seconds numeric;
alter table public.materials add column if not exists uploaded_at timestamptz not null default now();
alter table public.materials add column if not exists status text not null default 'published';
update public.materials set material_id = id where material_id is null;
update public.materials set grade = class_grade where grade is null;

create table if not exists public.student_video_progress (
  student_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id uuid not null references public.materials(id) on delete cascade,
  watch_position numeric not null default 0,
  duration numeric not null default 0,
  completed boolean not null default false,
  last_watched_at timestamptz not null default now(),
  primary key (student_id, video_id)
);

alter table public.student_profiles enable row level security;
alter table public.student_video_progress enable row level security;
drop policy if exists "Students view own profile" on public.student_profiles;
create policy "Students view own profile" on public.student_profiles for select using (auth.uid() = student_id);
drop policy if exists "Students manage own video progress" on public.student_video_progress;
create policy "Students manage own video progress" on public.student_video_progress for all using (auth.uid() = student_id) with check (auth.uid() = student_id);

drop policy if exists "Students can view shared class materials" on public.materials;
create or replace function public.get_student_materials(requested_student_id uuid)
returns setof public.materials
language sql
security definer
set search_path = public
as $$
  select material.*
  from public.materials material
  join public.students student on student.user_id = auth.uid()
  where requested_student_id = auth.uid()
    and material.status = 'published'
    and lower(coalesce(material.material_type, material.type)) in ('pdf', 'image', 'document', 'link')
    and material.grade = student.grade::text
    and (
      (student.grade between 5 and 10 and material.stream is null)
      or
      (student.grade in (11, 12) and material.stream is not distinct from student.stream)
    );
$$;

revoke all on function public.get_student_materials(uuid) from public;
grant execute on function public.get_student_materials(uuid) to authenticated;

create or replace function public.get_student_videos(requested_student_id uuid)
returns table (
  id uuid, material_id uuid, teacher_id uuid, teacher_name text, grade text, class_grade text,
  stream text, subject text, material_type text, type text, title text, description text,
  chapter text, video_url text, thumbnail_url text, duration text, duration_seconds numeric,
  uploaded_at timestamptz, updated_at timestamptz, status text, watch_position numeric,
  completed boolean
)
language sql
security definer
set search_path = public
as $$
  select material.id, material.material_id, material.teacher_id, material.teacher_name,
    material.grade, material.class_grade, material.stream, material.subject,
    material.material_type, material.type, material.title, material.description,
    material.chapter, coalesce(material.video_url, material.file_url),
    material.thumbnail_url, material.duration, material.duration_seconds,
    material.uploaded_at, material.updated_at, material.status,
    coalesce(progress.watch_position, 0), coalesce(progress.completed, false)
  from public.materials material
  join public.student_profiles student on student.student_id = auth.uid()
  left join public.student_video_progress progress
    on progress.video_id = material.id and progress.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and material.status = 'published'
    and lower(coalesce(material.material_type, material.type)) = 'video'
    and material.class_grade = student.grade
    and (material.stream is null or material.stream = '' or lower(material.stream) = lower(coalesce(student.stream, '')))
    and lower(material.subject) = any(select lower(subject) from unnest(student.eligible_subjects) subject);
$$;

create or replace function public.save_student_video_progress(
  requested_video_id uuid,
  requested_position numeric,
  requested_duration numeric,
  requested_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.get_student_videos(auth.uid()) video where video.id = requested_video_id) then
    insert into public.student_video_progress (student_id, video_id, watch_position, duration, completed, last_watched_at)
    values (auth.uid(), requested_video_id, greatest(requested_position, 0), greatest(requested_duration, 0), requested_completed, now())
    on conflict (student_id, video_id) do update set
      watch_position = excluded.watch_position, duration = excluded.duration,
      completed = excluded.completed, last_watched_at = now();
  end if;
end;
$$;

revoke all on function public.get_student_videos(uuid) from public;
grant execute on function public.get_student_videos(uuid) to authenticated;
revoke all on function public.save_student_video_progress(uuid, numeric, numeric, boolean) from public;
grant execute on function public.save_student_video_progress(uuid, numeric, numeric, boolean) to authenticated;
alter publication supabase_realtime add table public.student_profiles;

-- Student calendar feed. This keeps eligibility enforcement on the database side
-- while allowing the browser to render classes, materials, and published quizzes.
alter table public.live_classes add column if not exists stream text;
alter table public.live_classes add column if not exists duration_minutes integer not null default 60;
alter table public.live_classes add column if not exists updated_at timestamptz not null default now();

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  instructions text,
  class_grade text not null,
  stream text,
  subject text not null,
  due_at timestamptz not null,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_calendar (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  class_grade text,
  stream text,
  start_at timestamptz not null,
  end_at timestamptz,
  event_type text not null default 'holiday',
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assignments enable row level security;
alter table public.academic_calendar enable row level security;
create index if not exists assignments_target_due_idx on public.assignments(class_grade, stream, subject, due_at);
create index if not exists academic_calendar_date_idx on public.academic_calendar(start_at, end_at);
alter publication supabase_realtime add table public.assignments;
alter publication supabase_realtime add table public.academic_calendar;

create or replace function public.get_student_calendar_events(requested_student_id uuid)
returns table (
  id text,
  source text,
  event_type text,
  title text,
  description text,
  class_grade text,
  stream text,
  subject text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  teacher_name text,
  location text,
  file_url text,
  duration_minutes integer,
  question_count integer,
  original_start_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    'class-' || live.id::text,
    'live_classes',
    case when live.status in ('Cancelled', 'Canceled') then 'rescheduled_class' else 'class' end,
    live.title,
    live.topic,
    live.class_grade,
    live.stream,
    live.subject,
    live.start_at,
    live.start_at + make_interval(mins => live.duration_minutes),
    live.status,
    null::text,
    null::text,
    null::text,
    live.duration_minutes,
    null::integer,
    null::timestamptz
  from public.live_classes live
  join public.students registered_student
    on registered_student.user_id = auth.uid()
  join public.teachers teacher
    on teacher.id = live.teacher_id
  join public.subjects subject
    on lower(btrim(subject.name)) = lower(btrim(live.subject))
  where requested_student_id = auth.uid()
    and to_jsonb(live)->>'publication_status' = 'published'
    and lower(coalesce(live.status, '')) not in ('cancelled', 'canceled')
    and nullif(regexp_replace(live.class_grade, '[^0-9]', '', 'g'), '')::integer
      = registered_student.grade
    and lower(coalesce(live.stream, '')) =
      lower(coalesce(registered_student.stream, ''))
    and coalesce(subject.grades, '{}'::integer[]) @> array[registered_student.grade]
    and (
      registered_student.grade between 5 and 10
      or exists (
        select 1
        from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
        where lower(btrim(allowed_stream.stream))
          = lower(btrim(registered_student.stream))
      )
    )
    and exists (
      select 1
      from public.teacher_grade_groups grade_group
      where grade_group.teacher_id = teacher.id
        and grade_group.grade =
          nullif(regexp_replace(live.class_grade, '[^0-9]', '', 'g'), '')::integer
        and grade_group.stream is not distinct from nullif(btrim(live.stream), '')
        and (
          coalesce(grade_group.teach_all_subjects, false)
          or exists (
            select 1
            from public.teacher_subject_assignments assignment
            where assignment.teacher_id = teacher.id
              and assignment.grade = grade_group.grade
              and assignment.stream is not distinct from grade_group.stream
              and assignment.subject_id::text = subject.id::text
          )
        )
    )
  union all
  select
    'material-' || material.id::text,
    'materials',
    'material',
    coalesce(material.title, material.name),
    material.description,
    material.class_grade,
    material.stream,
    material.subject,
    material.uploaded_at,
    material.uploaded_at,
    material.status,
    material.teacher_name,
    material.file_url,
    material.file_url,
    null::integer,
    null::integer,
    null::timestamptz
  from public.materials material
  join public.student_profiles student on student.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and material.status = 'published'
    and material.class_grade = student.grade
    and (material.stream is null or material.stream = '' or lower(material.stream) = lower(coalesce(student.stream, '')))
    and lower(material.subject) = any(select lower(value) from unnest(student.eligible_subjects) value)
  union all
  select
    'quiz-' || quiz.id::text,
    'quizzes',
    case when quiz.status = 'exam' then 'exam' else 'quiz' end,
    quiz.title,
    coalesce(quiz.description, quiz.instructions),
    quiz.class_grade,
    quiz.stream,
    quiz.subject,
    coalesce(quiz.start_at, quiz.published_at),
    coalesce(quiz.end_at, quiz.start_at, quiz.published_at),
    quiz.status,
    null::text,
    null::text,
    null::text,
    quiz.duration_minutes,
    quiz.question_count,
    null::timestamptz
  from public.quizzes quiz
  join public.student_profiles student on student.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and quiz.status in ('published', 'scheduled')
    and quiz.class_grade = student.grade
    and (quiz.stream is null or quiz.stream = '' or lower(quiz.stream) = lower(coalesce(student.stream, '')))
    and lower(quiz.subject) = any(select lower(value) from unnest(student.eligible_subjects) value)
  union all
  select
    'assignment-' || assignment.id::text,
    'assignments',
    'assignment',
    assignment.title,
    coalesce(assignment.description, assignment.instructions),
    assignment.class_grade,
    assignment.stream,
    assignment.subject,
    assignment.due_at,
    assignment.due_at,
    assignment.status,
    null::text,
    null::text,
    null::text,
    null::integer,
    null::integer,
    null::timestamptz
  from public.assignments assignment
  join public.student_profiles student on student.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and assignment.status = 'published'
    and assignment.class_grade = student.grade
    and (assignment.stream is null or assignment.stream = '' or lower(assignment.stream) = lower(coalesce(student.stream, '')))
    and lower(assignment.subject) = any(select lower(value) from unnest(student.eligible_subjects) value)
  union all
  select
    'holiday-' || holiday.id::text,
    'academic_calendar',
    holiday.event_type,
    holiday.title,
    holiday.description,
    coalesce(holiday.class_grade, student.grade),
    holiday.stream,
    null::text,
    holiday.start_at,
    coalesce(holiday.end_at, holiday.start_at),
    holiday.status,
    null::text,
    null::text,
    null::text,
    null::integer,
    null::integer,
    null::timestamptz
  from public.academic_calendar holiday
  join public.student_profiles student on student.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and holiday.status = 'published'
    and (holiday.class_grade is null or holiday.class_grade = '' or holiday.class_grade = student.grade)
    and (holiday.stream is null or holiday.stream = '' or lower(holiday.stream) = lower(coalesce(student.stream, '')));
$$;

revoke all on function public.get_student_calendar_events(uuid) from public;
grant execute on function public.get_student_calendar_events(uuid) to authenticated;
alter publication supabase_realtime add table public.student_video_progress;

-- Study Time schema and RPCs are maintained in sql_student_study_time.sql.
