(() => {
  const SUPABASE_URL = "https://rcitrmmfsdnattjejkgc.supabase.co";
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
  let client = null;

  function isConfigured() {
    return Boolean(
      window.supabase?.createClient &&
      SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY",
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  window.SmartLearningSupabase = { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured, getClient };
})();
