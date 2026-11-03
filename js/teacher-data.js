(function () {
  function isConfigured() {
    return Boolean(window.SmartLearningSupabase?.isConfigured?.());
  }

  function readJson(storage, key, fallback) {
    try {
      return JSON.parse(storage.getItem(key) || "null") || fallback;
    } catch (error) {
      console.warn(`Could not read ${key}.`, error);
      return fallback;
    }
  }

  function getTeacherData() {
    return (
      readJson(localStorage, "teacherRegistration", null) ||
      readJson(localStorage, "teacherProfile", null) ||
      readJson(localStorage, "teacherData", null) ||
      readJson(sessionStorage, "finalTeacherRegistration", null) ||
      null
    );
  }

  function saveTeacherData(data) {
    const serialized = JSON.stringify(data);
    localStorage.setItem("teacherRegistration", serialized);
    localStorage.setItem("teacherProfile", serialized);
    localStorage.setItem("teacherData", serialized);
    sessionStorage.setItem("finalTeacherRegistration", serialized);
  }

  function getSupabaseClient() {
    return isConfigured() ? window.SmartLearningSupabase.getClient() : null;
  }

  const PROFILE_FIELDS = new Set([
    "full_name",
    "country_code",
    "phone_number",
    "date_of_birth",
    "gender",
    "country",
    "state",
    "city",
    "address",
    "profile_photo_url",
    "bio",
    "highest_qualification",
    "degree_course",
    "specialization",
    "university_college",
    "graduation_year",
    "languages",
    "employment_status",
    "institution_name",
    "institution_type",
    "years_experience",
    "teaching_mode",
  ]);

  function normalizeLanguageNames(languages) {
    if (!Array.isArray(languages)) return [];
    return [
      ...new Map(
        languages
          .map((language) => String(language || "").trim())
          .filter(Boolean)
          .map((language) => [language.toLocaleLowerCase(), language]),
      ).values(),
    ];
  }

  async function loadTeacherLanguageCatalog(client = getSupabaseClient()) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client
      .from("languages")
      .select("id, name")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data || [])
      .filter((language) => language.id !== null && language.id !== undefined && String(language.name || "").trim())
      .map((language) => ({
        id: String(language.id),
        name: String(language.name).trim(),
      }));
  }

  async function resolveTeacherLanguageIds(client, values) {
    const requested = normalizeLanguageNames(values);
    if (!requested.length) return [];
    const catalog = await loadTeacherLanguageCatalog(client);
    const byId = new Map(catalog.map((language) => [language.id, language.id]));
    const byName = new Map(
      catalog.map((language) => [language.name.toLocaleLowerCase(), language.id]),
    );
    const unresolved = [];
    const ids = requested.map((value) => {
      const id = byId.get(value);
      const languageId = id || byName.get(value.toLocaleLowerCase());
      if (!languageId) unresolved.push(value);
      return languageId;
    });
    if (unresolved.length) {
      throw new Error(`Unknown teacher language selection: ${unresolved.join(", ")}.`);
    }
    return [...new Set(ids)];
  }

  async function resolveTeacherLanguageNames(client, values) {
    const requested = normalizeLanguageNames(values);
    if (!requested.length) return [];
    const catalog = await loadTeacherLanguageCatalog(client);
    const byId = new Map(catalog.map((language) => [language.id, language]));
    const byName = new Map(
      catalog.map((language) => [language.name.toLocaleLowerCase(), language]),
    );
    const unresolved = [];
    const names = requested.map((value) => {
      const language = byId.get(value) || byName.get(value.toLocaleLowerCase());
      if (!language) unresolved.push(value);
      return language?.name;
    });
    if (unresolved.length) {
      throw new Error(`Unknown stored teacher language selection: ${unresolved.join(", ")}.`);
    }
    return [...new Set(names)];
  }

  function logSupabaseFailure(operation, error) {
    console.error(`[TeacherData] ${operation} failed.`, {
      name: error?.name || "SupabaseError",
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || "Unknown error",
      details: error?.details || null,
      hint: error?.hint || null,
    });
  }

  async function getAuthenticatedUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error) {
      logSupabaseFailure("Authentication lookup", error);
      if (error.name === "AuthSessionMissingError" || error.code === "session_not_found") {
        throw Object.assign(new Error("Your session has expired. Please sign in again."), {
          code: "AUTH_REQUIRED",
          cause: error,
        });
      }
      throw error;
    }
    if (!data.user) {
      throw Object.assign(new Error("Your session has expired. Please sign in again."), {
        code: "AUTH_REQUIRED",
      });
    }
    return data.user;
  }

  function redirectToLogin() {
    window.__currentTeacherProfile = null;
    window.location.assign(
      new URL("../teacher_registration/login.html", window.location.href).href,
    );
  }

  let teacherValidationPromise = null;
  let teacherAccountUnavailable = false;

  function clearTemporaryRegistrationDraft() {
    try {
      if (window.TeacherRegistrationStorage?.clearRegistrationDraft) {
        window.TeacherRegistrationStorage.clearRegistrationDraft();
      } else {
        localStorage.removeItem("smartLearningTeacherRegistration");
        [
          "teacherPersonalInfo",
          "teacherProfessionalInfo",
          "teacherProfilePhotoName",
        ].forEach((key) => sessionStorage.removeItem(key));
      }
    } catch (error) {
      console.warn("Temporary teacher registration data could not be cleared.", error);
    }
  }

  async function validateTeacherAccount() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    if (teacherAccountUnavailable) return null;

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) {
      if (authError.name === "AuthSessionMissingError" || authError.code === "session_not_found") {
        redirectToLogin();
        return null;
      }
      throw authError;
    }
    const user = authData?.user;
    if (!user) {
      redirectToLogin();
      return null;
    }

    const { data, error } = await client
      .from("teachers")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      logSupabaseFailure("Authenticated teacher profile lookup", error);
      throw error;
    }
    if (!data) {
      await handleUnavailableTeacher(client);
      return null;
    }

    window.__currentTeacherProfile = data;
    return { client, user, profile: data };
  }

  async function handleUnavailableTeacher(client = getSupabaseClient()) {
    if (teacherAccountUnavailable) return;
    teacherAccountUnavailable = true;
    window.__currentTeacherProfile = null;
    clearTemporaryRegistrationDraft();
    try {
      const { error } = await client.auth.signOut();
      if (error) {
        console.error("Unable to sign out after teacher account removal.", error);
      }
    } catch (error) {
      console.error("Unable to sign out after teacher account removal.", error);
    }
    redirectToLogin();
  }

  function requireTeacher() {
    if (teacherValidationPromise) return teacherValidationPromise;
    const validation = validateTeacherAccount();
    teacherValidationPromise = validation.finally(() => {
      if (teacherValidationPromise === wrappedValidation) {
        teacherValidationPromise = null;
      }
    });
    const wrappedValidation = teacherValidationPromise;
    return wrappedValidation;
  }

  async function loadCurrentTeacherProfile() {
    const teacher = await requireTeacher();
    if (!teacher) {
      throw Object.assign(new Error("The teacher account is unavailable."), {
        code: "TEACHER_UNAVAILABLE",
      });
    }
    return teacher;
  }

  function normalizeAcademicStream(value) {
    return window.SubjectService?.normalizeStream(value) || String(value || "").trim().toLowerCase();
  }

  async function loadRegisteredTeachingScope(client, teacherId) {
    if (!window.SubjectService) {
      throw new Error("The shared subject service did not load.");
    }
    return window.SubjectService.getTeacherTeachingScope(client, teacherId);
  }

  async function updateCurrentTeacherProfile(changes) {
    const { client, user, profile } = await loadCurrentTeacherProfile();
    const updates = Object.fromEntries(
      Object.entries(changes).filter(([key]) => PROFILE_FIELDS.has(key)),
    );
    if (Object.prototype.hasOwnProperty.call(updates, "languages")) {
      updates.languages = await resolveTeacherLanguageIds(client, updates.languages);
    }
    if (!profile?.id || !Object.keys(updates).length) {
      throw new Error("No valid teacher profile changes were provided.");
    }
    const { data, error } = await client
      .from("teachers")
      .update(updates)
      .eq("id", profile.id)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw error;

    window.__currentTeacherProfile = data;
    return data;
  }

  async function loadCurrentTeacherSettings() {
    const { client, profile } = await loadCurrentTeacherProfile();
    if (!profile?.id) {
      throw new Error("The teacher profile is unavailable.");
    }

    return loadTeacherSettingsForProfile(client, profile);
  }

  async function loadTeacherSettingsForProfile(client, profile) {
    const { data, error } = await client
      .from("teacher_settings")
      .select("*")
      .eq("teacher_id", profile.id)
      .maybeSingle();
    if (error) {
      logSupabaseFailure("Teacher settings SELECT", error);
      throw error;
    }
    if (data) return data;

    const { data: created, error: createError } = await client
      .from("teacher_settings")
      .insert({ teacher_id: profile.id, time_format: "12h" })
      .select("*")
      .single();
    if (!createError) return created;
    if (createError.code !== "23505") {
      logSupabaseFailure("Teacher settings initialization INSERT", createError);
      throw createError;
    }

    const { data: existing, error: lookupError } = await client
      .from("teacher_settings")
      .select("*")
      .eq("teacher_id", profile.id)
      .maybeSingle();
    if (lookupError) {
      logSupabaseFailure("Teacher settings duplicate recovery SELECT", lookupError);
      throw lookupError;
    }
    if (!existing) throw createError;
    return existing;
  }

  async function updateCurrentTeacherSettings(changes) {
    const { client, profile } = await loadCurrentTeacherProfile();
    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes) ||
      Object.keys(changes).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(changes, "time_format") ||
      !["12h", "24h"].includes(changes.time_format)
    ) {
      throw new Error("Only a valid time_format preference can be updated.");
    }

    await loadTeacherSettingsForProfile(client, profile);
    const { data, error } = await client
      .from("teacher_settings")
      .update({ time_format: changes.time_format })
      .eq("teacher_id", profile.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function updateCurrentTeacherTimezone(timezone) {
    const { client, profile } = await loadCurrentTeacherProfile();
    let validTimezone = false;
    if (typeof timezone === "string" && timezone.trim()) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
        validTimezone = true;
      } catch {
        validTimezone = false;
      }
    }
    if (!validTimezone) throw new Error("Choose a valid IANA timezone.");

    await loadTeacherSettingsForProfile(client, profile);
    const { data, error } = await client
      .from("teacher_settings")
      .update({ timezone })
      .eq("teacher_id", profile.id)
      .select("timezone")
      .single();
    if (error) throw error;
    return data;
  }

  async function uploadTeacherProfilePhoto(file) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      throw new Error("Choose a JPG, PNG, or WEBP image.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Profile images must be 5 MB or smaller.");
    }

    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    const user = await getAuthenticatedUser(client);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/profile-${Date.now()}.${extension}`;
    const { error } = await client.storage
      .from("teacher-profile-images")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return path;
  }

  async function deleteTeacherProfilePhoto(path) {
    const client = getSupabaseClient();
    if (!client || !path) return;
    const user = await getAuthenticatedUser(client);
    if (path.startsWith(`${user.id}/`)) {
      const { error } = await client.storage
        .from("teacher-profile-images")
        .remove([path]);
      if (error) throw error;
    }
  }

  async function getTeacherProfilePhotoUrl(path) {
    if (!path) return "";
    if (/^https:\/\//i.test(path)) return path;
    const { data, error } = await getSupabaseClient()
      .storage.from("teacher-profile-images")
      .createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function updateAuthEmail(email) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    const user = await getAuthenticatedUser(client);
    const newEmail = typeof email === "string" ? email.trim() : "";
    if (!newEmail) {
      throw new Error("Enter a new email address.");
    }
    const currentEmail = String(user.email || "").trim();
    const differsFromAuthenticatedEmail =
      newEmail.toLowerCase() !== currentEmail.toLowerCase();
    console.info("[TeacherData] Auth email argument verification:", {
      hasValue: Boolean(newEmail),
      differsFromAuthenticatedEmail,
    });
    if (!differsFromAuthenticatedEmail) {
      throw new Error("Enter a new email address different from your current email.");
    }

    const payload = { email: newEmail };
    const emailRedirectTo = new URL(
      "../confirm-email-update.html",
      window.location.href,
    ).href;
    const { data, error } = await client.auth.updateUser(payload, {
      emailRedirectTo,
    });
    if (error) {
      console.error("[TeacherData] Supabase Auth email update failed.", {
        name: error?.name || "SupabaseError",
        code: error?.code || null,
        status: error?.status || null,
        message: String(error?.message || "Unknown error").replace(
          /[^\s"<>]+@[^\s"<>]+/g,
          "[redacted email]",
        ),
      });
      throw error;
    }
    return data;
  }

  async function verifyAuthEmailUpdate(tokenHash) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    if (typeof tokenHash !== "string" || !tokenHash.trim()) {
      throw new Error("The email confirmation token is missing.");
    }

    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email_change",
    });
    if (error) throw error;
    if (!data?.user || !data?.session) {
      throw new Error("Supabase did not return a confirmed user session.");
    }
    return data.user;
  }

  async function getAuthenticatedTeacherEmailSyncState() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user?.id || !user.email) {
      throw new Error("The verified Auth user email could not be loaded.");
    }
    if (!user.email_confirmed_at && !user.confirmed_at) {
      throw new Error("The Auth email has not been confirmed.");
    }

    const { data: teacher, error: lookupError } = await client
      .from("teachers")
      .select("email")
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError) {
      throw Object.assign(new Error(lookupError.message), {
        code: "TEACHER_EMAIL_LOOKUP_FAILED",
        cause: lookupError,
      });
    }
    if (!teacher) {
      throw Object.assign(
        new Error("No teacher profile is associated with the authenticated user."),
        { code: "TEACHER_EMAIL_LOOKUP_FAILED" },
      );
    }

    return {
      user,
      needsSync:
        String(teacher.email || "").trim().toLowerCase() !==
        user.email.trim().toLowerCase(),
    };
  }

  async function syncAuthenticatedTeacherEmail() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user?.id || !user.email) {
      throw new Error("The verified Auth user email could not be loaded.");
    }
    if (!user.email_confirmed_at && !user.confirmed_at) {
      throw new Error("The Auth email has not been confirmed.");
    }

    const { data, error } = await client
      .from("teachers")
      .update({ email: user.email })
      .eq("user_id", user.id)
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!data || data.user_id !== user.id) {
      throw new Error("The teacher email record could not be synchronized.");
    }

    return user;
  }

  async function updateAuthPassword(password) {
    const client = getSupabaseClient();
    await getAuthenticatedUser(client);
    const { data, error } = await client.auth.updateUser({ password });
    if (error) throw error;
    return data;
  }

  function watchAuthState(onSignedOut) {
    const client = getSupabaseClient();
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "USER_DELETED") {
        window.__currentTeacherProfile = null;
        onSignedOut?.();
      }
    });
    return () => data.subscription.unsubscribe();
  }

  const teacherRealtimeChannels = new Map();

  function notifyTeacherRealtimeStatus(listener, status, error, topic) {
    try {
      listener.onStatus?.(status, error);
    } catch (statusError) {
      console.error("A teacher Realtime status callback failed.", {
        topic,
        message: statusError?.message || "Unknown callback error",
      });
    }
  }

  function subscribeToTeacherRealtime(key, topic, filter, callback, onStatus) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");

    let subscription = teacherRealtimeChannels.get(key);
    if (!subscription) {
      const listeners = new Set();
      subscription = { channel: null, listeners, status: null, error: null };
      const channel = client
        .channel(topic)
        .on(
          "postgres_changes",
          filter,
          (payload) => {
            for (const listener of [...listeners]) {
              try {
                listener.callback(payload);
              } catch (error) {
                console.error("A teacher Realtime callback failed.", error);
              }
            }
          },
        )
        .subscribe((status, error) => {
          subscription.status = status;
          subscription.error = error || null;
          if (status !== "SUBSCRIBED") {
            console.warn("Teacher Realtime subscription status.", {
              topic,
              status,
              errorName: error?.name || null,
              errorCode: error?.code || null,
              httpStatus: error?.status || null,
              closeCode: error?.closeCode || error?.reason?.code || null,
              closeReason: error?.reason?.message || error?.reason || null,
              message: typeof error === "string"
                ? error
                : error?.message || "No additional error details.",
              details: error?.details || null,
            });
          }
          for (const listener of [...listeners]) {
            notifyTeacherRealtimeStatus(listener, status, error, topic);
          }
        });
      subscription.channel = channel;
      teacherRealtimeChannels.set(key, subscription);
    }

    const listener = { callback, onStatus };
    subscription.listeners.add(listener);
    if (subscription.status) {
      notifyTeacherRealtimeStatus(
        listener,
        subscription.status,
        subscription.error,
        topic,
      );
    }
    let active = true;
    return {
      unsubscribe() {
        if (!active) return;
        active = false;
        subscription.listeners.delete(listener);
        if (subscription.listeners.size) return;
        if (teacherRealtimeChannels.get(key) === subscription) {
          teacherRealtimeChannels.delete(key);
        }
        void client.removeChannel(subscription.channel).catch((error) => {
          console.error("Unable to remove a teacher Realtime channel.", error);
        });
      },
    };
  }

  function subscribeToTeacherProfile(teacherId, callback, onStatus) {
    return subscribeToTeacherRealtime(
      `teacher-profile-${teacherId}`,
      `teacher-profile-${teacherId}`,
      {
        event: "*",
        schema: "public",
        table: "teachers",
        filter: `id=eq.${teacherId}`,
      },
      callback,
      onStatus,
    );
  }

  function subscribeToTeacherSettings(teacherId, callback, onStatus) {
    return subscribeToTeacherRealtime(
      `teacher-settings-${teacherId}`,
      `teacher-settings-${teacherId}`,
      {
        event: "*",
        schema: "public",
        table: "teacher_settings",
        filter: `teacher_id=eq.${teacherId}`,
      },
      callback,
      onStatus,
    );
  }

  function getRegistrationAssignments(professional) {
    return Array.isArray(professional.specialistAssignments)
      ? professional.specialistAssignments
      : [];
  }

  async function saveToSupabase(data) {
    const client = getSupabaseClient();
    if (!client) return { saved: false, reason: "not-configured" };

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) {
      return { saved: false, reason: "not-authenticated" };
    }

    let profilePhotoUrl = data.personal.profilePhotoUrl || null;
    const profilePhotoData = data.personal.profilePhotoData || data.personal.profilePhoto;
    let uploadedPhotoPath = null;
    if (typeof profilePhotoData === "string" && profilePhotoData.startsWith("data:image/")) {
      const photo = await fetch(profilePhotoData).then((response) => response.blob());
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
        throw new Error("Choose a JPG, PNG, or WEBP profile image.");
      }
      if (photo.size > 5 * 1024 * 1024) {
        throw new Error("Profile images must be 5 MB or smaller.");
      }
      const extension = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      uploadedPhotoPath = `${authData.user.id}/profile-${Date.now()}.${extension}`;
      const { error: uploadError } = await client.storage
        .from("teacher-profile-images")
        .upload(uploadedPhotoPath, photo, { contentType: photo.type });
      if (uploadError) throw uploadError;
      profilePhotoUrl = uploadedPhotoPath;
    }

    const teacher = {
      user_id: authData.user.id,
      full_name: data.personal.fullName,
      phone_number: data.personal.phone,
      date_of_birth: data.personal.dob || null,
      gender: data.personal.gender,
      country: data.personal.country,
      state: data.personal.state,
      city: data.personal.city,
      address: data.personal.address,
      profile_photo_url: profilePhotoUrl,
      bio: data.personal.bio || null,
      employment_status: data.professional.employmentStatus,
      institution_name: data.professional.institutionName,
      institution_type: data.professional.institutionType,
      years_experience: data.professional.experienceYears || null,
      highest_qualification: data.professional.highestQualification,
      languages: await resolveTeacherLanguageIds(client, data.professional.languages),
      teaching_mode: data.professional.teachingMode,
      grades: data.professional.grades || [],
      streams: data.professional.streams || [],
      teacher_id: data.teacherId,
    };

    const { data: existingTeacher, error: lookupError } = await client
      .from("teachers")
      .select("id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const teacherUpdate = { ...teacher };
    delete teacherUpdate.user_id;
    delete teacherUpdate.teacher_id;
    delete teacherUpdate.grades;
    delete teacherUpdate.streams;
    const teacherWrite = existingTeacher
      ? client
          .from("teachers")
          .update(teacherUpdate)
          .eq("id", existingTeacher.id)
          .eq("user_id", authData.user.id)
      : client
          .from("teachers")
          .insert({ id: authData.user.id, ...teacher });
    const { data: teacherRecord, error: teacherError } = await teacherWrite
      .select("id")
      .single();

    if (teacherError) {
      if (uploadedPhotoPath) {
        await client.storage.from("teacher-profile-images").remove([uploadedPhotoPath]);
      }
      throw teacherError;
    }

    const assignments = getRegistrationAssignments(data.professional);
    if (assignments.length) {
      const rows = assignments.flatMap((assignment) =>
        (assignment.grades || []).flatMap((grade) => {
          const subjects = assignment.subject
            ? [assignment.subject]
            : assignment.subjects || [];
          return subjects.map((subject) => ({
          teacher_id: teacherRecord.id,
          subject,
          grade: String(grade),
          }));
        }),
      );
      if (rows.length) {
        const { error: subjectsError } = await client
          .from("teacher_subjects")
          .upsert(rows, { onConflict: "teacher_id,subject,grade" });
        if (subjectsError) throw subjectsError;
      }
    }

    return { saved: true };
  }

  window.TeacherData = {
    getTeacherData,
    saveTeacherData,
    getSupabaseClient,
    saveToSupabase,
    requireTeacher,
    handleUnavailableTeacher,
    loadCurrentTeacherProfile,
    loadRegisteredTeachingScope,
    loadTeacherLanguageCatalog,
    resolveTeacherLanguageIds,
    resolveTeacherLanguageNames,
    updateCurrentTeacherProfile,
    loadCurrentTeacherSettings,
    updateCurrentTeacherSettings,
    updateCurrentTeacherTimezone,
    uploadTeacherProfilePhoto,
    deleteTeacherProfilePhoto,
    getTeacherProfilePhotoUrl,
    updateAuthEmail,
    verifyAuthEmailUpdate,
    getAuthenticatedTeacherEmailSyncState,
    syncAuthenticatedTeacherEmail,
    updateAuthPassword,
    watchAuthState,
    subscribeToTeacherProfile,
    subscribeToTeacherSettings,
  };
})();
