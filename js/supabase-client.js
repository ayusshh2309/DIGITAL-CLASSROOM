// Supabase client initialization for browser pages.
(function () {
  const SUPABASE_URL = 'https://rcitrmmfsdnattjejkgc.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjaXRybW1mc2RuYXR0amVqa2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg0NjcsImV4cCI6MjA5NTkxNDQ2N30.h5KR8a-4ewaUJ1rkkHAZQ9ifYwpBpPzUZctFfE8ReKc';

  const noopError = { message: 'Integration disabled' };

  const noopClient = {
    auth: {
      signUp: async () => ({ data: null, error: noopError }),
      signInWithPassword: async () => ({ data: null, error: noopError }),
      getUser: async () => ({ data: { user: null }, error: noopError }),
      signOut: async () => ({ error: noopError }),
      resetPasswordForEmail: async () => ({ error: noopError }),
      updateUser: async () => ({ error: noopError }),
      onAuthStateChange: async () => ({ data: null, error: noopError })
    },
    from: (/* table */) => ({
      select: async () => ({ data: [], error: noopError }),
      insert: async () => ({ data: null, error: noopError }),
      update: async () => ({ data: null, error: noopError }),
      delete: async () => ({ data: null, error: noopError })
    }),
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: noopError }),
        getPublicUrl: () => ({ publicUrl: null })
      })
    }
  };

  function installNoopClient(reason) {
    console.warn('Supabase client disabled:', reason);
    window.appClient = noopClient;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY')) {
    installNoopClient('Supabase URL or anon key not configured in js/supabase-client.js');
    return;
  }

  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    installNoopClient('Supabase JS library not loaded. Add the CDN script before supabase-client.js');
    return;
  }

  try {
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.appClient = client;
    console.log('Supabase client initialized successfully');
  } catch (err) {
    installNoopClient('Failed to initialize Supabase client: ' + (err.message || err));
  }
})();
