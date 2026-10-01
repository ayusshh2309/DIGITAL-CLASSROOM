begin;

do $$
begin
  if to_regclass('public.quizzes') is null
    or to_regclass('public.quiz_questions') is null
    or to_regclass('public.teachers') is null
    or to_regclass('public.teacher_grade_groups') is null
    or to_regclass('public.teacher_subject_assignments') is null
    or to_regclass('public.subjects') is null
    or to_regclass('public.student_profiles') is null then
    raise exception 'Run the existing quiz, teacher registration, subject, and student profile migrations before this question-quiz migration.';
  end if;
end;
$$;

alter table public.quizzes
  add column if not exists grade integer,
  add column if not exists stream text,
  add column if not exists question_count integer not null default 0,
  add column if not exists total_marks numeric not null default 0,
  add column if not exists published_at timestamptz;

alter table public.quizzes
  alter column class_grade drop not null,
  alter column subject drop not null,
  alter column topic drop not null;

do $$
declare
  subjects_id_type oid;
  quiz_subject_id_type oid;
begin
  select atttypid into subjects_id_type
  from pg_attribute
  where attrelid = 'public.subjects'::regclass and attname = 'id' and not attisdropped;
  if subjects_id_type is null then
    raise exception 'public.subjects.id is required';
  end if;

  select atttypid into quiz_subject_id_type
  from pg_attribute
  where attrelid = 'public.quizzes'::regclass and attname = 'subject_id' and not attisdropped;
  if quiz_subject_id_type is null then
    execute format('alter table public.quizzes add column subject_id %s', format_type(subjects_id_type, null));
  elsif quiz_subject_id_type <> subjects_id_type then
    raise exception 'public.quizzes.subject_id must match public.subjects.id';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quizzes'::regclass
      and confrelid = 'public.subjects'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quizzes'::regclass and attname = 'subject_id')]::smallint[]
  ) then
    alter table public.quizzes
      add constraint quizzes_subject_id_fkey
      foreign key (subject_id) references public.subjects(id) on delete restrict;
  end if;
end;
$$;

create index if not exists quizzes_teacher_grade_stream_subject_idx
  on public.quizzes (teacher_id, grade, stream, subject_id, created_at desc);

alter table public.quiz_questions
  add column if not exists question_number integer,
  add column if not exists question_type text,
  add column if not exists question_text text;

alter table public.quiz_questions alter column options drop not null;

update public.quiz_questions
set question_number = coalesce(question_number, position),
    question_type = coalesce(question_type, case type
      when 'Multiple Choice' then 'mcq'
      when 'True/False' then 'true_false'
      when 'Short Answer' then 'short_answer'
      else 'short_answer'
    end),
    question_text = coalesce(question_text, text)
where question_number is null or question_type is null or question_text is null;

alter table public.quiz_questions
  alter column question_number set not null,
  alter column question_type set not null,
  alter column question_text set not null;

alter table public.quiz_questions drop constraint if exists quiz_questions_question_type_check;
alter table public.quiz_questions
  add constraint quiz_questions_question_type_check
  check (question_type in ('mcq', 'true_false', 'short_answer'));

create index if not exists quiz_questions_quiz_question_number_idx
  on public.quiz_questions (quiz_id, question_number);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quiz_questions'::regclass
      and confrelid = 'public.quizzes'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.quiz_questions'::regclass and attname = 'quiz_id')]::smallint[]
  ) then
    alter table public.quiz_questions
      add constraint quiz_questions_quiz_id_fkey
      foreign key (quiz_id) references public.quizzes(id) on delete cascade;
  end if;
end;
$$;

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;

drop policy if exists "Teachers manage their quizzes" on public.quizzes;
drop policy if exists quizzes_teacher_select_own on public.quizzes;
drop policy if exists quizzes_teacher_insert_assigned on public.quizzes;
drop policy if exists quizzes_teacher_update_assigned on public.quizzes;
drop policy if exists quizzes_teacher_delete_own on public.quizzes;
drop policy if exists quizzes_teacher_guard on public.quizzes;
drop policy if exists quizzes_student_read_published_assigned on public.quizzes;
drop policy if exists quizzes_quiz_access_guard on public.quizzes;

create policy quizzes_teacher_select_own on public.quizzes
for select to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
));

create policy quizzes_teacher_insert_assigned on public.quizzes
for insert to authenticated
with check (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
) and exists (
  select 1 from public.teacher_grade_groups grade_group
  where grade_group.teacher_id = quizzes.teacher_id
    and grade_group.grade = quizzes.grade
    and grade_group.stream is not distinct from quizzes.stream
) and exists (
  select 1 from public.teacher_subject_assignments assignment
  where assignment.teacher_id = quizzes.teacher_id
    and assignment.grade = quizzes.grade
    and assignment.stream is not distinct from quizzes.stream
    and assignment.subject_id = quizzes.subject_id
));

create policy quizzes_teacher_update_own on public.quizzes
for update to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
  ) and exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = quizzes.teacher_id
      and grade_group.grade = quizzes.grade
      and grade_group.stream is not distinct from quizzes.stream
  ) and exists (
    select 1 from public.teacher_subject_assignments assignment
    where assignment.teacher_id = quizzes.teacher_id
      and assignment.grade = quizzes.grade
      and assignment.stream is not distinct from quizzes.stream
      and assignment.subject_id = quizzes.subject_id
  )
));

create policy quizzes_teacher_delete_own on public.quizzes
for delete to authenticated
using (exists (
  select 1 from public.teachers teacher
  where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
));

create policy quizzes_student_read_published_assigned on public.quizzes
for select to authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.student_profiles student
    join public.subjects subject_record on subject_record.id = quizzes.subject_id
    where student.student_id = (select auth.uid())
      and nullif(regexp_replace(student.grade, '[^0-9]', '', 'g'), '')::integer = quizzes.grade
      and student.stream is not distinct from quizzes.stream
      and subject_record.name = any(student.eligible_subjects)
  )
);

create policy quizzes_quiz_access_guard on public.quizzes
as restrictive for all to authenticated
using (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
  ) or (
    quizzes.status = 'published'
    and exists (
      select 1
      from public.student_profiles student
      join public.subjects subject_record on subject_record.id = quizzes.subject_id
      where student.student_id = (select auth.uid())
        and nullif(regexp_replace(student.grade, '[^0-9]', '', 'g'), '')::integer = quizzes.grade
        and student.stream is not distinct from quizzes.stream
        and subject_record.name = any(student.eligible_subjects)
    )
  )
)
with check (
  exists (
    select 1 from public.teachers teacher
    where teacher.id = quizzes.teacher_id and teacher.user_id = (select auth.uid())
  ) and exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = quizzes.teacher_id
      and grade_group.grade = quizzes.grade
      and grade_group.stream is not distinct from quizzes.stream
  ) and exists (
    select 1 from public.teacher_subject_assignments assignment
    where assignment.teacher_id = quizzes.teacher_id
      and assignment.grade = quizzes.grade
      and assignment.stream is not distinct from quizzes.stream
      and assignment.subject_id = quizzes.subject_id
  )
);

drop policy if exists "Teachers manage their quiz questions" on public.quiz_questions;
drop policy if exists quiz_questions_teacher_select_own on public.quiz_questions;
drop policy if exists quiz_questions_teacher_insert_own on public.quiz_questions;
drop policy if exists quiz_questions_teacher_update_own on public.quiz_questions;
drop policy if exists quiz_questions_teacher_delete_own on public.quiz_questions;

create policy quiz_questions_teacher_select_own on public.quiz_questions
for select to authenticated
using (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
));

create policy quiz_questions_teacher_insert_own on public.quiz_questions
for insert to authenticated
with check (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
) and quiz_questions.teacher_id = (select auth.uid())
));

create policy quiz_questions_teacher_update_own on public.quiz_questions
for update to authenticated
using (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
) and quiz_questions.teacher_id = (select auth.uid())
));

drop policy if exists quiz_questions_teacher_only_guard on public.quiz_questions;
create policy quiz_questions_teacher_only_guard on public.quiz_questions
as restrictive for all to authenticated
using (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
) and quiz_questions.teacher_id = (select auth.uid()));

create policy quiz_questions_teacher_delete_own on public.quiz_questions
for delete to authenticated
using (exists (
  select 1 from public.quizzes quiz
  join public.teachers teacher on teacher.id = quiz.teacher_id
  where quiz.id = quiz_questions.quiz_id and teacher.user_id = (select auth.uid())
));

grant select, update, delete on public.quizzes to authenticated;
grant select on public.quiz_questions to authenticated;
revoke insert, update, delete on public.quiz_questions from authenticated;
revoke all on public.quizzes, public.quiz_questions from anon;

create or replace function public.save_teacher_question_quiz(p_quiz jsonb, p_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  teacher_record_id uuid;
  quiz_id uuid;
  quiz_grade integer;
  quiz_stream text;
  quiz_subject_id public.subjects.id%TYPE;
  quiz_title text;
  quiz_description text;
  quiz_status text;
  question_item jsonb;
  question_index integer := 0;
  question_kind text;
  question_text_value text;
  question_answer text;
  question_marks numeric;
  question_options jsonb;
  required_options integer;
begin
  if authenticated_user_id is null then
    raise exception 'Sign in as a teacher before saving a quiz.' using errcode = '42501';
  end if;

  select teacher.id into teacher_record_id
  from public.teachers teacher
  where teacher.user_id = authenticated_user_id;
  if teacher_record_id is null then
    raise exception 'Teacher profile not found for the authenticated account.';
  end if;

  if jsonb_typeof(p_quiz) is distinct from 'object'
    or jsonb_typeof(p_questions) is distinct from 'array'
    or coalesce(jsonb_array_length(p_questions), 0) = 0 then
    raise exception 'A quiz and at least one question are required.';
  end if;

  quiz_title := nullif(btrim(p_quiz->>'title'), '');
  quiz_grade := nullif(p_quiz->>'grade', '')::integer;
  quiz_stream := nullif(btrim(p_quiz->>'stream'), '');
  quiz_subject_id := nullif(p_quiz->>'subject_id', '');
  quiz_description := nullif(btrim(p_quiz->>'description'), '');
  quiz_status := coalesce(nullif(p_quiz->>'status', ''), 'published');

  if quiz_title is null or quiz_grade is null or quiz_subject_id is null then
    raise exception 'Quiz title, grade, and subject are required.';
  end if;
  if quiz_status not in ('draft', 'published') then
    raise exception 'Quiz status must be draft or published.';
  end if;

  if not exists (
    select 1 from public.teacher_grade_groups grade_group
    where grade_group.teacher_id = teacher_record_id
      and grade_group.grade = quiz_grade
      and grade_group.stream is not distinct from quiz_stream
  ) then
    raise exception 'The selected grade and stream are not registered to this teacher.';
  end if;
  if not exists (
    select 1 from public.teacher_subject_assignments assignment
    where assignment.teacher_id = teacher_record_id
      and assignment.grade = quiz_grade
      and assignment.stream is not distinct from quiz_stream
      and assignment.subject_id = quiz_subject_id
  ) then
    raise exception 'The selected subject is not assigned to this grade and stream.';
  end if;

  for question_item in select question_value from jsonb_array_elements(p_questions) as question_rows(question_value)
  loop
    question_index := question_index + 1;
    question_kind := question_item->>'question_type';
    question_text_value := nullif(btrim(question_item->>'question_text'), '');
    question_answer := nullif(btrim(question_item->>'correct_answer'), '');
    question_marks := nullif(question_item->>'marks', '')::numeric;
    question_options := question_item->'options';

    if question_kind is null or question_kind not in ('mcq', 'true_false', 'short_answer') or question_text_value is null or question_answer is null or question_marks is null or question_marks <= 0 then
      raise exception 'Question % is missing text, a supported type, a correct answer, or positive marks.', question_index;
    end if;

    if question_kind = 'mcq' then
      if question_options is null or jsonb_typeof(question_options) is distinct from 'array' then
        raise exception 'MCQ question % must have exactly four options.', question_index;
      end if;
      if jsonb_array_length(question_options) <> 4 then
        raise exception 'MCQ question % must have exactly four options.', question_index;
      end if;
      if exists (
        select 1 from jsonb_array_elements(question_options) as option_rows(option_value)
        where nullif(btrim(option_value->>'text'), '') is null
      ) then
        raise exception 'MCQ question % has an empty option.', question_index;
      end if;
      if question_answer not in ('A', 'B', 'C', 'D') or not exists (
        select 1 from jsonb_array_elements(question_options) as option_rows(option_value)
        where option_value->>'id' = question_answer
      ) then
        raise exception 'MCQ question % must identify one of its four options as correct.', question_index;
      end if;
    elsif question_options is not null and question_options <> 'null'::jsonb then
      raise exception 'Only MCQ questions may contain options.';
    end if;

    if question_kind = 'true_false' and question_answer not in ('true', 'false') then
      raise exception 'True/False question % must have true or false as its answer.', question_index;
    end if;
  end loop;

  if p_quiz ? 'id' and nullif(p_quiz->>'id', '') is not null then
    quiz_id := (p_quiz->>'id')::uuid;
    update public.quizzes quiz
    set title = quiz_title,
        grade = quiz_grade,
        stream = quiz_stream,
        subject_id = quiz_subject_id,
        description = quiz_description,
        status = quiz_status,
        class_grade = 'Class ' || quiz_grade::text,
        subject = subject_record.name,
        topic = quiz_title,
        question_count = jsonb_array_length(p_questions),
        total_marks = (select sum((question_value->>'marks')::numeric) from jsonb_array_elements(p_questions) as question_rows(question_value)),
        published_at = case when quiz_status = 'published' then coalesce(quiz.published_at, now()) else null end,
        updated_at = now()
    from public.subjects subject_record
    where quiz.id = quiz_id and quiz.teacher_id = teacher_record_id and subject_record.id = quiz_subject_id;
    if not found then
      raise exception 'Quiz not found or not owned by this teacher.' using errcode = '42501';
    end if;
    delete from public.quiz_questions where quiz_questions.quiz_id = quiz_id;
  else
    insert into public.quizzes (
      teacher_id, title, grade, class_grade, stream, subject_id, subject, topic,
      description, status, question_count, total_marks, published_at, updated_at
    )
    select teacher_record_id, quiz_title, quiz_grade, 'Class ' || quiz_grade::text,
      quiz_stream, quiz_subject_id, subject_record.name, quiz_title,
      quiz_description, quiz_status, jsonb_array_length(p_questions),
      (select sum((question_value->>'marks')::numeric) from jsonb_array_elements(p_questions) as question_rows(question_value)),
      case when quiz_status = 'published' then now() else null end, now()
    from public.subjects subject_record
    where subject_record.id = quiz_subject_id
    returning id into quiz_id;
    if quiz_id is null then
      raise exception 'The selected subject no longer exists.';
    end if;
  end if;

  question_index := 0;
  for question_item in select question_value from jsonb_array_elements(p_questions) as question_rows(question_value)
  loop
    question_index := question_index + 1;
    question_kind := question_item->>'question_type';
    question_options := case when question_kind = 'mcq' then question_item->'options' else null end;
    question_text_value := btrim(question_item->>'question_text');
    question_marks := (question_item->>'marks')::numeric;
    question_answer := btrim(question_item->>'correct_answer');
    insert into public.quiz_questions (
      quiz_id, teacher_id, position, text, type, marks, options, correct_answer,
      question_number, question_type, question_text
    ) values (
      quiz_id, authenticated_user_id, question_index, question_text_value,
      case question_kind when 'mcq' then 'Multiple Choice' when 'true_false' then 'True/False' else 'Short Answer' end,
      question_marks, question_options, to_jsonb(question_answer), question_index,
      question_kind, question_text_value
    );
  end loop;

  return quiz_id;
end;
$$;

revoke all on function public.save_teacher_question_quiz(jsonb, jsonb) from public, anon;
grant execute on function public.save_teacher_question_quiz(jsonb, jsonb) to authenticated;

create or replace function public.get_student_quiz_questions(p_quiz_id uuid)
returns table (
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
  select question.question_number, question.question_type, question.question_text,
         case when question.question_type = 'mcq' then question.options else null end,
         question.marks
  from public.quiz_questions question
  join public.quizzes quiz on quiz.id = question.quiz_id
  join public.subjects subject_record on subject_record.id = quiz.subject_id
  join public.student_profiles student on student.student_id = (select auth.uid())
  where quiz.id = p_quiz_id
    and quiz.status = 'published'
    and nullif(regexp_replace(student.grade, '[^0-9]', '', 'g'), '')::integer = quiz.grade
    and student.stream is not distinct from quiz.stream
    and subject_record.name = any(student.eligible_subjects)
  order by question.question_number;
$$;

revoke all on function public.get_student_quiz_questions(uuid) from public, anon;
grant execute on function public.get_student_quiz_questions(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quizzes'
  ) then
    alter publication supabase_realtime add table public.quizzes;
  end if;
end;
$$;

commit;
