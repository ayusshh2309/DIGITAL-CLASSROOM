begin;

do $$
begin
  if to_regclass('public.quizzes') is null
    or to_regclass('public.quiz_questions') is null
    or to_regclass('public.quiz_attempts') is null
    or to_regclass('public.quiz_answers') is null
    or to_regclass('public.students') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.teachers') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null then
    raise exception 'Required quiz and registration tables are missing; no workflow changes were applied.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name = 'grades'
      and udt_name = '_int4'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subjects'
      and column_name = 'streams'
      and udt_name = '_text'
  ) then
    raise exception 'Expected public.subjects.grades integer[] and streams text[]; apply the existing curriculum migration first.';
  end if;
end;
$$;

alter table public.quizzes
  add column if not exists results_released boolean not null default false;
alter table public.quiz_answers
  add column if not exists graded_at timestamptz;

alter table public.quiz_questions
  drop constraint if exists quiz_questions_mcq_true_false_only_check;
drop trigger if exists quiz_questions_supported_type_guard on public.quiz_questions;
drop function if exists public.reject_unsupported_quiz_question_types();

create or replace function public.reset_quiz_results_on_question_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.quizzes
  set results_released = false
  where id = case when tg_op = 'DELETE' then old.quiz_id else new.quiz_id end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quiz_questions_reset_results_release on public.quiz_questions;
create trigger quiz_questions_reset_results_release
  after insert or update or delete on public.quiz_questions
  for each row execute function public.reset_quiz_results_on_question_change();

create or replace function public.reset_quiz_results_on_quiz_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.title is distinct from new.title
    or old.grade is distinct from new.grade
    or old.stream is distinct from new.stream
    or old.subject_id is distinct from new.subject_id
    or old.duration_minutes is distinct from new.duration_minutes
    or old.total_marks is distinct from new.total_marks
    or old.status is distinct from new.status then
    new.results_released := false;
  end if;
  return new;
end;
$$;

drop trigger if exists quizzes_reset_results_release on public.quizzes;
create trigger quizzes_reset_results_release
  before update of title, grade, stream, subject_id, duration_minutes, total_marks, status
  on public.quizzes
  for each row execute function public.reset_quiz_results_on_quiz_change();

revoke all on function public.reset_quiz_results_on_question_change()
  from public, anon, authenticated;
revoke all on function public.reset_quiz_results_on_quiz_change()
  from public, anon, authenticated;

revoke all on function public.save_teacher_question_quiz(jsonb, jsonb)
  from public, anon;
grant execute on function public.save_teacher_question_quiz(jsonb, jsonb)
  to authenticated;

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;

revoke all on public.quizzes, public.quiz_questions,
  public.quiz_attempts, public.quiz_answers
  from public, anon;
grant select, insert, update, delete on public.quizzes, public.quiz_questions
  to authenticated;
grant select on public.quiz_attempts, public.quiz_answers to authenticated;
revoke insert, update, delete on public.quiz_attempts, public.quiz_answers
  from public, anon, authenticated;

create or replace function public.quiz_student_is_eligible(requested_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quizzes quiz
    join public.subjects subject on subject.id = quiz.subject_id
    join public.students student
      on student.user_id = (select auth.uid())
     and student.grade = quiz.grade
     and student.stream is not distinct from quiz.stream
    where quiz.id = requested_quiz_id
      and quiz.status = 'published'
      and coalesce(subject.grades, '{}'::integer[]) @> array[quiz.grade]
      and (
        quiz.grade between 5 and 10
        or exists (
          select 1
          from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
          where lower(btrim(allowed_stream.stream)) = lower(btrim(quiz.stream))
        )
      )
      and exists (
        select 1
        from public.teacher_grade_groups grade_group
        where grade_group.teacher_id = quiz.teacher_id
          and grade_group.grade = quiz.grade
          and grade_group.stream is not distinct from quiz.stream
          and (
            grade_group.teach_all_subjects = true
            or exists (
              select 1
              from public.teacher_subject_assignments assignment
              where assignment.teacher_id = grade_group.teacher_id
                and assignment.grade = grade_group.grade
                and assignment.stream is not distinct from grade_group.stream
                and assignment.subject_id = quiz.subject_id
            )
          )
      )
  );
$$;

revoke all on function public.quiz_student_is_eligible(uuid) from public, anon;
grant execute on function public.quiz_student_is_eligible(uuid) to authenticated;

drop policy if exists quizzes_student_read_published_assigned on public.quizzes;
create policy quizzes_student_read_published_assigned
  on public.quizzes for select to authenticated
  using (public.quiz_student_is_eligible(id));

drop policy if exists quizzes_select_scope_guard on public.quizzes;
create policy quizzes_select_scope_guard on public.quizzes
  as restrictive for select to authenticated
  using (
    public.quiz_student_is_eligible(id)
    or exists (
      select 1
      from public.teachers teacher
      where teacher.id = quizzes.teacher_id
        and teacher.user_id = (select auth.uid())
    )
  );

drop policy if exists quiz_questions_teacher_only_guard
  on public.quiz_questions;
create policy quiz_questions_teacher_only_guard
  on public.quiz_questions as restrictive for select to authenticated
  using (exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = quiz_questions.quiz_id
      and teacher.user_id = (select auth.uid())
  ));

drop policy if exists "Students can view own quiz attempts" on public.quiz_attempts;
drop policy if exists quiz_attempts_read_own_or_owned_quiz on public.quiz_attempts;
drop policy if exists "Students can view own quiz answers" on public.quiz_answers;
drop policy if exists quiz_answers_read_own_or_owned_quiz on public.quiz_answers;

drop policy if exists quiz_attempts_teacher_read_owned_quiz on public.quiz_attempts;
create policy quiz_attempts_teacher_read_owned_quiz
  on public.quiz_attempts for select to authenticated
  using (exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = quiz_attempts.quiz_id
      and teacher.user_id = (select auth.uid())
  ));

drop policy if exists quiz_answers_teacher_read_owned_quiz on public.quiz_answers;
create policy quiz_answers_teacher_read_owned_quiz
  on public.quiz_answers for select to authenticated
  using (exists (
    select 1
    from public.quiz_attempts attempt
    join public.quizzes quiz on quiz.id = attempt.quiz_id
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where attempt.id = quiz_answers.attempt_id
      and teacher.user_id = (select auth.uid())
  ));

drop policy if exists quiz_attempts_scope_guard on public.quiz_attempts;
create policy quiz_attempts_scope_guard on public.quiz_attempts
  as restrictive for all to authenticated
  using (exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = quiz_attempts.quiz_id
      and teacher.user_id = (select auth.uid())
  ))
  with check (false);

drop policy if exists quiz_answers_scope_guard on public.quiz_answers;
create policy quiz_answers_scope_guard on public.quiz_answers
  as restrictive for all to authenticated
  using (exists (
    select 1
    from public.quiz_attempts attempt
    join public.quizzes quiz on quiz.id = attempt.quiz_id
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where attempt.id = quiz_answers.attempt_id
      and teacher.user_id = (select auth.uid())
  ))
  with check (false);

drop function if exists public.get_student_quiz_catalog();
create function public.get_student_quiz_catalog()
returns table (
  id uuid,
  title text,
  grade integer,
  stream text,
  subject_id bigint,
  subject_name text,
  description text,
  instructions text,
  duration_minutes integer,
  total_marks integer,
  question_count bigint,
  quiz_status text,
  created_at timestamptz,
  attempt_id uuid,
  attempt_status text,
  started_at timestamptz,
  submitted_at timestamptz,
  result_released boolean,
  score numeric,
  result_total_marks numeric,
  percentage numeric,
  correct_answers integer,
  wrong_answers integer,
  unanswered integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select quiz.id,
         quiz.title,
         quiz.grade,
         quiz.stream,
         quiz.subject_id,
         subject.name,
         quiz.description,
         quiz.instructions,
         quiz.duration_minutes,
         quiz.total_marks,
         (
           select count(*)
           from public.quiz_questions question
           where question.quiz_id = quiz.id
         ),
         quiz.status,
         quiz.created_at,
         attempt.id,
         attempt.status,
         attempt.started_at,
         attempt.submitted_at,
         quiz.results_released and attempt.status = 'submitted',
         case when quiz.results_released and attempt.status = 'submitted' then attempt.score end,
         case when quiz.results_released and attempt.status = 'submitted' then attempt.total_marks end,
         case when quiz.results_released and attempt.status = 'submitted' then attempt.percentage end,
         case when quiz.results_released and attempt.status = 'submitted' then attempt.correct_answers end,
         case when quiz.results_released and attempt.status = 'submitted' then attempt.wrong_answers end,
         case when quiz.results_released and attempt.status = 'submitted' then attempt.unanswered end
  from public.quizzes quiz
  join public.subjects subject on subject.id = quiz.subject_id
  join public.students student
    on student.user_id = (select auth.uid())
   and student.grade = quiz.grade
   and student.stream is not distinct from quiz.stream
  left join public.quiz_attempts attempt
    on attempt.quiz_id = quiz.id
   and attempt.student_id = student.id
  where public.quiz_student_is_eligible(quiz.id)
  order by quiz.created_at desc, quiz.id;
$$;

revoke all on function public.get_student_quiz_catalog() from public, anon;
grant execute on function public.get_student_quiz_catalog() to authenticated;

drop function if exists public.get_student_quiz_questions(uuid);
create function public.get_student_quiz_questions(p_quiz_id uuid)
returns table (
  id uuid,
  question_number integer,
  question_type text,
  question_text text,
  options jsonb,
  marks integer
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
  where question.quiz_id = p_quiz_id
    and question.question_type in ('mcq', 'true_false', 'short_answer')
    and public.quiz_student_is_eligible(p_quiz_id)
    and exists (
      select 1
      from public.quiz_attempts attempt
      join public.students student on student.id = attempt.student_id
      where attempt.quiz_id = p_quiz_id
        and attempt.status = 'in_progress'
        and student.user_id = (select auth.uid())
    )
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
  student_record_id uuid;
  current_attempt public.quiz_attempts%rowtype;
  new_attempt_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before starting a quiz.' using errcode = '42501';
  end if;

  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null then
    raise exception 'No student profile is linked to this account.' using errcode = '42501';
  end if;
  if not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This published quiz is not available to your registered class.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.quiz_questions question
    where question.quiz_id = p_quiz_id
  ) then
    raise exception 'This quiz has no questions.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(student_record_id::text || p_quiz_id::text, 0)
  );

  select attempt.* into current_attempt
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  if found then
    if current_attempt.status = 'in_progress' then
      return current_attempt.id;
    end if;
    raise exception 'This quiz attempt has already been used.' using errcode = '22023';
  end if;

  insert into public.quiz_attempts (quiz_id, student_id, started_at, status)
  values (p_quiz_id, student_record_id, clock_timestamp(), 'in_progress')
  returning id into new_attempt_id;
  return new_attempt_id;
exception
  when unique_violation then
    select attempt.id into new_attempt_id
    from public.quiz_attempts attempt
    where attempt.quiz_id = p_quiz_id
      and attempt.student_id = student_record_id
      and attempt.status = 'in_progress';
    if new_attempt_id is not null then
      return new_attempt_id;
    end if;
    raise;
end;
$$;

revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;

drop function if exists public.get_student_quiz_attempt(uuid);
create function public.get_student_quiz_attempt(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  student_record_id uuid;
  attempt_record public.quiz_attempts%rowtype;
  saved_answers jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student to resume a quiz.' using errcode = '42501';
  end if;
  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null or not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This quiz is not available to your registered class.' using errcode = '42501';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
    and attempt.status = 'in_progress';
  if not found then
    raise exception 'No in-progress attempt exists for this quiz.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', answer.question_id,
        'student_answer', answer.student_answer
      )
    ),
    '[]'::jsonb
  )
  into saved_answers
  from public.quiz_answers answer
  where answer.attempt_id = attempt_record.id;

  return jsonb_build_object(
    'attempt_id', attempt_record.id,
    'started_at', attempt_record.started_at,
    'status', attempt_record.status,
    'answers', saved_answers
  );
end;
$$;

revoke all on function public.get_student_quiz_attempt(uuid) from public, anon;
grant execute on function public.get_student_quiz_attempt(uuid) to authenticated;

create or replace function public.save_student_quiz_answer(
  p_quiz_id uuid,
  p_question_id uuid,
  p_answer text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_record_id uuid;
  attempt_record public.quiz_attempts%rowtype;
  question_record public.quiz_questions%rowtype;
  quiz_duration integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student to save quiz answers.' using errcode = '42501';
  end if;
  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null or not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This quiz is not available to your registered class.' using errcode = '42501';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
    and attempt.status = 'in_progress'
  for update;
  if not found then
    raise exception 'There is no active attempt to save.' using errcode = '22023';
  end if;

  select quiz.duration_minutes into quiz_duration
  from public.quizzes quiz
  where quiz.id = p_quiz_id;
  if clock_timestamp() >= attempt_record.started_at + make_interval(mins => quiz_duration) then
    raise exception 'The quiz time has expired; saved answers can no longer be changed.' using errcode = '22023';
  end if;

  select question.* into question_record
  from public.quiz_questions question
  where question.id = p_question_id
    and question.quiz_id = p_quiz_id;
  if not found then
    raise exception 'This question does not belong to the active quiz.' using errcode = '22023';
  end if;
  if p_answer is not null and length(p_answer) > 10000 then
    raise exception 'The answer is too long.' using errcode = '22023';
  end if;

  if p_answer is not null and question_record.question_type = 'mcq'
    and (
      jsonb_typeof(question_record.options) is distinct from 'array'
      or not exists (
      select 1
      from jsonb_array_elements(question_record.options) option_record(value)
      where option_record.value->>'id' = p_answer
      )
    ) then
    raise exception 'Choose one of the available options.' using errcode = '22023';
  end if;
  if p_answer is not null and question_record.question_type = 'true_false'
    and lower(p_answer) not in ('true', 'false') then
    raise exception 'Choose True or False.' using errcode = '22023';
  end if;
  if question_record.question_type not in ('mcq', 'true_false', 'short_answer') then
    raise exception 'This question type is not supported.' using errcode = '22023';
  end if;

  insert into public.quiz_answers (
    attempt_id, question_id, student_answer, is_correct, marks_awarded, answered_at, graded_at
  )
  values (
    attempt_record.id,
    p_question_id,
    nullif(btrim(p_answer), ''),
    false,
    0,
    case when nullif(btrim(p_answer), '') is null then null else clock_timestamp() end,
    null
  )
  on conflict (attempt_id, question_id) do update
  set student_answer = excluded.student_answer,
      is_correct = false,
      marks_awarded = 0,
      answered_at = excluded.answered_at,
      graded_at = null,
      updated_at = clock_timestamp();
end;
$$;

revoke all on function public.save_student_quiz_answer(uuid, uuid, text) from public, anon;
grant execute on function public.save_student_quiz_answer(uuid, uuid, text) to authenticated;

drop function if exists public.submit_quiz_attempt(uuid, jsonb);
drop function if exists public.submit_quiz_attempt(uuid);
create function public.submit_quiz_attempt(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_record_id uuid;
  attempt_record public.quiz_attempts%rowtype;
  question_record record;
  answer_text text;
  answer_correct boolean;
  awarded_marks numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before submitting a quiz.' using errcode = '42501';
  end if;
  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null or not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This quiz is not available to your registered class.' using errcode = '42501';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  if not found then
    raise exception 'No attempt exists for this quiz.' using errcode = '22023';
  end if;
  if attempt_record.status = 'submitted' then
    return jsonb_build_object(
      'attempt_id', attempt_record.id,
      'status', 'submitted',
      'submitted_at', attempt_record.submitted_at
    );
  end if;
  if attempt_record.status <> 'in_progress' then
    raise exception 'This attempt cannot be submitted.' using errcode = '22023';
  end if;

  for question_record in
    select question.id, question.question_type, question.correct_answer, question.marks,
           answer.student_answer
    from public.quiz_questions question
    left join public.quiz_answers answer
      on answer.attempt_id = attempt_record.id
     and answer.question_id = question.id
    where question.quiz_id = p_quiz_id
    order by question.question_number
  loop
    answer_text := nullif(btrim(question_record.student_answer), '');
    answer_correct := false;
    awarded_marks := 0;
    if answer_text is not null and question_record.question_type = 'mcq' then
      answer_correct := answer_text = question_record.correct_answer;
    elsif answer_text is not null and question_record.question_type = 'true_false' then
      answer_correct := lower(answer_text) = lower(question_record.correct_answer);
    end if;
    if answer_correct then
      awarded_marks := question_record.marks;
    end if;

    insert into public.quiz_answers (
      attempt_id, question_id, student_answer, is_correct, marks_awarded, answered_at, graded_at
    )
    values (
      attempt_record.id,
      question_record.id,
      answer_text,
      answer_correct,
      awarded_marks,
      case when answer_text is null then null else coalesce(attempt_record.started_at, now()) end,
      case when question_record.question_type = 'short_answer' then null else clock_timestamp() end
    )
    on conflict (attempt_id, question_id) do update
    set is_correct = excluded.is_correct,
        marks_awarded = excluded.marks_awarded,
        graded_at = case
          when question_record.question_type = 'short_answer'
            and excluded.student_answer is not null then null
          else excluded.graded_at
        end,
        updated_at = clock_timestamp();
  end loop;

  update public.quiz_attempts
  set submitted_at = clock_timestamp(),
      score = 0,
      total_marks = 0,
      percentage = 0,
      correct_answers = 0,
      wrong_answers = 0,
      unanswered = 0,
      status = 'submitted',
      updated_at = clock_timestamp()
  where id = attempt_record.id
    and status = 'in_progress';
  if not found then
    raise exception 'This attempt was already submitted.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempt_id', attempt_record.id,
    'status', 'submitted',
    'submitted_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.submit_quiz_attempt(uuid) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;

create or replace function public.get_teacher_quiz_review(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  quiz_record public.quizzes%rowtype;
  review_record jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = p_quiz_id
      and teacher.user_id = (select auth.uid())
  ) then
    raise exception 'You are not authorized to review this quiz.' using errcode = '42501';
  end if;

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id;

  select jsonb_build_object(
    'quiz_id', quiz_record.id,
    'title', quiz_record.title,
    'results_released', quiz_record.results_released,
    'attempts', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'attempt_id', attempt.id,
          'student_name', student.full_name,
          'student_id', student.student_id,
          'status', attempt.status,
          'submitted_at', attempt.submitted_at,
          'score', attempt.score,
          'total_marks', attempt.total_marks,
          'answers', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'question_id', answer.question_id,
                'question_type', question.question_type,
                'question_text', question.question_text,
                'student_answer', answer.student_answer,
                'correct_answer', question.correct_answer,
                'marks', question.marks,
                'marks_awarded', answer.marks_awarded,
                'is_correct', answer.is_correct,
                'graded_at', answer.graded_at
              )
              order by question.question_number
            )
            from public.quiz_answers answer
            join public.quiz_questions question on question.id = answer.question_id
            where answer.attempt_id = attempt.id
          ), '[]'::jsonb)
        )
        order by attempt.submitted_at desc
      ) filter (where attempt.id is not null),
      '[]'::jsonb
    )
  )
  into review_record
  from public.quiz_attempts attempt
  join public.students student on student.id = attempt.student_id
  where attempt.quiz_id = p_quiz_id;

  return coalesce(review_record, jsonb_build_object(
    'quiz_id', quiz_record.id,
    'title', quiz_record.title,
    'results_released', quiz_record.results_released,
    'attempts', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_teacher_quiz_review(uuid) from public, anon;
grant execute on function public.get_teacher_quiz_review(uuid) to authenticated;

create or replace function public.grade_quiz_short_answer(
  p_attempt_id uuid,
  p_question_id uuid,
  p_marks_awarded numeric,
  p_is_correct boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_max_marks integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.quiz_attempts attempt
    join public.quizzes quiz on quiz.id = attempt.quiz_id
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where attempt.id = p_attempt_id
      and teacher.user_id = (select auth.uid())
      and attempt.status = 'submitted'
  ) then
    raise exception 'You are not authorized to grade this attempt.' using errcode = '42501';
  end if;

  select question.marks into question_max_marks
  from public.quiz_questions question
  join public.quiz_attempts attempt on attempt.quiz_id = question.quiz_id
  where attempt.id = p_attempt_id
    and question.id = p_question_id
    and question.question_type = 'short_answer';
  if question_max_marks is null then
    raise exception 'The selected response is not a short-answer question.' using errcode = '22023';
  end if;
  if p_marks_awarded < 0 or p_marks_awarded > question_max_marks then
    raise exception 'Awarded marks must be between zero and the question maximum.' using errcode = '22023';
  end if;

  update public.quiz_answers
  set marks_awarded = p_marks_awarded,
      is_correct = p_is_correct,
      graded_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where attempt_id = p_attempt_id
    and question_id = p_question_id
    and student_answer is not null;
  if not found then
    raise exception 'No submitted short answer exists for grading.' using errcode = '22023';
  end if;

  update public.quizzes quiz
  set results_released = false
  from public.quiz_attempts attempt
  where attempt.id = p_attempt_id
    and quiz.id = attempt.quiz_id;
end;
$$;

revoke all on function public.grade_quiz_short_answer(uuid, uuid, numeric, boolean)
  from public, anon;
grant execute on function public.grade_quiz_short_answer(uuid, uuid, numeric, boolean)
  to authenticated;

create or replace function public.release_quiz_results(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.quizzes quiz
    join public.teachers teacher on teacher.id = quiz.teacher_id
    where quiz.id = p_quiz_id
      and teacher.user_id = (select auth.uid())
  ) then
    raise exception 'You are not authorized to release results for this quiz.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.quiz_attempts attempt
    join public.quiz_answers answer on answer.attempt_id = attempt.id
    join public.quiz_questions question on question.id = answer.question_id
    where attempt.quiz_id = p_quiz_id
      and attempt.status = 'submitted'
      and question.question_type = 'short_answer'
      and answer.student_answer is not null
      and answer.graded_at is null
  ) then
    raise exception 'Grade all submitted short answers before releasing quiz results.' using errcode = '22023';
  end if;

  update public.quiz_attempts attempt
  set score = totals.score,
      total_marks = totals.total_marks,
      percentage = case
        when totals.total_marks > 0 then round(totals.score / totals.total_marks * 100, 2)
        else 0
      end,
      correct_answers = totals.correct_count,
      wrong_answers = totals.wrong_count,
      unanswered = totals.unanswered_count,
      updated_at = clock_timestamp()
  from (
    select attempt_record.id as attempt_id,
           coalesce(sum(answer.marks_awarded), 0)::numeric as score,
           coalesce(sum(question.marks), 0)::numeric as total_marks,
           count(*) filter (where answer.is_correct)::integer as correct_count,
           count(*) filter (
             where answer.student_answer is not null and not answer.is_correct
           )::integer as wrong_count,
           count(*) filter (where answer.student_answer is null)::integer as unanswered_count
    from public.quiz_attempts attempt_record
    join public.quiz_questions question on question.quiz_id = attempt_record.quiz_id
    left join public.quiz_answers answer
      on answer.attempt_id = attempt_record.id
     and answer.question_id = question.id
    where attempt_record.quiz_id = p_quiz_id
      and attempt_record.status = 'submitted'
    group by attempt_record.id
  ) totals
  where attempt.id = totals.attempt_id;

  update public.quizzes
  set results_released = true,
      updated_at = clock_timestamp()
  where id = p_quiz_id;
end;
$$;

revoke all on function public.release_quiz_results(uuid) from public, anon;
grant execute on function public.release_quiz_results(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
