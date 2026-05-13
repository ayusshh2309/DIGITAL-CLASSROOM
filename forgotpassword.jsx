// ADD AT TOP
import { forgotPassword } from '../supabase'

// ADD inside your existing send button handler
const handleForgotPassword = async () => {
  const result = await forgotPassword(email)
  if (result.error) setError(result.error.message)
  else setSuccess('Check your email for the reset link!')
}