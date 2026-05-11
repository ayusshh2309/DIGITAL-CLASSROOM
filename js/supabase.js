import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// LEARNER SIGNUP
export const learnerSignUp = async (form) => {
  const { data, error } = await supabase.auth.signUp({
    email: form.email,
    password: form.password,
  })
  if (error) return { error }

  const userId = data.user.id

  const { error: dbError } = await supabase.from('learners').insert({
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

  await supabase.from('user_roles').insert({
    auth_user_id: userId,
    role: 'learner'
  })

  return { success: true }
}

// TEACHER SIGNUP
export const teacherSignUp = async (form, selectedSubjects, selectedClasses, certFile) => {
  const { data, error } = await supabase.auth.signUp({
    email: form.email,
    password: form.password,
  })
  if (error) return { error }

  const userId = data.user.id
  const staffId = crypto.randomUUID().slice(0, 8).toUpperCase()

  let certUrl = null
  if (certFile) {
    const { data: fileData } = await supabase.storage
      .from('certifications')
      .upload(`${userId}/${certFile.name}`, certFile)
    if (fileData) {
      const { data: urlData } = supabase.storage
        .from('certifications')
        .getPublicUrl(fileData.path)
      certUrl = urlData.publicUrl
    }
  }

  const { data: teacher, error: dbError } = await supabase
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
    await supabase.from('teacher_subjects').insert(rows)
  }

  await supabase.from('user_roles').insert({
    auth_user_id: userId,
    role: 'teacher'
  })

  return { success: true, staffId }
}

// LOGIN
export const loginUser = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  if (error) return { error }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('auth_user_id', data.user.id)
    .single()

  return { role: roleData?.role }
}

// FORGOT PASSWORD
export const forgotPassword = async (email) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  })
  if (error) return { error }
  return { success: true }
}

// RESET PASSWORD
export const resetPassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { error }
  return { success: true }
}

// LOGOUT
export const logoutUser = async () => {
  await supabase.auth.signOut()
}

// GET CURRENT USER
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// SOCIAL LOGIN
export const googleLogin = async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
}

export const microsoftLogin = async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: { redirectTo: window.location.origin }
  })
}