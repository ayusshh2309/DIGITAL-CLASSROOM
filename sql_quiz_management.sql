-- Smart Learning DC quiz management schema.
-- Run with the public anon key only; never expose the service-role key in the browser.
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  class_grade text not null,
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
  question_count integer not null default 0,
  total_marks numeric not null default 0,
  response_count integer not null default 0,
  average_score numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_availability_order check (end_at is null or start_at is null or end_at > start_at)
);

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
