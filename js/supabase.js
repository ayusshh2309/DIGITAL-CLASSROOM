(() => {
  const configuredUrl = window.__SUPABASE_URL__ || "kpaxlogbjvzrvlimlzis";
  const SUPABASE_URL = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}.supabase.co`;

  const SUPABASE_ANON_KEY =
    window.__SUPABASE_PUBLISHABLE_KEY__ ||
    "sb_publishable_kNwHrEATRfka3wF2hQ4A_A_OU2c5PzZ";

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
    client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        experimental: {
          recoveryCodes: true,
        },
      },
    });
    return client;
  }

  window.SmartLearningSupabase = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    isConfigured,
    getClient,
  };
})();
