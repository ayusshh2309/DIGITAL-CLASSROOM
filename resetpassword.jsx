// ADD AT TOP
import { resetPassword } from '../supabase'

// ADD inside your existing reset button handler
const handleReset = async () => {
  if (password !== confirmPassword) {
    setError('Passwords do not match'); return
  }
  const result = await resetPassword(password)
  if (result.error) setError(result.error.message)
  else navigate('/login')
}