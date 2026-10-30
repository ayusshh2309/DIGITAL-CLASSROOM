begin;

lock table public.quiz_questions in share row exclusive mode;

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
    raise exception 'Required quiz and registration tables are missing; no quiz security changes were applied.';
  end if;

  if exists (
    select 1
    from public.quiz_questions
    where question_type is distinct from 'mcq'
      and question_type is distinct from 'true_false'
  ) then
    raise exception 'Unsupported quiz question types exist. Reconcile them before applying the MCQ/True-False-only migration.';
  end if;
end;
$$;

alter table public.quiz_questions
  drop constraint if exists quiz_questions_mcq_true_false_only_check;
alter table public.quiz_questions
  add constraint quiz_questions_mcq_true_false_only_check
  check (question_type in ('mcq', 'true_false'));

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

revoke all on function public.reject_unsupported_quiz_question_types()
  from public, anon, authenticated;

revoke all on function public.save_teacher_question_quiz(jsonb, jsonb)
  from public, anon;
grant execute on function public.save_teacher_question_quiz(jsonb, jsonb)
  to authenticated;

revoke all on public.quizzes, public.quiz_questions,
  public.quiz_attempts, public.quiz_answers
  from public, anon, authenticated;
grant select, insert, update, delete on public.quizzes,
  public.quiz_questions to authenticated;
grant select on public.quiz_attempts, public.quiz_answers to authenticated;

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
    join public.students student
      on student.user_id = (select auth.uid())
     and student.grade = quiz.grade
     and student.stream is not distinct from quiz.stream
    where quiz.id = requested_quiz_id
      and quiz.status = 'published'
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
  status text,
  created_at timestamptz
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
             and question.question_type in ('mcq', 'true_false')
         ),
         quiz.status,
         quiz.created_at
  from public.quizzes quiz
  join public.subjects subject on subject.id = quiz.subject_id
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
    and question.question_type in ('mcq', 'true_false')
    and public.quiz_student_is_eligible(p_quiz_id)
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
  attempt_record public.quiz_attempts%rowtype;
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
      and question.question_type in ('mcq', 'true_false')
  ) or exists (
    select 1 from public.quiz_questions question
    where question.quiz_id = p_quiz_id
      and question.question_type not in ('mcq', 'true_false')
  ) then
    raise exception 'This quiz has no supported questions or contains an unsupported question type.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(student_record_id::text || p_quiz_id::text, 0)
  );

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  if found then
    if attempt_record.status = 'in_progress' then
      return attempt_record.id;
    end if;
    raise exception 'This quiz attempt has already been used.' using errcode = '22023';
  end if;

  insert into public.quiz_attempts (quiz_id, student_id, started_at, status)
  values (p_quiz_id, student_record_id, now(), 'in_progress')
  returning id into new_attempt_id;
  return new_attempt_id;
end;
$$;

revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;

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
  student_record_id uuid;
  attempt_record_id uuid;
  question_record record;
  answer_text text;
  answer_correct boolean;
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

  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null then
    raise exception 'No student profile is linked to this account.' using errcode = '42501';
  end if;
  if not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This published quiz is not available to your registered class.' using errcode = '42501';
  end if;

  select attempt.id into attempt_record_id
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
    and attempt.status = 'in_progress'
  for update;
  if attempt_record_id is null then
    raise exception 'There is no active attempt to submit, or this attempt was already submitted.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_answers) as submitted(question_id uuid, answer text)
    left join public.quiz_questions question
      on question.id = submitted.question_id
     and question.quiz_id = p_quiz_id
     and question.question_type in ('mcq', 'true_false')
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
    select 1 from public.quiz_questions question
    where question.quiz_id = p_quiz_id
      and question.question_type not in ('mcq', 'true_false')
  ) then
    raise exception 'This quiz contains an unsupported question type.' using errcode = '22023';
  end if;

  for question_record in
    select question.id,
           question.question_type,
           question.correct_answer,
           question.marks,
           submitted.answer
    from public.quiz_questions question
    left join jsonb_to_recordset(p_answers) as submitted(question_id uuid, answer text)
      on submitted.question_id = question.id
    where question.quiz_id = p_quiz_id
    order by question.question_number
  loop
    answer_text := nullif(btrim(question_record.answer), '');
    answer_correct := false;
    awarded_marks := 0;
    final_total := final_total + question_record.marks;

    if answer_text is null then
      unanswered_count := unanswered_count + 1;
    else
      if question_record.question_type = 'mcq' then
        answer_correct := answer_text = question_record.correct_answer;
      else
        answer_correct := lower(answer_text) = lower(question_record.correct_answer);
      end if;

      if answer_correct then
        awarded_marks := question_record.marks;
        correct_count := correct_count + 1;
        final_score := final_score + awarded_marks;
      else
        wrong_count := wrong_count + 1;
      end if;
    end if;

    insert into public.quiz_answers (
      attempt_id, question_id, student_answer, is_correct, marks_awarded, answered_at
    )
    values (
      attempt_record_id,
      question_record.id,
      answer_text,
      answer_correct,
      awarded_marks,
      case when answer_text is null then null else submitted_at_value end
    )
    on conflict (attempt_id, question_id) do update
    set student_answer = excluded.student_answer,
        is_correct = excluded.is_correct,
        marks_awarded = excluded.marks_awarded,
        answered_at = excluded.answered_at,
        updated_at = submitted_at_value;
  end loop;

  update public.quiz_attempts
  set submitted_at = submitted_at_value,
      score = final_score,
      total_marks = final_total,
      percentage = case
        when final_total > 0 then round(final_score / final_total * 100, 2)
        else 0
      end,
      correct_answers = correct_count,
      wrong_answers = wrong_count,
      unanswered = unanswered_count,
      status = 'submitted',
      updated_at = submitted_at_value
  where id = attempt_record_id
    and status = 'in_progress';

  if not found then
    raise exception 'This attempt was already submitted.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'attempt_id', attempt_record_id,
    'score', final_score,
    'total_marks', final_total,
    'percentage', case
      when final_total > 0 then round(final_score / final_total * 100, 2)
      else 0
    end,
    'correct_answers', correct_count,
    'wrong_answers', wrong_count,
    'unanswered', unanswered_count,
    'status', 'submitted'
  );
end;
$$;

revoke all on function public.submit_quiz_attempt(uuid, jsonb) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid, jsonb) to authenticated;

drop policy if exists "Students can view own quiz answers" on public.quiz_answers;
revoke insert, update, delete on public.quiz_attempts, public.quiz_answers
  from public, anon, authenticated;
grant select on public.quiz_attempts, public.quiz_answers to authenticated;

notify pgrst, 'reload schema';
commit;
