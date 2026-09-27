(() => {
  const SUPABASE_URL =
    window.__SUPABASE_URL__ ||
    "https://YOUR-PROJECT.supabase.co";

  const SUPABASE_ANON_KEY =
    window.__SUPABASE_PUBLISHABLE_KEY__ ||
    "YOUR_SUPABASE_PUBLISHABLE_KEY";

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
