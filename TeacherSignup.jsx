// ADD AT TOP
import { teacherSignUp } from '../supabase'

// ADD inside your existing submit button handler
const handleSubmit = async () => {
  const result = await teacherSignUp(
    form,
    selectedSubjects,
    selectedClasses,
    certFile
  )
  if (result.error) setError(result.error.message)
  else setSuccess('Account created! Check your email.')
}