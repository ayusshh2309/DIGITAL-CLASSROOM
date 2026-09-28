(() => {
  const configuredUrl = window.__SUPABASE_URL__ || "kpaxlogbjvzrvlimlzis";
  const SUPABASE_URL = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}.supabase.co`;

  const SUPABASE_ANON_KEY =
    window.__SUPABASE_PUBLISHABLE_KEY__ ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYXhsb2dianZ6cnZsaW1semlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDc5MjIsImV4cCI6MjA5NjA4MzkyMn0.gkAfqrKxF67EpMZtGS_jRnJstc73E_0AVRwVCEh79gw";

  let client = null;

  function isConfigured() {
    return Boolean(
      window.supabase?.createClient &&
      SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      !SUPABASE_URL.includes("YOUR-PROJECT") &&
      !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  window.SmartLearningSupabase = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    isConfigured,
    getClient,
  };
})();
