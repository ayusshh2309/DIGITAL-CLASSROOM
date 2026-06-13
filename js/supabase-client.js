// ═══════════════════════════════════════════════════════════
// DC/js/supabase-client.js
// Shared Supabase client — used by every page in the project
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL  = 'YOUR_SUPABASE_URL';
// Example: 'https://abcdefghijklmn.supabase.co'

const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';
// Example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

const { createClient } = supabase;
window.sb = createClient(SUPABASE_URL, SUPABASE_ANON);