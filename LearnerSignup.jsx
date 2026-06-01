// ADD AT TOP
import { learnerSignUp, googleLogin, microsoftLogin } from './supabase'

// ADD inside your existing submit button handler
const handleSubmit = async () => {
  const result = await learnerSignUp(form)
  if (result.error) setError(result.error.message)
  else setSuccess('Account created! Check your email.')
}

// ADD to your Google button
onClick={googleLogin}

// ADD to your Microsoft button
onClick={microsoftLogin}