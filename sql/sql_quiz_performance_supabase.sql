begin;

do $$
begin
  if to_regclass('public.quizzes') is null
    or to_regclass('public.quiz_questions') is null
    or to_regclass('public.students') is null
    or to_regclass('public.teachers') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null then
    raise exception 'Run the existing quiz, student, teacher, and subject migrations before this migration.';
  end if;
end;
$$;

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric not null default 0,
  total_marks numeric not null default 0,
  percentage numeric not null default 0,
  correct_answers integer not null default 0,
  wrong_answers integer not null default 0,
  unanswered integer not null default 0,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quiz_attempts
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists quiz_id uuid,
  add column if not exists student_id uuid,
  add column if not exists teacher_id uuid,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists submitted_at timestamptz,
  add column if not exists score numeric not null default 0,
  add column if not exists total_marks numeric not null default 0,
  add column if not exists percentage numeric not null default 0,
  add column if not exists correct_answers integer not null default 0,
  add column if not exists wrong_answers integer not null default 0,
  add column if not exists unanswered integer not null default 0,
  add column if not exists status text not null default 'in_progress',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists quiz_attempts_id_key
  on public.quiz_attempts (id);
create index if not exists quiz_attempts_quiz_student_started_idx
  on public.quiz_attempts (quiz_id, student_id, started_at desc);
create index if not exists quiz_attempts_student_submitted_idx
  on public.quiz_attempts (student_id, submitted_at desc)
  where status = 'submitted';

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  student_answer text,
  is_correct boolean not null default false,
  marks_awarded numeric not null default 0,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_answers_attempt_question_key unique (attempt_id, question_id)
);

alter table public.quiz_answers
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists attempt_id uuid,
  add column if not exists question_id uuid,
  add column if not exists student_answer text,
  add column if not exists is_correct boolean not null default false,
  add column if not exists marks_awarded numeric not null default 0,
  add column if not exists answered_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from public.quiz_answers
    group by attempt_id, question_id
    having count(*) > 1
  ) then
    raise exception 'Existing duplicate quiz_answers rows must be reconciled before adding unique(attempt_id, question_id). No rows were deleted.';
  end if;
end;
$$;

create unique index if not exists quiz_answers_id_key
  on public.quiz_answers (id);
create unique index if not exists quiz_answers_attempt_question_key
  on public.quiz_answers (attempt_id, question_id);
create index if not exists quiz_answers_question_idx
  on public.quiz_answers (question_id);

do $$
begin
  if exists (
    select 1 from public.quiz_attempts
    where id is null or quiz_id is null or student_id is null
  ) then
    raise exception 'Existing quiz_attempts rows need id, quiz_id, and student_id values before the quiz results migration can continue.';
  end if;
  if exists (
    select 1 from public.quiz_answers
    where id is null or attempt_id is null or question_id is null
  ) then
    raise exception 'Existing quiz_answers rows need id, attempt_id, and question_id values before the quiz results migration can continue.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_attempts'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'quiz_id')]::smallint[]
      and confrelid = 'public.quizzes'::regclass
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_quiz_id_fkey
      foreign key (quiz_id) references public.quizzes(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_attempts'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'student_id')]::smallint[]
      and confrelid = 'public.students'::regclass
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_student_id_fkey
      foreign key (student_id) references public.students(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_answers'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_answers'::regclass and attname = 'attempt_id')]::smallint[]
      and confrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_answers
      add constraint quiz_answers_attempt_id_fkey
      foreign key (attempt_id) references public.quiz_attempts(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_answers'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_answers'::regclass and attname = 'question_id')]::smallint[]
      and confrelid = 'public.quiz_questions'::regclass
  ) then
    alter table public.quiz_answers
      add constraint quiz_answers_question_id_fkey
      foreign key (question_id) references public.quiz_questions(id) on delete cascade;
  end if;
end;
$$;

create or replace function public.quiz_student_is_eligible(
  requested_quiz_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quizzes quiz
    join public.students student
      on student.user_id = (select auth.uid())
     and student.grade = quiz.grade
     and student.stream is not distinct from quiz.stream
    where quiz.id = requested_quiz_id
      and quiz.status = 'published'
  );
$$;

revoke all on function public.quiz_student_is_eligible(uuid) from public, anon;
grant execute on function public.quiz_student_is_eligible(uuid) to authenticated;

alter table public.students enable row level security;
drop policy if exists "Teachers read students in registered teaching scope" on public.students;
create policy "Teachers read students in registered teaching scope"
  on public.students for select to authenticated
  using (exists (
    select 1
    from public.teachers teacher
    join public.teacher_grade_groups grade_group on grade_group.teacher_id = teacher.id
    where teacher.user_id = (select auth.uid())
      and grade_group.grade = students.grade
      and grade_group.stream is not distinct from students.stream
  ));

drop policy if exists quizzes_student_read_published_assigned on public.quizzes;
create policy quizzes_student_read_published_assigned on public.quizzes
for select to authenticated
using (public.quiz_student_is_eligible(id));

drop policy if exists quizzes_quiz_access_guard on public.quizzes;
create policy quizzes_quiz_access_guard on public.quizzes
as restrictive for all to authenticated
using (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = quizzes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
  or public.quiz_student_is_eligible(id)
)
with check (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = quizzes.teacher_id
      and teacher.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = quizzes.teacher_id
      and grade_group.grade = quizzes.grade
      and grade_group.stream is not distinct from quizzes.stream
  )
  and exists (
    select 1 from public.teacher_subject_assignments assignment
    where assignment.teacher_id = quizzes.teacher_id
      and assignment.grade = quizzes.grade
      and assignment.stream is not distinct from quizzes.stream
      and assignment.subject_id::text = quizzes.subject_id::text
  )
);

create or replace function public.reject_unsupported_quiz_question_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.question_type is distinct from 'mcq'
    and new.question_type is distinct from 'true_false' then
    raise exception 'Only MCQ and True/False questions can be created or edited.';
  end if;
  return new;
end;
$$;

drop trigger if exists quiz_questions_supported_type_guard on public.quiz_questions;
create trigger quiz_questions_supported_type_guard
  before insert or update of question_type on public.quiz_questions
  for each row execute function public.reject_unsupported_quiz_question_types();

revoke all on function public.reject_unsupported_quiz_question_types() from public, anon, authenticated;

alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;

drop policy if exists quiz_attempts_read_own_or_owned_quiz on public.quiz_attempts;
create policy quiz_attempts_read_own_or_owned_quiz on public.quiz_attempts
for select to authenticated
using (
  exists (
    select 1 from public.students student
    where student.id = quiz_attempts.student_id
      and student.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = quiz_attempts.quiz_id
      and teacher.user_id = (select auth.uid())
  )
);

drop policy if exists quiz_attempts_scope_guard on public.quiz_attempts;
create policy quiz_attempts_scope_guard on public.quiz_attempts
as restrictive for all to authenticated
using (
  exists (
    select 1 from public.students student
    where student.id = quiz_attempts.student_id
      and student.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = quiz_attempts.quiz_id
      and teacher.user_id = (select auth.uid())
  )
)
with check (false);

drop policy if exists quiz_answers_read_own_or_owned_quiz on public.quiz_answers;
create policy quiz_answers_read_own_or_owned_quiz on public.quiz_answers
for select to authenticated
using (
  exists (
    select 1
    from public.quiz_attempts attempt
    join public.students student on student.id = attempt.student_id
    where attempt.id = quiz_answers.attempt_id
      and student.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.quiz_attempts attempt
    join public.quizzes quiz on quiz.id = attempt.quiz_id
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where attempt.id = quiz_answers.attempt_id
      and teacher.user_id = (select auth.uid())
  )
);

drop policy if exists quiz_answers_scope_guard on public.quiz_answers;
create policy quiz_answers_scope_guard on public.quiz_answers
as restrictive for all to authenticated
using (
  exists (
    select 1
    from public.quiz_attempts attempt
    join public.students student on student.id = attempt.student_id
    where attempt.id = quiz_answers.attempt_id
      and student.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.quiz_attempts attempt
    join public.quizzes quiz on quiz.id = attempt.quiz_id
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where attempt.id = quiz_answers.attempt_id
      and teacher.user_id = (select auth.uid())
  )
)
with check (false);

revoke all on public.quiz_attempts, public.quiz_answers from public, anon;
grant select on public.quiz_attempts, public.quiz_answers to authenticated;
revoke insert, update, delete on public.quiz_attempts, public.quiz_answers from authenticated;

drop function if exists public.get_student_quiz_questions(uuid);
create function public.get_student_quiz_questions(p_quiz_id uuid)
returns table (
  id uuid,
  question_number integer,
  question_type text,
  question_text text,
  options jsonb,
  marks numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select question.id,
         question.question_number,
         question.question_type,
         question.question_text,
         case when question.question_type = 'mcq' then question.options else null end,
         question.marks
  from public.quiz_questions question
  join public.quizzes quiz on quiz.id = question.quiz_id
  where quiz.id = p_quiz_id
    and public.quiz_student_is_eligible(quiz.id)
    and (quiz.start_at is null or quiz.start_at <= now())
    and (quiz.end_at is null or quiz.end_at >= now())
    and question.question_type in ('mcq', 'true_false')
  order by question.question_number;
$$;

revoke all on function public.get_student_quiz_questions(uuid) from public, anon;
grant execute on function public.get_student_quiz_questions(uuid) to authenticated;

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_student_id uuid;
  quiz_record public.quizzes%rowtype;
  current_attempt_id uuid;
  used_attempts integer;
  teacher_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before starting a quiz.' using errcode = '42501';
  end if;

  select student.id into authenticated_student_id
  from public.students student
  where student.user_id = (select auth.uid());
  if authenticated_student_id is null then
    raise exception 'No student profile is linked to this account.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(authenticated_student_id::text || p_quiz_id::text, 0));

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id
    and public.quiz_student_is_eligible(quiz.id);
  if not found then
    raise exception 'This published quiz is not available to your registered class.' using errcode = '42501';
  end if;
  if (quiz_record.start_at is not null and quiz_record.start_at > now())
    or (quiz_record.end_at is not null and quiz_record.end_at < now()) then
    raise exception 'This quiz is outside its availability window.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.quiz_questions question
    where question.quiz_id = p_quiz_id
      and question.question_type in ('mcq', 'true_false')
  ) or exists (
    select 1 from public.quiz_questions question
    where question.quiz_id = p_quiz_id
      and question.question_type is distinct from 'mcq'
      and question.question_type is distinct from 'true_false'
  ) then
    raise exception 'This quiz contains unsupported question types and cannot be started.';
  end if;

  select attempt.id into current_attempt_id
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = authenticated_student_id
    and attempt.status = 'in_progress'
  order by attempt.started_at desc
  limit 1
  for update;
  if current_attempt_id is not null then
    return current_attempt_id;
  end if;

  select count(*) into used_attempts
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = authenticated_student_id;
  if used_attempts >= greatest(coalesce(quiz_record.attempts_allowed, 1), 1) then
    raise exception 'You have used all attempts allowed for this quiz.' using errcode = '22023';
  end if;

  select case
    when exists (
      select 1 from pg_constraint constraint_record
      where constraint_record.conrelid = 'public.quiz_attempts'::regclass
        and constraint_record.contype = 'f'
        and constraint_record.conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'teacher_id')]::smallint[]
        and constraint_record.confrelid = 'auth.users'::regclass
    ) then (select auth.uid())
    when exists (
      select 1 from pg_constraint constraint_record
      where constraint_record.conrelid = 'public.quiz_attempts'::regclass
        and constraint_record.contype = 'f'
        and constraint_record.conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'teacher_id')]::smallint[]
        and constraint_record.confrelid = 'public.teachers'::regclass
    ) then quiz_record.teacher_id
    else (select auth.uid())
  end into teacher_id_value;

  insert into public.quiz_attempts (quiz_id, student_id, teacher_id, started_at, status)
  values (p_quiz_id, authenticated_student_id, teacher_id_value, now(), 'in_progress')
  returning id into current_attempt_id;
  return current_attempt_id;
end;
$$;

create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_student_id uuid;
  current_attempt_id uuid;
  quiz_record public.quizzes%rowtype;
  question_record record;
  submitted_answer text;
  is_answer_correct boolean;
  awarded_marks numeric;
  final_score numeric := 0;
  final_total numeric := 0;
  correct_count integer := 0;
  wrong_count integer := 0;
  unanswered_count integer := 0;
  submitted_at_value timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before submitting a quiz.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'Answers must be submitted as a JSON array.' using errcode = '22023';
  end if;

  select student.id into authenticated_student_id
  from public.students student
  where student.user_id = (select auth.uid());
  if authenticated_student_id is null then
    raise exception 'No student profile is linked to this account.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(authenticated_student_id::text || p_quiz_id::text, 0));

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id
    and public.quiz_student_is_eligible(quiz.id);
  if not found then
    raise exception 'This published quiz is not available to your registered class.' using errcode = '42501';
  end if;

  select attempt.id into current_attempt_id
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = authenticated_student_id
    and attempt.status = 'in_progress'
  order by attempt.started_at desc
  limit 1
  for update;
  if current_attempt_id is null then
    raise exception 'There is no active attempt to submit, or this attempt was already submitted.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_answers) as submitted(question_id uuid, answer text)
    left join public.quiz_questions question
      on question.id = submitted.question_id
     and question.quiz_id = p_quiz_id
    where submitted.question_id is null or question.id is null
  ) then
    raise exception 'One or more submitted questions do not belong to this quiz.' using errcode = '22023';
  end if;
  if exists (
    select submitted.question_id
    from jsonb_to_recordset(p_answers) as submitted(question_id uuid, answer text)
    group by submitted.question_id
    having count(*) > 1
  ) then
    raise exception 'A question can only be answered once.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.quiz_questions question
    where question.quiz_id = p_quiz_id
      and question.question_type is distinct from 'mcq'
      and question.question_type is distinct from 'true_false'
  ) then
    raise exception 'This quiz contains unsupported question types and cannot be submitted.';
  end if;

  for question_record in
    select question.id, question.question_type, question.correct_answer,
           question.marks, submitted.answer
    from public.quiz_questions question
    left join jsonb_to_recordset(p_answers) as submitted(question_id uuid, answer text)
      on submitted.question_id = question.id
    where question.quiz_id = p_quiz_id
    order by question.question_number
  loop
    submitted_answer := case
      when nullif(btrim(question_record.answer), '') is null then null
      else question_record.answer
    end;
    is_answer_correct := false;
    awarded_marks := 0;
    final_total := final_total + question_record.marks;

    if submitted_answer is null then
      unanswered_count := unanswered_count + 1;
    else
      if question_record.question_type = 'mcq' then
        is_answer_correct := submitted_answer = (question_record.correct_answer #>> '{}');
      elsif question_record.question_type = 'true_false' then
        is_answer_correct :=
          lower(btrim(submitted_answer)) = lower(btrim(question_record.correct_answer #>> '{}'));
      end if;

      if is_answer_correct then
        awarded_marks := question_record.marks;
        correct_count := correct_count + 1;
        final_score := final_score + awarded_marks;
      else
        wrong_count := wrong_count + 1;
      end if;
    end if;

    insert into public.quiz_answers (
      attempt_id, question_id, student_answer, is_correct, marks_awarded, answered_at
    ) values (
      current_attempt_id,
      question_record.id,
      submitted_answer,
      is_answer_correct,
      awarded_marks,
      case when submitted_answer is null then null else submitted_at_value end
    )
    on conflict (attempt_id, question_id)
    do update set
      student_answer = excluded.student_answer,
      is_correct = excluded.is_correct,
      marks_awarded = excluded.marks_awarded,
      answered_at = excluded.answered_at,
      updated_at = submitted_at_value;
  end loop;

  update public.quiz_attempts
  set submitted_at = submitted_at_value,
      score = final_score,
      total_marks = final_total,
      percentage = case when final_total > 0 then round(final_score / final_total * 100, 2) else 0 end,
      correct_answers = correct_count,
      wrong_answers = wrong_count,
      unanswered = unanswered_count,
      status = 'submitted',
      updated_at = submitted_at_value
  where id = current_attempt_id
    and status = 'in_progress';

  if not found then
    raise exception 'This attempt was already submitted.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempt_id', current_attempt_id,
    'score', final_score,
    'total_marks', final_total,
    'percentage', case when final_total > 0 then round(final_score / final_total * 100, 2) else 0 end,
    'correct_answers', correct_count,
    'wrong_answers', wrong_count,
    'unanswered', unanswered_count,
    'status', 'submitted'
  );
end;
$$;

revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
revoke all on function public.submit_quiz_attempt(uuid, jsonb) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid, jsonb) to authenticated;

create or replace function public.set_quiz_result_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quiz_attempts_set_updated_at on public.quiz_attempts;
create trigger quiz_attempts_set_updated_at
  before update on public.quiz_attempts
  for each row execute function public.set_quiz_result_updated_at();
drop trigger if exists quiz_answers_set_updated_at on public.quiz_answers;
create trigger quiz_answers_set_updated_at
  before update on public.quiz_answers
  for each row execute function public.set_quiz_result_updated_at();

revoke all on function public.set_quiz_result_updated_at() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The supabase_realtime publication is required for live quiz and performance updates.';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quizzes') then
    alter publication supabase_realtime add table public.quizzes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quiz_attempts') then
    alter publication supabase_realtime add table public.quiz_attempts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quiz_answers') then
    alter publication supabase_realtime add table public.quiz_answers;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
