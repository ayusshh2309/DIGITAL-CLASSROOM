-- Smart Learning DC quiz management schema.
-- Run with the public anon key only; never expose the service-role key in the browser.
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
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
  time_limit integer not null default 30 check (time_limit > 0),
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

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 1,
  text text not null,
  type text not null check (type in ('Multiple Choice', 'True/False', 'Multiple Answer', 'Short Answer', 'Fill in the Blank')),
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

-- Downloads and teacher resource management
create table if not exists public.downloads_files (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_type text not null,
  category text not null default 'Documents',
  class_grade text not null,
  subject text not null,
  description text,
  visibility text not null default 'Class' check (visibility in ('Class', 'Department', 'Teacher Only')),
  file_url text,
  storage_path text,
  size_bytes bigint not null default 0,
  download_count integer not null default 0,
  mime_type text,
  is_material_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
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
  updated_at timestamptz not null default now(),
  source_download_id uuid references public.downloads_files(id) on delete set null,
  sync_to_materials boolean not null default false
);

create index if not exists downloads_files_teacher_created_idx on public.downloads_files(teacher_id, created_at desc);
create index if not exists downloads_files_teacher_class_subject_idx on public.downloads_files(teacher_id, class_grade, subject);
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
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Attended')),
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

alter table public.downloads_files enable row level security;
alter table public.materials enable row level security;

create policy "Teachers manage their own downloads" on public.downloads_files
for all
using (auth.uid() = teacher_id)
with check (auth.uid() = teacher_id);

create policy "Teachers manage their own materials" on public.materials
for all
using (auth.uid() = teacher_id)
with check (auth.uid() = teacher_id);

create policy "Students can view shared class materials" on public.materials
for select
using (
  auth.uid() is not null and
  teacher_id is not null and
  class_grade is not null and
  subject is not null
);

create policy "Students can view shared downloads" on public.downloads_files
for select
using (
  auth.uid() is not null and
  teacher_id is not null and
  visibility in ('Class', 'Department')
);

create policy "Teachers can upload to teacher_resources" on storage.objects
for insert with check (bucket_id = 'teacher_resources' and auth.role() = 'authenticated');

create policy "Teachers can update their own resource files" on storage.objects
for update using (bucket_id = 'teacher_resources' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Teachers can delete their own resource files" on storage.objects
for delete using (bucket_id = 'teacher_resources' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Teachers can view their own resource files" on storage.objects
for select using (bucket_id = 'teacher_resources' and auth.uid()::text = (storage.foldername(name))[1]);

alter publication supabase_realtime add table public.downloads_files;
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
alter table public.materials add column if not exists external_url text;
alter table public.materials add column if not exists video_url text;
alter table public.materials add column if not exists thumbnail_url text;
alter table public.materials add column if not exists duration text;
alter table public.materials add column if not exists duration_seconds numeric;
alter table public.materials add column if not exists uploaded_at timestamptz not null default now();
alter table public.materials add column if not exists status text not null default 'published';
update public.materials set material_id = id where material_id is null;
update public.materials set grade = class_grade where grade is null;

create table if not exists public.material_downloads (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  student_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  downloaded_at timestamptz not null default now()
);

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
alter table public.material_downloads enable row level security;
alter table public.student_video_progress enable row level security;
drop policy if exists "Students view own profile" on public.student_profiles;
create policy "Students view own profile" on public.student_profiles for select using (auth.uid() = student_id);
drop policy if exists "Students record own material downloads" on public.material_downloads;
create policy "Students record own material downloads" on public.material_downloads for insert with check (auth.uid() = student_id);
drop policy if exists "Students view own material downloads" on public.material_downloads;
create policy "Students view own material downloads" on public.material_downloads for select using (auth.uid() = student_id);
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
  join public.student_profiles student on student.student_id = auth.uid()
  where requested_student_id = auth.uid()
    and material.status = 'published'
    and lower(coalesce(material.material_type, material.type)) in ('pdf', 'image', 'document', 'link')
    and material.class_grade = student.grade
    and (material.stream is null or material.stream = '' or lower(material.stream) = lower(coalesce(student.stream, '')))
    and lower(material.subject) = any(select lower(subject) from unnest(student.eligible_subjects) subject);
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
    material.chapter, coalesce(material.video_url, material.file_url, material.external_url),
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
alter publication supabase_realtime add table public.material_downloads;
alter publication supabase_realtime add table public.student_video_progress;
