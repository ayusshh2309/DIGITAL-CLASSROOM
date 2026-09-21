-- Smart Learning DC achievement definitions, unlocks, and auditable XP.
create table if not exists public.achievement_definitions (
  id uuid primary key default gen_random_uuid(),
  achievement_key text unique not null,
  name text not null,
  description text not null,
  icon text not null,
  color text not null default 'purple',
  category text not null,
  requirement_type text not null,
  requirement_value numeric not null check (requirement_value > 0),
  xp_reward integer not null default 0 check (xp_reward >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.student_achievements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references public.achievement_definitions(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique (student_id, achievement_id)
);

create table if not exists public.student_xp_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  reason text not null,
  xp integer not null check (xp > 0),
  created_at timestamptz not null default now(),
  unique (student_id, source_type, source_id, reason)
);

insert into public.achievement_definitions
  (achievement_key, name, description, icon, color, category, requirement_type, requirement_value, xp_reward)
values
  ('quick_learner', 'Quick Learner', 'Complete 5 learning sessions in one day.', 'fa-bolt', 'purple', 'Learning', 'sessions_in_day', 5, 100),
  ('streak_master', 'Streak Master', 'Maintain a 7-day study streak.', 'fa-fire', 'orange', 'Consistency', 'study_streak', 7, 150),
  ('quiz_master', 'Quiz Master', 'Score 90% or higher in 5 quizzes.', 'fa-star', 'green', 'Quizzes', 'high_score_quizzes', 5, 200),
  ('time_champion', 'Time Champion', 'Study for 20 or more hours in a week.', 'fa-clock', 'blue', 'Study Time', 'weekly_study_minutes', 1200, 250),
  ('first_step', 'First Step', 'Complete your first learning session.', 'fa-graduation-cap', 'pink', 'Learning', 'completed_sessions', 1, 50),
  ('bookworm', 'Bookworm', 'Complete 20 learning resources.', 'fa-book', 'purple', 'Learning', 'completed_resources', 20, 150),
  ('knowledge_seeker', 'Knowledge Seeker', 'Complete 30 study sessions.', 'fa-gem', 'purple', 'Learning', 'completed_sessions', 30, 300),
  ('top_scholar', 'Top Scholar', 'Reach a configured top-five ranking.', 'fa-crown', 'yellow', 'Challenges', 'ranking_position', 5, 500)
on conflict (achievement_key) do update set
  name = excluded.name, description = excluded.description, icon = excluded.icon,
  color = excluded.color, category = excluded.category, requirement_type = excluded.requirement_type,
  requirement_value = excluded.requirement_value, xp_reward = excluded.xp_reward;

alter table public.achievement_definitions enable row level security;
alter table public.student_achievements enable row level security;
alter table public.student_xp_transactions enable row level security;

drop policy if exists "Anyone can view active achievement definitions" on public.achievement_definitions;
create policy "Anyone can view active achievement definitions" on public.achievement_definitions
  for select using (active = true);

drop policy if exists "Students view their achievements" on public.student_achievements;
create policy "Students view their achievements" on public.student_achievements
  for select using (auth.uid() = student_id);

drop policy if exists "Students unlock their achievements" on public.student_achievements;
create policy "Students unlock their achievements" on public.student_achievements
  for insert with check (auth.uid() = student_id);

drop policy if exists "Students view their XP" on public.student_xp_transactions;
create policy "Students view their XP" on public.student_xp_transactions
  for select using (auth.uid() = student_id);

drop policy if exists "Students create their XP" on public.student_xp_transactions;
create policy "Students create their XP" on public.student_xp_transactions
  for insert with check (auth.uid() = student_id);

create index if not exists student_achievements_student_unlock_idx on public.student_achievements(student_id, unlocked_at desc);
create index if not exists student_xp_transactions_student_created_idx on public.student_xp_transactions(student_id, created_at desc);
