// No-op client installed to avoid runtime errors.
(function () {
  console.warn('Integration disabled: installing noop client.');

  const noopError = { message: 'Integration disabled' };

  const noopClient = {
    auth: {
      signUp: async () => ({ data: null, error: noopError }),
      signInWithPassword: async () => ({ data: null, error: noopError }),
      getUser: async () => ({ data: { user: null }, error: noopError }),
      signOut: async () => ({ error: noopError }),
      resetPasswordForEmail: async () => ({ error: noopError }),
      updateUser: async () => ({ error: noopError })
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

  // Expose noop client globally so existing pages still reference `window.appClient` safely.
  window.appClient = noopClient;
})();
