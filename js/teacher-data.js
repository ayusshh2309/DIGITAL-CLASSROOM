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

  const DEFAULT_SETTINGS = {
    language: "English",
    timezone: "Asia/Kolkata",
    date_format: "DD MMM YYYY",
    time_format: "12h",
    week_start_day: "Monday",
    auto_save: true,
    email_notifications: true,
    sound_notifications: true,
    compact_view: false,
    show_tips: true,
  };

  const PROFILE_FIELDS = new Set([
    "full_name",
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
    "languages",
    "employment_status",
    "institution_name",
    "institution_type",
    "years_experience",
    "teaching_mode",
  ]);

  async function getAuthenticatedUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
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
    if (authError) throw authError;
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
    if (error) throw error;
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

  async function updateCurrentTeacherProfile(changes) {
    const { client, user } = await loadCurrentTeacherProfile();
    const updates = Object.fromEntries(
      Object.entries(changes).filter(([key]) => PROFILE_FIELDS.has(key)),
    );
    const { data, error } = await client
      .from("teachers")
      .update(updates)
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

    const { data, error } = await client
      .from("teacher_settings")
      .select("*")
      .eq("teacher_id", profile.id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;

    const { data: created, error: createError } = await client
      .from("teacher_settings")
      .upsert(
        { teacher_id: profile.id, ...DEFAULT_SETTINGS },
        { onConflict: "teacher_id" },
      )
      .select("*")
      .single();
    if (createError) throw createError;
    return created;
  }

  async function updateCurrentTeacherSettings(changes) {
    const { client, profile } = await loadCurrentTeacherProfile();
    const updates = Object.fromEntries(
      Object.entries(changes).filter(([key]) => key in DEFAULT_SETTINGS),
    );
    const { data, error } = await client
      .from("teacher_settings")
      .upsert(
        { teacher_id: profile.id, ...updates },
        { onConflict: "teacher_id" },
      )
      .select("*")
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
    await getAuthenticatedUser(client);
    const { data, error } = await client.auth.updateUser({ email });
    if (error) throw error;
    return data;
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

  function subscribeToTeacherProfile(userId, callback) {
    return getSupabaseClient()
      .channel(`teacher-profile-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teachers", filter: `user_id=eq.${userId}` },
        callback,
      )
      .subscribe();
  }

  function subscribeToTeacherSettings(teacherId, callback) {
    return getSupabaseClient()
      .channel(`teacher-settings-${teacherId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teacher_settings", filter: `teacher_id=eq.${teacherId}` },
        callback,
      )
      .subscribe();
  }

  function getRegistrationAssignments(professional) {
    const specialistAssignments = professional.specialistAssignments || [];
    if (specialistAssignments.length) return specialistAssignments;

    const gradeGroups = {
      grades_5_6: [5, 6],
      grades_7_8: [7, 8],
      grades_9_10: [9, 10],
      grades_11_12: [11, 12],
    };
    const standardSubjects = {
      5: ["English", "Mathematics", "EVS", "Hindi"],
      6: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      7: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      8: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      9: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      10: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    const streamSubjects = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts_humanities: ["History", "Geography", "Political Science", "Psychology"],
    };
    const grades = [
      ...(professional.grades || professional.selected_grades || []),
      ...(professional.selected_grade_groups || []).flatMap((group) => gradeGroups[group] || []),
    ].map(String);
    const subjects = professional.subjects || professional.selected_subjects || [];
    const streams = professional.streams || professional.selected_streams || [];

    return grades.map((grade) => ({
      subject: null,
      grades: [grade],
      subjects: subjects.length
        ? subjects
        : Number(grade) >= 11
          ? [...new Set(streams.flatMap((stream) => streamSubjects[stream] || []).concat(["English", "Physical Education", "Computer Science"]))]
          : standardSubjects[Number(grade)] || [],
    }));
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
      languages: data.professional.languages || [],
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
    updateCurrentTeacherProfile,
    loadCurrentTeacherSettings,
    updateCurrentTeacherSettings,
    uploadTeacherProfilePhoto,
    deleteTeacherProfilePhoto,
    getTeacherProfilePhotoUrl,
    updateAuthEmail,
    updateAuthPassword,
    watchAuthState,
    subscribeToTeacherProfile,
    subscribeToTeacherSettings,
  };
})();
