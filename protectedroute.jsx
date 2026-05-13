// ADD AT TOP
import { getCurrentUser } from '../supabase'

// ADD inside useEffect
useEffect(() => {
  const check = async () => {
    const user = await getCurrentUser()
    if (!user) navigate('/login')
    setLoading(false)
  }
  check()
}, [])