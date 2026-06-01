-- Supabase / Postgres migration for DC app
-- Run these in the Supabase SQL editor (do not expose anon key here)

-- 1) learners
CREATE TABLE IF NOT EXISTS learners (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE NOT NULL,
  full_name TEXT,
  class_grade TEXT,
  date_of_birth DATE,
  email TEXT,
  phone_number TEXT,
  agreed_to_terms BOOLEAN DEFAULT FALSE,
  auth_provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learners_auth_user_id ON learners(auth_user_id);

-- 2) teachers
CREATE TABLE IF NOT EXISTS teachers (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE NOT NULL,
  full_name TEXT,
  work_email TEXT,
  phone_number TEXT,
  teaching_mode TEXT,
  grade_group TEXT,
  subject_expertise JSONB,
  institution_name TEXT,
  years_of_experience INTEGER,
  certification_url TEXT,
  staff_id TEXT UNIQUE,
  auth_provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teachers_auth_user_id ON teachers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_staff_id ON teachers(staff_id);

-- 3) teacher_subjects
-- Stores which subjects a teacher covers and the class list for each subject.
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id BIGSERIAL PRIMARY KEY,
  teacher_db_id BIGINT REFERENCES teachers(id) ON DELETE CASCADE,
  teacher_auth_id UUID,
  subject TEXT NOT NULL,
  classes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher_db_id ON teacher_subjects(teacher_db_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher_auth_id ON teacher_subjects(teacher_auth_id);

-- 4) user_roles
CREATE TABLE IF NOT EXISTS user_roles (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_roles_auth_user_id ON user_roles(auth_user_id);

-- 5) teacher_content
CREATE TABLE IF NOT EXISTS teacher_content (
  id BIGSERIAL PRIMARY KEY,
  teacher_db_id BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  teacher_auth_id UUID,
  teacher_staff_id TEXT,
  teacher_name TEXT,
  type TEXT,
  subject TEXT,
  class_level TEXT,
  chapter TEXT,
  title TEXT,
  description TEXT,
  file_info JSONB,
  schedule_info JSONB,
  assignment_mode TEXT,
  grade_group TEXT,
  stream TEXT,
  source TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teacher_content_teacher_db_id ON teacher_content(teacher_db_id);
CREATE INDEX IF NOT EXISTS idx_teacher_content_teacher_auth_id ON teacher_content(teacher_auth_id);
CREATE INDEX IF NOT EXISTS idx_teacher_content_subject ON teacher_content(subject);

-- NOTES:
-- 1) This schema includes both `teacher_db_id` (the teachers table PK) and
--    `teacher_auth_id` (the Supabase Auth user UUID). The codebase has a
--    mixture of places that use auth user id and places that use the DB id;
--    keeping both allows compatibility while you update the frontend.
-- 2) You must create Storage buckets named: videos, images, docs, materials, certifications
--    and set appropriate public/private policies depending on your needs.
-- 3) Configure Row Level Security (RLS) and policies in Supabase for production.

-- =====================================================================
-- Row Level Security (RLS) examples
-- Run these commands in the Supabase SQL editor after creating the tables.
-- Customize the policies to match your app's privacy rules.

-- Enable RLS for sensitive tables
ALTER TABLE IF EXISTS learners ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS teacher_content ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own learner row (must set auth_user_id)
CREATE POLICY IF NOT EXISTS learners_insert_own ON learners
  FOR INSERT USING (auth.role() = 'authenticated')
  WITH CHECK (auth.uid()::text = auth_user_id::text);

-- Allow users to select their own learner record
CREATE POLICY IF NOT EXISTS learners_select_own ON learners
  FOR SELECT USING (auth.uid()::text = auth_user_id::text);

-- Teachers: allow INSERT for authenticated users (frontend should set auth_user_id)
CREATE POLICY IF NOT EXISTS teachers_insert_own ON teachers
  FOR INSERT USING (auth.role() = 'authenticated')
  WITH CHECK (auth.uid()::text = auth_user_id::text);

-- teacher_content: allow teachers to insert content where teacher_auth_id matches
CREATE POLICY IF NOT EXISTS teacher_content_insert_by_teacher ON teacher_content
  FOR INSERT USING (auth.role() = 'authenticated')
  WITH CHECK (auth.uid()::text = teacher_auth_id::text OR auth.uid()::text = teacher_db_id::text);

-- teacher_content: allow public SELECT for published content
CREATE POLICY IF NOT EXISTS teacher_content_select_published ON teacher_content
  FOR SELECT USING (status = 'published');

-- =====================================================================
-- Seed / Usage examples (replace <AUTH_USER_UUID> with real auth user id)
-- Example: insert a user_role after a successful sign up from frontend
-- INSERT INTO user_roles (auth_user_id, role) VALUES ('<AUTH_USER_UUID>', 'learner');

-- Example: insert learner record (frontend should set auth_user_id to auth.uid())
-- INSERT INTO learners (auth_user_id, full_name, class_grade, email, phone_number, agreed_to_terms)
-- VALUES ('<AUTH_USER_UUID>', 'Jane Doe', '10', 'jane@example.com', '+1234567890', true);

-- Example: insert teacher record (after teacher signs up)
-- INSERT INTO teachers (auth_user_id, full_name, work_email, teaching_mode, staff_id)
-- VALUES ('<AUTH_USER_UUID>', 'Mr. Teacher', 'teacher@example.com', 'subject_specialist', 'STF12345');

-- After running these, check the Supabase table view in the dashboard to confirm rows appear.

