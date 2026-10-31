-- Read-only checks for Student Notes. Run in Supabase SQL Editor; this file makes no changes.

-- Confirm the actual columns used by the Notes page and its authorization relationships.
select table_schema, table_name, column_name, data_type, udt_name
from information_schema.columns
where (table_schema = 'public' and table_name in (
    'materials',
    'students',
    'subjects',
    'teachers',
    'teacher_grade_groups',
    'teacher_subject_assignments'
  ))
  or (table_schema = 'storage' and table_name in ('buckets', 'objects'))
order by table_schema, table_name, ordinal_position;

-- Inspect material foreign keys, including subject and teacher ownership.
select
  constraint_record.conname as constraint_name,
  constraint_record.contype as constraint_type,
  constraint_record.conrelid::regclass as source_table,
  constraint_record.confrelid::regclass as referenced_table,
  pg_get_constraintdef(constraint_record.oid) as definition
from pg_constraint as constraint_record
where constraint_record.conrelid = to_regclass('public.materials')
order by constraint_record.conname;

-- Review all relevant table and Storage RLS policies.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in (
    'materials',
    'students',
    'subjects',
    'teachers',
    'teacher_grade_groups',
    'teacher_subject_assignments'
  ))
  or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- Confirm the configured visibility of the three allowed Storage buckets.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('pdfs', 'photos', 'documents')
order by id;

-- Confirm Realtime publication membership for materials.
select pubname, schemaname, tablename
from pg_publication_tables
where schemaname = 'public'
  and tablename = 'materials'
order by pubname;

-- Check whether the legacy RPC exists and inspect its exact signature/body if present.
select
  procedure.oid::regprocedure as function_signature,
  pg_get_function_result(procedure.oid) as return_type,
  pg_get_functiondef(procedure.oid) as definition
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'get_student_materials'
order by procedure.oid::regprocedure::text;

-- Check whether Computer Science is configured for the student's approved
-- Grade 11 Commerce curriculum. The Notes page requires the returned subject
-- ID to match materials.subject_id before it fetches material rows.
select id, name, grades, streams
from public.subjects
where lower(btrim(name)) = 'computer science'
order by id;

-- Check whether the uploaded Grade 11 Commerce Computer Science material is
-- linked to that subject and stored in an allowed Notes bucket/type.
select
  material.id,
  material.teacher_id,
  material.title,
  material.grade,
  material.stream,
  material.subject_id,
  subject.name as subject_name,
  material.material_type,
  material.storage_bucket,
  material.file_name,
  material.created_at
from public.materials as material
left join public.subjects as subject on subject.id = material.subject_id
where material.grade::text = '11'
  and lower(btrim(coalesce(material.stream, ''))) = 'commerce'
  and lower(btrim(coalesce(subject.name, ''))) = 'computer science'
order by material.created_at desc
limit 20;

-- Check the teacher's registered Grade 11 Commerce group and its assignments.
select
  grade_group.teacher_id,
  grade_group.grade,
  grade_group.stream,
  grade_group.teach_all_subjects,
  assignment.subject_id,
  subject.name as subject_name,
  subject.grades as subject_grades,
  subject.streams as subject_streams
from public.teacher_grade_groups as grade_group
left join public.teacher_subject_assignments as assignment
  on assignment.teacher_id = grade_group.teacher_id
  and assignment.grade = grade_group.grade
  and assignment.stream is not distinct from grade_group.stream
left join public.subjects as subject on subject.id = assignment.subject_id
where grade_group.grade = 11
  and lower(btrim(coalesce(grade_group.stream, ''))) = 'commerce'
order by grade_group.teacher_id, subject.name;

-- Inspect the subject and Storage access policies that control student reads.
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where (schemaname = 'public' and tablename = 'materials')
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;
