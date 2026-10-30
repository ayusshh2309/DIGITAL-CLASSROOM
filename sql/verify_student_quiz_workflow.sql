-- Read-only verification for sql_student_quiz_workflow.sql.

with required_columns(table_name, column_name) as (
  values
    ('subjects', 'grades'),
    ('subjects', 'streams'),
    ('students', 'user_id'),
    ('students', 'grade'),
    ('students', 'stream'),
    ('teachers', 'user_id'),
    ('teacher_grade_groups', 'teacher_id'),
    ('teacher_grade_groups', 'grade'),
    ('teacher_grade_groups', 'stream'),
    ('teacher_grade_groups', 'teach_all_subjects'),
    ('teacher_subject_assignments', 'teacher_id'),
    ('teacher_subject_assignments', 'grade'),
    ('teacher_subject_assignments', 'stream'),
    ('teacher_subject_assignments', 'subject_id'),
    ('quizzes', 'teacher_id'),
    ('quizzes', 'grade'),
    ('quizzes', 'stream'),
    ('quizzes', 'subject_id'),
    ('quizzes', 'duration_minutes'),
    ('quiz_questions', 'question_type'),
    ('quiz_questions', 'correct_answer'),
    ('quiz_attempts', 'student_id'),
    ('quiz_attempts', 'started_at'),
    ('quiz_answers', 'student_answer'),
    ('quiz_answers', 'marks_awarded')
)
select required.table_name,
       required.column_name,
       exists (
         select 1
         from information_schema.columns column_record
         where column_record.table_schema = 'public'
           and column_record.table_name = required.table_name
           and column_record.column_name = required.column_name
       ) as exists_in_database
from required_columns required
order by required.table_name, required.column_name;

select routine.proname,
       routine.prosecdef as security_definer,
       has_function_privilege('anon', routine.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_can_execute
from pg_proc routine
join pg_namespace schema_record on schema_record.oid = routine.pronamespace
where schema_record.nspname = 'public'
  and routine.proname in (
    'save_teacher_question_quiz',
    'quiz_student_is_eligible',
    'get_student_quiz_catalog',
    'get_student_quiz_questions',
    'start_quiz_attempt',
    'get_student_quiz_attempt',
    'save_student_quiz_answer',
    'submit_quiz_attempt',
    'get_teacher_quiz_review',
    'grade_quiz_short_answer',
    'release_quiz_results'
  )
order by routine.proname;

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers')
  and column_name in ('results_released', 'graded_at')
order by table_name, column_name;

select constraint_record.conname,
       pg_get_constraintdef(constraint_record.oid) as constraint_definition,
       constraint_record.convalidated
from pg_constraint constraint_record
where constraint_record.conrelid = 'public.quiz_questions'::regclass
order by constraint_record.conname;

select policyname, tablename, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers')
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
