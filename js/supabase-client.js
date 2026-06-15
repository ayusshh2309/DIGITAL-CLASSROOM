// ═══════════════════════════════════════════════════════════
// DC/js/supabase-client.js
// Shared Supabase client — used by every page in the project
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL  = 'kpaxlogbjvzrvlimlzis';
// Example: 'https://abcdefghijklmn.supabase.co'

const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYXhsb2dianZ6cnZsaW1semlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDc5MjIsImV4cCI6MjA5NjA4MzkyMn0.gkAfqrKxF67EpMZtGS_jRnJstc73E_0AVRwVCEh79gw';
// Example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

const { createClient } = supabase;
window.sb = createClient(SUPABASE_URL, SUPABASE_ANON);