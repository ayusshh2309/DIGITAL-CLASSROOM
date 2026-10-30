-- Read-only verification for sql_student_quiz_security_patch.sql.

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
    'submit_quiz_attempt'
  )
order by routine.proname;

select constraint_record.conname,
       pg_get_constraintdef(constraint_record.oid) as constraint_definition,
       constraint_record.convalidated
from pg_constraint constraint_record
where constraint_record.conrelid = 'public.quiz_questions'::regclass
  and constraint_record.conname = 'quiz_questions_mcq_true_false_only_check';

select count(*) as unsupported_question_count
from public.quiz_questions
where question_type is distinct from 'mcq'
  and question_type is distinct from 'true_false';

select table_name,
       grantee,
       privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select policyname,
       tablename,
       cmd,
       roles,
       qual
from pg_policies
where schemaname = 'public'
  and tablename in ('quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers')
order by tablename, policyname;
