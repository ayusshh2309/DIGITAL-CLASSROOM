begin;

alter function public.save_teacher_question_quiz(jsonb, jsonb)
  rename to save_teacher_question_quiz_insert_legacy;
alter function public.start_quiz_attempt(uuid)
  rename to start_quiz_attempt_before_global_deadline;
alter function public.submit_quiz_attempt(uuid, jsonb)
  rename to submit_quiz_attempt_before_global_deadline;
alter function public.get_student_quiz_questions(uuid)
  rename to get_student_quiz_questions_before_global_deadline;
alter function public.get_student_quiz_catalog()
  rename to get_student_quiz_catalog_before_global_deadline;

revoke all on function public.save_teacher_question_quiz_insert_legacy(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.start_quiz_attempt_before_global_deadline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_quiz_attempt_before_global_deadline(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_student_quiz_questions_before_global_deadline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_student_quiz_catalog_before_global_deadline()
  from public, anon, authenticated, service_role;

do $schedule_preflight$
begin
  if exists (
    select 1
    from public.quizzes
    where scheduled_date is null
      and scheduled_time is not null
  ) then
    raise exception
      'Quizzes with a scheduled time but no scheduled date must be reconciled before applying global quiz deadlines.';
  end if;
end
$schedule_preflight$;

-- Existing quiz RPCs treated a date-only schedule as midnight in Asia/Kolkata.
update public.quizzes
set scheduled_time = time '00:00'
where scheduled_date is not null
  and scheduled_time is null;

do $migration$
declare
  output_columns text;
  has_schedule_date boolean;
  has_schedule_time boolean;
  has_duration boolean;
begin
  select string_agg(
           format('%I %s', argument.name, format_type(argument.type_oid, null)),
           ', ' order by argument.ordinality
         ),
         bool_or(argument.name = 'scheduled_date'),
         bool_or(argument.name = 'scheduled_time'),
         bool_or(argument.name = 'duration_minutes')
  into output_columns, has_schedule_date, has_schedule_time, has_duration
  from pg_proc routine
  cross join lateral unnest(routine.proargnames)
    with ordinality as argument(name, ordinality)
  join lateral unnest(routine.proallargtypes)
    with ordinality as argument_type(type_oid, ordinality)
    on argument_type.ordinality = argument.ordinality
  where routine.oid =
    'public.get_student_quiz_catalog_before_global_deadline()'::regprocedure
    and routine.proargmodes[argument.ordinality] = 't';

  if output_columns is null
    or not coalesce(has_schedule_date, false)
    or not coalesce(has_schedule_time, false)
    or not coalesce(has_duration, false) then
    raise exception 'The existing quiz catalog return shape is not compatible with global deadlines.';
  end if;

  execute format($create_function$
    create function public.get_student_quiz_catalog()
    returns table (
      %s,
      scheduled_start_at timestamptz,
      global_deadline timestamptz,
      server_now timestamptz
    )
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $function$
    declare
      student_record_id uuid;
      server_now_value timestamptz := clock_timestamp();
    begin
      if auth.uid() is not null then
        select student.id into student_record_id
        from public.students student
        where student.user_id = (select auth.uid());

        if student_record_id is not null then
          update public.quiz_attempts attempt
          set status = 'abandoned'
          from public.quizzes quiz
          where quiz.id = attempt.quiz_id
            and attempt.student_id = student_record_id
            and attempt.status = 'in_progress'
            and quiz.scheduled_date is not null
            and server_now_value >=
              ((quiz.scheduled_date + coalesce(quiz.scheduled_time, time '00:00'))
                at time zone 'Asia/Kolkata')
              + make_interval(mins => quiz.duration_minutes);
        end if;
      end if;

      return query
      select catalog_row.*,
             case
               when catalog_row.scheduled_date is not null
               then (catalog_row.scheduled_date
                 + coalesce(catalog_row.scheduled_time, time '00:00'))
                 at time zone 'Asia/Kolkata'
             end,
             case
               when catalog_row.scheduled_date is not null
               then ((catalog_row.scheduled_date
                 + coalesce(catalog_row.scheduled_time, time '00:00'))
                 at time zone 'Asia/Kolkata')
                 + make_interval(mins => catalog_row.duration_minutes)
             end,
             server_now_value
      from public.get_student_quiz_catalog_before_global_deadline() catalog_row;
    end;
    $function$;
  $create_function$, output_columns);
end;
$migration$;

alter function public.get_student_quiz_catalog() owner to postgres;
revoke all on function public.get_student_quiz_catalog()
  from public, anon, authenticated, service_role;
grant execute on function public.get_student_quiz_catalog()
  to authenticated;

create function public.reject_quiz_schedule_change_after_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scheduled_date is null and new.scheduled_time is not null then
    raise exception 'A scheduled time requires a scheduled date.';
  end if;
  if new.status = 'published'
    and old.status is distinct from 'published'
    and (new.scheduled_date is null or new.scheduled_time is null) then
    raise exception 'Publishing a quiz requires a scheduled date and time.';
  end if;
  if (
    new.scheduled_date is distinct from old.scheduled_date
    or new.scheduled_time is distinct from old.scheduled_time
    or new.duration_minutes is distinct from old.duration_minutes
  ) and exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.quiz_id = old.id
  ) then
    raise exception 'Schedule and duration cannot be changed after a student starts this quiz.';
  end if;
  return new;
end;
$$;

alter function public.reject_quiz_schedule_change_after_attempt() owner to postgres;
revoke all on function public.reject_quiz_schedule_change_after_attempt()
  from public, anon, authenticated, service_role;

create trigger quizzes_freeze_schedule_after_attempt
before update of status, scheduled_date, scheduled_time, duration_minutes
on public.quizzes
for each row
execute function public.reject_quiz_schedule_change_after_attempt();

create function public.save_teacher_question_quiz(
  p_quiz jsonb,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  teacher_record_id uuid;
  quiz_id uuid;
  existing_quiz public.quizzes%rowtype;
  quiz_grade integer;
  quiz_stream text;
  quiz_subject_id public.subjects.id%type;
  subject_name text;
  quiz_title text;
  quiz_description text;
  quiz_instructions text;
  quiz_status text;
  quiz_duration integer;
  quiz_attempts integer;
  quiz_scheduled_date date;
  quiz_scheduled_time time without time zone;
  question_item jsonb;
  question_index integer := 0;
  question_kind text;
  question_text_value text;
  question_answer text;
  question_marks numeric;
  question_options jsonb;
  has_attempts boolean;
begin
  if authenticated_user_id is null then
    raise exception 'Sign in as a teacher before saving a quiz.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_quiz) is distinct from 'object'
    or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'A quiz and a question list are required.';
  end if;

  select teacher.id into teacher_record_id
  from public.teachers teacher
  where teacher.user_id = authenticated_user_id;
  if teacher_record_id is null then
    raise exception 'Teacher profile not found for the authenticated account.'
      using errcode = '42501';
  end if;

  quiz_title := nullif(btrim(p_quiz->>'title'), '');
  quiz_grade := nullif(p_quiz->>'grade', '')::integer;
  quiz_stream := nullif(btrim(p_quiz->>'stream'), '');
  quiz_subject_id := nullif(p_quiz->>'subject_id', '');
  quiz_description := nullif(btrim(p_quiz->>'description'), '');
  quiz_instructions := nullif(btrim(p_quiz->>'instructions'), '');
  quiz_status := coalesce(nullif(p_quiz->>'status', ''), 'published');
  quiz_duration := coalesce(nullif(p_quiz->>'duration_minutes', '')::integer, 30);
  quiz_attempts := coalesce(nullif(p_quiz->>'attempts_allowed', '')::integer, 1);
  quiz_scheduled_date := nullif(p_quiz->>'scheduled_date', '')::date;
  quiz_scheduled_time := nullif(p_quiz->>'scheduled_time', '')::time;

  if quiz_title is null or quiz_grade is null or quiz_subject_id is null then
    raise exception 'Quiz title, grade, and subject are required.';
  end if;
  if quiz_status not in ('draft', 'published') then
    raise exception 'Quiz status must be draft or published.';
  end if;
  if quiz_duration < 1 or quiz_attempts < 1 then
    raise exception 'Duration and attempts must be positive.';
  end if;
  if quiz_scheduled_date is null and quiz_scheduled_time is not null then
    raise exception 'A scheduled time requires a scheduled date.';
  end if;
  if quiz_status = 'published'
    and (quiz_scheduled_date is null or quiz_scheduled_time is null)
    and nullif(p_quiz->>'id', '') is null then
    raise exception 'A newly published quiz requires a scheduled date and time.';
  end if;
  if not exists (
    select 1
    from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = teacher_record_id
      and grade_group.grade = quiz_grade
      and grade_group.stream is not distinct from quiz_stream
  ) then
    raise exception 'The selected grade and stream are not registered to this teacher.';
  end if;
  if not exists (
    select 1
    from public.teacher_subject_assignments assignment
    where assignment.teacher_id = teacher_record_id
      and assignment.grade = quiz_grade
      and assignment.stream is not distinct from quiz_stream
      and assignment.subject_id::text = quiz_subject_id::text
  ) then
    raise exception 'The selected subject is not assigned to this grade and stream.';
  end if;
  select subject.name into subject_name
  from public.subjects subject
  where subject.id = quiz_subject_id;
  if subject_name is null then
    raise exception 'The selected subject no longer exists.';
  end if;

  if nullif(p_quiz->>'id', '') is null then
    if quiz_status = 'published'
      and coalesce(jsonb_array_length(p_questions), 0) = 0 then
      raise exception 'A published quiz must contain at least one complete question.';
    end if;
    return public.save_teacher_question_quiz_insert_legacy(p_quiz, p_questions);
  end if;

  quiz_id := (p_quiz->>'id')::uuid;
  select quiz.* into existing_quiz
  from public.quizzes quiz
  where quiz.id = quiz_id
    and quiz.teacher_id = teacher_record_id
  for update;
  if not found then
    raise exception 'Quiz not found or not owned by this teacher.' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.quiz_id = quiz_id
  ) into has_attempts;

  if existing_quiz.status = 'published'
    and quiz_status = 'published'
    and quiz_scheduled_date is not distinct from existing_quiz.scheduled_date
    and quiz_scheduled_time is not distinct from existing_quiz.scheduled_time then
    null;
  elsif quiz_status = 'published'
    and (quiz_scheduled_date is null or quiz_scheduled_time is null) then
    raise exception 'Publishing a quiz requires a scheduled date and time.';
  end if;

  if has_attempts and (
    quiz_scheduled_date is distinct from existing_quiz.scheduled_date
    or quiz_scheduled_time is distinct from existing_quiz.scheduled_time
    or quiz_duration is distinct from existing_quiz.duration_minutes
  ) then
    raise exception 'Schedule and duration cannot be changed after a student starts this quiz.';
  end if;
  if has_attempts and (
    quiz_grade is distinct from existing_quiz.grade
    or quiz_stream is distinct from existing_quiz.stream
    or quiz_subject_id is distinct from existing_quiz.subject_id
  ) then
    raise exception 'Quiz class and subject cannot be changed after a student starts this quiz.';
  end if;

  for question_item in
    select question_value
    from jsonb_array_elements(p_questions) as question_rows(question_value)
  loop
    question_index := question_index + 1;
    question_kind := question_item->>'question_type';
    question_text_value := nullif(btrim(question_item->>'question_text'), '');
    question_answer := nullif(btrim(question_item->>'correct_answer'), '');
    question_marks := nullif(question_item->>'marks', '')::numeric;
    question_options := question_item->'options';
    if question_kind is null
      or question_kind not in ('mcq', 'true_false')
      or question_text_value is null
      or question_answer is null
      or question_marks is null
      or question_marks <= 0 then
      raise exception 'Question % is missing text, a supported type, a correct answer, or positive marks.',
        question_index;
    end if;
    if question_kind = 'mcq' then
      if jsonb_typeof(question_options) is distinct from 'array'
        or jsonb_array_length(question_options) <> 4 then
        raise exception 'MCQ question % must have exactly four options.', question_index;
      end if;
      if exists (
        select 1
        from jsonb_array_elements(question_options) option_row(value)
        where nullif(btrim(option_row.value->>'text'), '') is null
      ) then
        raise exception 'MCQ question % has an empty option.', question_index;
      end if;
      if question_answer not in ('A', 'B', 'C', 'D')
        or not exists (
          select 1
          from jsonb_array_elements(question_options) option_row(value)
          where option_row.value->>'id' = question_answer
        ) then
        raise exception 'MCQ question % must identify one of its four options as correct.',
          question_index;
      end if;
    elsif question_options is not null and question_options <> 'null'::jsonb then
      raise exception 'Only MCQ questions may contain options.';
    end if;
    if question_kind = 'true_false' and question_answer not in ('true', 'false') then
      raise exception 'True/False question % must have true or false as its answer.',
        question_index;
    end if;
  end loop;

  if has_attempts then
    if jsonb_array_length(p_questions) <> (
      select count(*) from public.quiz_questions question
      where question.quiz_id = quiz_id
    ) then
      raise exception 'Questions cannot be changed after a student starts this quiz.';
    end if;
    for question_index in 1..jsonb_array_length(p_questions) loop
      question_item := p_questions->(question_index - 1);
      if not exists (
        select 1
        from public.quiz_questions question
        where question.quiz_id = quiz_id
          and question.question_number = question_index
          and question.question_type = question_item->>'question_type'
          and question.question_text = question_item->>'question_text'
          and question.options is not distinct from case
            when question_item->>'question_type' = 'mcq'
              then question_item->'options'
            else null
          end
          and question.correct_answer #>> '{}' = question_item->>'correct_answer'
          and question.marks = (question_item->>'marks')::numeric
          and question.explanation is not distinct from nullif(question_item->>'explanation', '')
      ) then
        raise exception 'Questions cannot be changed after a student starts this quiz.';
      end if;
    end loop;
  end if;

  update public.quizzes quiz
  set title = quiz_title,
      grade = quiz_grade,
      stream = quiz_stream,
      subject_id = quiz_subject_id,
      description = quiz_description,
      instructions = quiz_instructions,
      duration_minutes = quiz_duration,
      attempts_allowed = quiz_attempts,
      shuffle_questions = coalesce((p_quiz->>'shuffle_questions')::boolean, false),
      shuffle_options = coalesce((p_quiz->>'shuffle_options')::boolean, false),
      scheduled_date = quiz_scheduled_date,
      scheduled_time = quiz_scheduled_time,
      show_question_numbers = coalesce((p_quiz->>'show_question_numbers')::boolean, true),
      show_score = coalesce((p_quiz->>'show_score')::boolean, true),
      show_answers = coalesce((p_quiz->>'show_answers')::boolean, false),
      show_explanations = coalesce((p_quiz->>'show_explanations')::boolean, false),
      student_access = coalesce(nullif(p_quiz->>'student_access', ''), 'class'),
      builder_draft = case when quiz_status = 'draft' then p_quiz->'builder_draft' else null end,
      status = quiz_status,
      class_grade = 'Class ' || quiz_grade::text,
      subject = subject_name,
      topic = quiz_title,
      question_count = jsonb_array_length(p_questions),
      total_marks = coalesce((
        select sum((question_value->>'marks')::numeric)
        from jsonb_array_elements(p_questions) as question_rows(question_value)
      ), 0),
      published_at = case
        when quiz_status = 'published' then coalesce(quiz.published_at, clock_timestamp())
        else null
      end
  where quiz.id = quiz_id
    and quiz.teacher_id = teacher_record_id;

  if not has_attempts then
    delete from public.quiz_questions question
    where question.quiz_id = quiz_id;
    question_index := 0;
    for question_item in
      select question_value
      from jsonb_array_elements(p_questions) as question_rows(question_value)
    loop
      question_index := question_index + 1;
      question_kind := question_item->>'question_type';
      question_options := case when question_kind = 'mcq'
        then question_item->'options' else null end;
      question_text_value := btrim(question_item->>'question_text');
      question_marks := (question_item->>'marks')::numeric;
      question_answer := btrim(question_item->>'correct_answer');
      insert into public.quiz_questions (
        quiz_id, teacher_id, position, text, type, marks, options, correct_answer,
        question_number, question_type, question_text, explanation, updated_at
      ) values (
        quiz_id, authenticated_user_id, question_index, question_text_value,
        case question_kind
          when 'mcq' then 'Multiple Choice'
          when 'true_false' then 'True/False'
          else 'Multiple Choice'
        end,
        question_marks, question_options, to_jsonb(question_answer), question_index,
        question_kind, question_text_value,
        nullif(btrim(question_item->>'explanation'), ''), clock_timestamp()
      );
    end loop;
  end if;

  return quiz_id;
end;
$$;

alter function public.save_teacher_question_quiz(jsonb, jsonb) owner to postgres;
revoke all on function public.save_teacher_question_quiz(jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.save_teacher_question_quiz(jsonb, jsonb)
  to authenticated;

create function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_record_id uuid;
  quiz_record public.quizzes%rowtype;
  attempt_record public.quiz_attempts%rowtype;
  attempt_id uuid;
  current_time_value timestamptz;
  start_time_value timestamptz;
  deadline_value timestamptz;
  has_attempt boolean;
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
    raise exception 'This published quiz is not available to your registered class.'
      using errcode = '42501';
  end if;

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id
  for update;
  if quiz_record.id is null or not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This published quiz is not available to your registered class.'
      using errcode = '42501';
  end if;

  if quiz_record.scheduled_date is not null then
    start_time_value := (
      quiz_record.scheduled_date + coalesce(quiz_record.scheduled_time, time '00:00')
    )
      at time zone 'Asia/Kolkata';
    deadline_value := start_time_value + make_interval(mins => quiz_record.duration_minutes);
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  has_attempt := found;
  current_time_value := clock_timestamp();

  if has_attempt and attempt_record.status = 'abandoned' then
    raise exception 'This quiz attempt has expired and cannot be restarted.' using errcode = '22023';
  end if;
  if quiz_record.scheduled_date is not null then
    if current_time_value < start_time_value then
      raise exception 'This quiz is not available yet.' using errcode = '22023';
    end if;
    if current_time_value >= deadline_value then
      if has_attempt and attempt_record.status = 'in_progress' then
        update public.quiz_attempts
        set status = 'abandoned'
        where id = attempt_record.id
          and status = 'in_progress';
        return attempt_record.id;
      end if;
      raise exception 'The quiz deadline has passed.' using errcode = '22023';
    end if;
  end if;
  if has_attempt and attempt_record.status = 'submitted' then
    return public.start_quiz_attempt_before_global_deadline(p_quiz_id);
  end if;
  if has_attempt and attempt_record.status = 'in_progress' then
    return attempt_record.id;
  end if;

  return public.start_quiz_attempt_before_global_deadline(p_quiz_id);
end;
$$;

alter function public.start_quiz_attempt(uuid) owner to postgres;
revoke all on function public.start_quiz_attempt(uuid) from public, anon, service_role;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;

create function public.get_student_quiz_questions(p_quiz_id uuid)
returns table (
  id uuid,
  question_number integer,
  question_type text,
  question_text text,
  options jsonb,
  marks numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_record_id uuid;
  quiz_record public.quizzes%rowtype;
  attempt_record public.quiz_attempts%rowtype;
  start_time_value timestamptz;
  deadline_value timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before loading quiz questions.'
      using errcode = '42501';
  end if;
  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null then
    raise exception 'No student profile is linked to this account.'
      using errcode = '42501';
  end if;

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id
  for update;
  if not found then
    return;
  end if;
  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  if not found or attempt_record.status <> 'in_progress' then
    return;
  end if;

  if not public.quiz_student_is_eligible(p_quiz_id) then
    return;
  end if;

  if quiz_record.scheduled_date is not null then
    start_time_value := (
      quiz_record.scheduled_date + coalesce(quiz_record.scheduled_time, time '00:00')
    ) at time zone 'Asia/Kolkata';
    deadline_value :=
      start_time_value + make_interval(mins => quiz_record.duration_minutes);
    if clock_timestamp() < start_time_value then
      return;
    end if;
    if clock_timestamp() >= deadline_value then
      update public.quiz_attempts
      set status = 'abandoned'
      where id = attempt_record.id
        and status = 'in_progress';
      return;
    end if;
  end if;

  return query
  select question.*
  from public.get_student_quiz_questions_before_global_deadline(p_quiz_id) question;
end;
$$;

alter function public.get_student_quiz_questions(uuid) owner to postgres;
revoke all on function public.get_student_quiz_questions(uuid)
  from public, anon, service_role;
grant execute on function public.get_student_quiz_questions(uuid)
  to authenticated;

create function public.submit_quiz_attempt(
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
  attempt_record public.quiz_attempts%rowtype;
  quiz_record public.quizzes%rowtype;
  deadline_value timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a student before submitting a quiz.'
      using errcode = '42501';
  end if;
  select student.id into student_record_id
  from public.students student
  where student.user_id = (select auth.uid());
  if student_record_id is null then
    raise exception 'No student profile is linked to this account.'
      using errcode = '42501';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.quiz_id = p_quiz_id
    and attempt.student_id = student_record_id
  for update;
  if not found then
    return public.submit_quiz_attempt_before_global_deadline(p_quiz_id, p_answers);
  end if;
  if attempt_record.status = 'abandoned' then
    return jsonb_build_object(
      'attempt_id', attempt_record.id,
      'status', 'abandoned'
    );
  end if;

  select quiz.* into quiz_record
  from public.quizzes quiz
  where quiz.id = p_quiz_id;
  if not found then
    return public.submit_quiz_attempt_before_global_deadline(p_quiz_id, p_answers);
  end if;
  if quiz_record.scheduled_date is not null
    and attempt_record.status = 'in_progress' then
    deadline_value :=
      ((quiz_record.scheduled_date + coalesce(quiz_record.scheduled_time, time '00:00'))
        at time zone 'Asia/Kolkata')
      + make_interval(mins => quiz_record.duration_minutes);
    if clock_timestamp() >= deadline_value then
      update public.quiz_attempts
      set status = 'abandoned'
      where id = attempt_record.id
        and status = 'in_progress';
      return jsonb_build_object(
        'attempt_id', attempt_record.id,
        'status', 'abandoned'
      );
    end if;
  end if;

  if attempt_record.status = 'in_progress'
    and not public.quiz_student_is_eligible(p_quiz_id) then
    raise exception 'This published quiz is not available to your registered class.'
      using errcode = '42501';
  end if;

  return public.submit_quiz_attempt_before_global_deadline(p_quiz_id, p_answers);
end;
$$;

alter function public.submit_quiz_attempt(uuid, jsonb) owner to postgres;
revoke all on function public.submit_quiz_attempt(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.submit_quiz_attempt(uuid, jsonb)
  to authenticated;

commit;
