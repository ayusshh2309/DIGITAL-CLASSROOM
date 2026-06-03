/**
 * Supabase Authentication Helpers
 * Comprehensive auth functions for login, logout, password reset, OAuth, account deletion, etc.
 */

// Get the Supabase client from global scope
const getClient = () => {
  if (!window.appClient) {
    throw new Error('Supabase client not initialized. Make sure supabase-client.js is loaded.');
  }
  return window.appClient;
};

// =====================================================================
// EMAIL & PASSWORD AUTHENTICATION
// =====================================================================

/**
 * Sign up a new user (learner or teacher)
 * @param {string} email - User email
 * @param {string} password - User password (min 6 chars)
 * @param {string} fullName - Full name of user
 * @param {string} userRole - 'learner' or 'teacher'
 * @param {object} additionalData - Extra data (classGrade, institution, etc.)
 * @returns {Promise<{user, session, error}>}
 */
async function signUpUser(email, password, fullName, userRole, additionalData = {}) {
  try {
    const client = getClient();

    // Create auth user
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          user_role: userRole,
          ...additionalData
        }
      }
    });

    if (error) {
      return { user: null, session: null, error };
    }

    // Create user role
    if (data.user) {
      await client.from('user_roles').insert({
        auth_user_id: data.user.id,
        role: userRole
      });

      // Create profile based on role
      if (userRole === 'learner') {
        await client.from('learners').insert({
          auth_user_id: data.user.id,
          full_name: fullName,
          email,
          class_grade: additionalData.classGrade || null,
          phone_number: additionalData.phoneNumber || null,
          agreed_to_terms: additionalData.agreedToTerms || false,
          auth_provider: 'email'
        });
      } else if (userRole === 'teacher') {
        await client.from('teachers').insert({
          auth_user_id: data.user.id,
          full_name: fullName,
          work_email: email,
          phone_number: additionalData.phoneNumber || null,
          institution_name: additionalData.institutionName || null,
          years_of_experience: additionalData.yearsOfExperience || null,
          teaching_mode: additionalData.teachingMode || null,
          grade_group: additionalData.gradeGroup || null,
          auth_provider: 'email'
        });
      }
    }

    return { user: data.user, session: data.session, error: null };
  } catch (err) {
    return { user: null, session: null, error: err };
  }
}

/**
 * Sign in with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{user, session, role, error}>}
 */
async function loginUser(email, password) {
  try {
    const client = getClient();

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return { user: null, session: null, role: null, error };
    }

    // Get user role
    const { data: roleData } = await client
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', data.user.id)
      .single();

    return {
      user: data.user,
      session: data.session,
      role: roleData?.role || null,
      error: null
    };
  } catch (err) {
    return { user: null, session: null, role: null, error: err };
  }
}

/**
 * Sign out current user
 * @returns {Promise<{error}>}
 */
async function logoutUser() {
  try {
    const client = getClient();
    const { error } = await client.auth.signOut();
    return { error };
  } catch (err) {
    return { error: err };
  }
}

// =====================================================================
// PASSWORD RESET
// =====================================================================

/**
 * Send password reset email
 * @param {string} email - User email
 * @returns {Promise<{error}>}
 */
async function sendPasswordResetEmail(email) {
  try {
    const client = getClient();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/resetpassword.jsx`
    });
    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Confirm password reset with token and new password
 * @param {string} newPassword - New password
 * @returns {Promise<{user, error}>}
 */
async function resetPassword(newPassword) {
  try {
    const client = getClient();
    const { data, error } = await client.auth.updateUser({
      password: newPassword
    });
    return { user: data?.user || null, error };
  } catch (err) {
    return { user: null, error: err };
  }
}

// =====================================================================
// OAUTH SIGN UP / LOGIN
// =====================================================================

/**
 * Sign in with Google
 * @param {string} redirectUrl - Where to redirect after sign in
 * @returns {Promise<{session, error}>}
 */
async function signInWithGoogle(redirectUrl = window.location.origin) {
  try {
    const client = getClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    return { session: data?.session || null, error };
  } catch (err) {
    return { session: null, error: err };
  }
}

/**
 * Sign in with GitHub
 * @param {string} redirectUrl - Where to redirect after sign in
 * @returns {Promise<{session, error}>}
 */
async function signInWithGitHub(redirectUrl = window.location.origin) {
  try {
    const client = getClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: redirectUrl
      }
    });
    return { session: data?.session || null, error };
  } catch (err) {
    return { session: null, error: err };
  }
}

/**
 * Complete OAuth sign up flow
 * Creates user profile after OAuth login
 * @param {string} userRole - 'learner' or 'teacher'
 * @param {object} profileData - Additional profile data
 * @returns {Promise<{user, role, error}>}
 */
async function completeOAuthSignUp(userRole, profileData = {}) {
  try {
    const client = getClient();

    // Get current user
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) {
      return { user: null, role: null, error: userError || new Error('No authenticated user') };
    }

    // Check if user already has a role
    const { data: existingRole } = await client
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    if (existingRole) {
      return { user, role: existingRole.role, error: null };
    }

    // Create user role
    await client.from('user_roles').insert({
      auth_user_id: user.id,
      role: userRole
    });

    // Create profile based on role
    const email = user.email || profileData.email;
    const fullName = user.user_metadata?.full_name || profileData.fullName || email.split('@')[0];

    if (userRole === 'learner') {
      await client.from('learners').insert({
        auth_user_id: user.id,
        full_name: fullName,
        email,
        class_grade: profileData.classGrade || null,
        phone_number: profileData.phoneNumber || null,
        profile_image_url: user.user_metadata?.avatar_url || null,
        auth_provider: user.app_metadata?.provider || 'oauth'
      });
    } else if (userRole === 'teacher') {
      await client.from('teachers').insert({
        auth_user_id: user.id,
        full_name: fullName,
        work_email: email,
        phone_number: profileData.phoneNumber || null,
        institution_name: profileData.institutionName || null,
        years_of_experience: profileData.yearsOfExperience || null,
        profile_image_url: user.user_metadata?.avatar_url || null,
        auth_provider: user.app_metadata?.provider || 'oauth'
      });
    }

    return { user, role: userRole, error: null };
  } catch (err) {
    return { user: null, role: null, error: err };
  }
}

// =====================================================================
// EMAIL VERIFICATION
// =====================================================================

/**
 * Send email verification link
 * @param {string} redirectUrl - Where to redirect after verification
 * @returns {Promise<{error}>}
 */
async function sendEmailVerificationLink(redirectUrl = window.location.origin) {
  try {
    const client = getClient();
    const { data: { user }, error: userError } = await client.auth.getUser();

    if (userError || !user) {
      return { error: userError || new Error('No authenticated user') };
    }

    const { error } = await client.auth.resendEnvelope({
      type: 'signup',
      email: user.email,
      options: {
        redirectTo: redirectUrl
      }
    });

    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Verify email with token (called from redirect link)
 * @param {string} tokenHash - Token from email link
 * @param {string} type - Token type (signup, recovery, etc.)
 * @returns {Promise<{session, user, error}>}
 */
async function verifyEmail(tokenHash, type = 'email_change') {
  try {
    const client = getClient();
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: type
    });

    if (!error && data?.user) {
      // Update user record as verified
      const userRole = data.user.user_metadata?.user_role || 'learner';
      if (userRole === 'learner') {
        await client.from('learners')
          .update({ email: data.user.email })
          .eq('auth_user_id', data.user.id);
      }
    }

    return {
      session: data?.session || null,
      user: data?.user || null,
      error
    };
  } catch (err) {
    return { session: null, user: null, error: err };
  }
}

// =====================================================================
// ACCOUNT MANAGEMENT
// =====================================================================

/**
 * Get current authenticated user
 * @returns {Promise<{user, role, profile, error}>}
 */
async function getCurrentUser() {
  try {
    const client = getClient();
    const { data: { user }, error: userError } = await client.auth.getUser();

    if (userError || !user) {
      return { user: null, role: null, profile: null, error: userError };
    }

    // Get user role
    const { data: roleData } = await client
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    // Get user profile
    let profile = null;
    if (roleData?.role === 'learner') {
      const { data: learnerData } = await client
        .from('learners')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();
      profile = learnerData;
    } else if (roleData?.role === 'teacher') {
      const { data: teacherData } = await client
        .from('teachers')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();
      profile = teacherData;
    }

    return {
      user,
      role: roleData?.role || null,
      profile,
      error: null
    };
  } catch (err) {
    return { user: null, role: null, profile: null, error: err };
  }
}

/**
 * Update user profile
 * @param {string} userRole - 'learner' or 'teacher'
 * @param {object} updates - Updated profile data
 * @returns {Promise<{profile, error}>}
 */
async function updateUserProfile(userRole, updates) {
  try {
    const client = getClient();
    const { data: { user }, error: userError } = await client.auth.getUser();

    if (userError || !user) {
      return { profile: null, error: userError };
    }

    const table = userRole === 'learner' ? 'learners' : 'teachers';
    const { data: profile, error } = await client
      .from(table)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('auth_user_id', user.id)
      .select()
      .single();

    return { profile, error };
  } catch (err) {
    return { profile: null, error: err };
  }
}

/**
 * Delete user account completely
 * @param {string} password - User password for confirmation (optional for OAuth)
 * @returns {Promise<{error}>}
 */
async function deleteUserAccount(password = null) {
  try {
    const client = getClient();
    const { data: { user }, error: userError } = await client.auth.getUser();

    if (userError || !user) {
      return { error: userError };
    }

    // Get user role
    const { data: roleData } = await client
      .from('user_roles')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    // Soft delete user profile (set is_deleted flag)
    const table = roleData?.role === 'learner' ? 'learners' : 'teachers';
    await client
      .from(table)
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString()
      })
      .eq('auth_user_id', user.id);

    // Delete user role
    await client
      .from('user_roles')
      .delete()
      .eq('auth_user_id', user.id);

    // Delete auth user
    const { error } = await client.auth.admin.deleteUser(user.id);

    if (!error) {
      await client.auth.signOut();
    }

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// =====================================================================
// SESSION MANAGEMENT
// =====================================================================

/**
 * Listen to auth state changes
 * @param {function} callback - Callback function(event, session)
 * @returns {function} Unsubscribe function
 */
function onAuthStateChange(callback) {
  try {
    const client = getClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
    return () => subscription?.unsubscribe();
  } catch (err) {
    console.error('Auth state change error:', err);
    return () => {};
  }
}

/**
 * Get current session
 * @returns {Promise<{session, error}>}
 */
async function getCurrentSession() {
  try {
    const client = getClient();
    const { data: { session }, error } = await client.auth.getSession();
    return { session, error };
  } catch (err) {
    return { session: null, error: err };
  }
}

// =====================================================================
// FILE UPLOAD HELPERS
// =====================================================================

/**
 * Upload file to storage bucket
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path in bucket
 * @param {File|Blob} file - File to upload
 * @param {object} options - Upload options
 * @returns {Promise<{publicUrl, error}>}
 */
async function uploadFile(bucket, path, file, options = {}) {
  try {
    const client = getClient();
    const { error: uploadError } = await client.storage
      .from(bucket)
      .upload(path, file, options);

    if (uploadError) {
      return { publicUrl: null, error: uploadError };
    }

    // Get public URL
    const { data: { publicUrl } } = client.storage
      .from(bucket)
      .getPublicUrl(path);

    // Track file upload
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const { data: roleData } = await client
        .from('user_roles')
        .select('role')
        .eq('auth_user_id', user.id)
        .single();

      await client.from('file_uploads').insert({
        user_auth_id: user.id,
        user_type: roleData?.role || 'learner',
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        storage_bucket: bucket,
        storage_path: path,
        is_public: true
      });
    }

    return { publicUrl, error: null };
  } catch (err) {
    return { publicUrl: null, error: err };
  }
}

/**
 * Download file from storage
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path in bucket
 * @returns {Promise<{data, error}>}
 */
async function downloadFile(bucket, path) {
  try {
    const client = getClient();
    const { data, error } = await client.storage
      .from(bucket)
      .download(path);

    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Delete file from storage
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path in bucket
 * @returns {Promise<{error}>}
 */
async function deleteFile(bucket, path) {
  try {
    const client = getClient();
    const { error } = await client.storage
      .from(bucket)
      .remove([path]);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// Export all functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    signUpUser,
    loginUser,
    logoutUser,
    sendPasswordResetEmail,
    resetPassword,
    signInWithGoogle,
    signInWithGitHub,
    completeOAuthSignUp,
    sendEmailVerificationLink,
    verifyEmail,
    getCurrentUser,
    updateUserProfile,
    deleteUserAccount,
    onAuthStateChange,
    getCurrentSession,
    uploadFile,
    downloadFile,
    deleteFile
  };
}
