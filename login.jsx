// ADD AT TOP
import { loginUser, googleLogin, microsoftLogin } from './supabase'

// ADD inside your existing login button handler
const handleLogin = async () => {
  const result = await loginUser(email, password)
  if (result.error) setError(result.error.message)
  else if (result.role === 'teacher') navigate('/teacher-dashboard')
  else if (result.role === 'learner') navigate('/learner-dashboard')
}

// ADD to your Google button
onClick={googleLogin}

// ADD to your Microsoft button
onClick={microsoftLogin}