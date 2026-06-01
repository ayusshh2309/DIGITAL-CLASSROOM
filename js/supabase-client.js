// Browser Supabase client initializer
// This file creates a global `supabaseClient` using the CDN `supabase` object.
(function () {
  // Project Supabase URL and anon/public key
  window.SUPABASE_URL = 'https://pdrorihddscfkbesocdq.supabase.co'
  window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkcm9yaWhkZHNjZmtiZXNvY2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTUwNzYsImV4cCI6MjA5MjczMTA3Nn0.PmXoZ8cFGFGjKqH2tKXyljEF09vQQXu8F0-OpyyBwkQ'

  if (typeof supabase !== 'undefined' && supabase.createClient) {
    try {
      window.supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    } catch (e) {
      // If creation fails, leave it undefined and log error
      console.error('Failed to create supabaseClient', e)
    }
  } else {
    console.warn('Supabase CDN not detected. Ensure the CDN script is loaded before js/supabase-client.js')
  }
})()
