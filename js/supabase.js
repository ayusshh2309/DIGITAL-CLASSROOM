(() => {
  const SUPABASE_URL = "YOUR_SUPABASE_URL";
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

  function isConfigured() {
    return Boolean(
      window.supabase?.createClient &&
      SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      SUPABASE_URL !== "YOUR_SUPABASE_URL" &&
      SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY",
    );
  }

  function getClient() {
    return isConfigured() ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  }

  window.SmartLearningSupabase = { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured, getClient };
})();
