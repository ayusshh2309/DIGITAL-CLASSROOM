import { createClient } from '@supabase/supabase-js'


export const supabase = createClient(
  'https://pdrorihddscfkbesocdq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkcm9yaWhkZHNjZmtiZXNvY2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTUwNzYsImV4cCI6MjA5MjczMTA3Nn0.PmXoZ8cFGFGjKqH2tKXyljEF09vQQXu8F0-OpyyBwkQ'
)

const client = (typeof window !== 'undefined' && window.supabaseClient) ? window.supabaseClient : supabase

// LEARNER SIGNUP
export const learnerSignUp = async (form) => {
  const { data, error } = await client.auth.signUp({
    email: form.email,
    password: form.password,
  })
  if (error) return { error }

  const userId = data.user.id

  const { error: dbError } = await client.from('learners').insert({
    auth_user_id: userId,
    full_name: form.fullName,
    class_grade: form.classGrade,
    date_of_birth: form.dob,
    email: form.email,
    phone_number: form.phone,
    agreed_to_terms: form.agreedToTerms,
    auth_provider: 'email'
  })
  if (dbError) return { error: dbError }

  await client.from('user_roles').insert({
    auth_user_id: userId,
    role: 'learner'
  })

  return { success: true }
}

// TEACHER SIGNUP
export const teacherSignUp = async (form, selectedSubjects, selectedClasses, certFile) => {
  const { data, error } = await client.auth.signUp({
    email: form.email,
    password: form.password,
  })
  if (error) return { error }

  const userId = data.user.id
  const staffId = crypto.randomUUID().slice(0, 8).toUpperCase()

  let certUrl = null
  if (certFile) {
    const { data: fileData } = await client.storage
      .from('certifications')
      .upload(`${userId}/${certFile.name}`, certFile)
    if (fileData) {
      const { data: urlData } = client.storage
        .from('certifications')
        .getPublicUrl(fileData.path)
      certUrl = urlData.publicUrl
    }
  }

  const { data: teacher, error: dbError } = await client
    .from('teachers').insert({
      auth_user_id: userId,
      full_name: form.fullName,
      work_email: form.email,
      phone_number: form.phone,
      teaching_mode: form.teachingMode,
      grade_group: form.teachingMode === 'teach_all' ? form.gradeGroup : null,
      subject_expertise: form.teachingMode === 'subject_specialist' ? selectedSubjects : null,
      institution_name: form.institution,
      years_of_experience: form.experience,
      certification_url: certUrl,
      staff_id: staffId,
      auth_provider: 'email'
    }).select().single()

  if (dbError) return { error: dbError }

  if (form.teachingMode === 'subject_specialist') {
    const rows = selectedSubjects.map(subject => ({
      teacher_id: teacher.id,
      subject: subject,
      classes: selectedClasses[subject] || []
    }))
    await client.from('teacher_subjects').insert(rows)
  }

  await client.from('user_roles').insert({
    auth_user_id: userId,
    role: 'teacher'
  })

  return { success: true, staffId }
}

// LOGIN
export const loginUser = async (email, password) => {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  })
  if (error) return { error }

  const { data: roleData } = await client
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', data.user.id)
    .single()

  return { role: roleData?.role }
}

// FORGOT PASSWORD
export const forgotPassword = async (email) => {
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  })
  if (error) return { error }
  return { success: true }
}

// RESET PASSWORD
export const resetPassword = async (newPassword) => {
  const { error } = await client.auth.updateUser({ password: newPassword })
  if (error) return { error }
  return { success: true }
}

// LOGOUT
export const logoutUser = async () => {
  await client.auth.signOut()
}

// GET CURRENT USER
export const getCurrentUser = async () => {
  const { data: { user } } = await client.auth.getUser()
  return user
}

// SOCIAL LOGIN
export const googleLogin = async () => {
  await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
}

export const microsoftLogin = async () => {
  await client.auth.signInWithOAuth({
    provider: 'azure',
    options: { redirectTo: window.location.origin }
  })
}