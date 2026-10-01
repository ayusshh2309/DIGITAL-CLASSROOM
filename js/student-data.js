(function () {
  const DRAFT_KEY = "smartLearningStudentRegistration";
  const PROFILE_KEY = "studentProfile";
  const FINAL_KEY = "finalStudentRegistration";
  const LEGACY_DRAFT_KEYS = [
    "studentRegistrationData",
    "studentPersonalInfo",
    "studentAcademicInfo",
  ];

  function readJson(storage, key, fallback) {
    try {
      const value = storage.getItem(key);
      if (!value) return fallback;
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch (error) {
      console.warn(`Could not read ${key}.`, error);
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function removeLegacyPasswords(storage, key) {
    const profile = readJson(storage, key, null);
    if (!profile || typeof profile !== "object") return;
    if (!Object.hasOwn(profile, "password") && !Object.hasOwn(profile, "confirmPassword")) return;
    delete profile.password;
    delete profile.confirmPassword;
    writeJson(storage, key, profile);
  }

  ["studentProfile", "studentData", "finalStudentRegistration"].forEach((key) => {
    removeLegacyPasswords(localStorage, key);
    removeLegacyPasswords(sessionStorage, key);
  });

  function getStudentDraft() {
    const sessionDraft = readJson(sessionStorage, DRAFT_KEY, {});
    const legacyDraft = LEGACY_DRAFT_KEYS.reduce((result, key) => ({
      ...result,
      ...(readJson(localStorage, key, {}) || {}),
    }), {});
    const draft = { ...legacyDraft, ...sessionDraft };
    if (Object.keys(draft).length) writeJson(sessionStorage, DRAFT_KEY, draft);
    LEGACY_DRAFT_KEYS.forEach((key) => localStorage.removeItem(key));
    return draft;
  }

  function saveStudentDraft(data) {
    const nextDraft = {
      ...getStudentDraft(),
      ...data,
    };

    writeJson(sessionStorage, DRAFT_KEY, nextDraft);

    return nextDraft;
  }

  function clearStudentDraft() {
    sessionStorage.removeItem(DRAFT_KEY);
    LEGACY_DRAFT_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }

  function getStudentProfile() {
    const profile =
      readJson(localStorage, PROFILE_KEY, null) ||
      readJson(localStorage, FINAL_KEY, null) ||
      readJson(sessionStorage, FINAL_KEY, null);
    if (!profile || typeof profile !== "object") return null;
    const sanitized = { ...profile };
    delete sanitized.password;
    delete sanitized.confirmPassword;
    return sanitized;
  }

  function clearStudentProfile() {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(FINAL_KEY);
    localStorage.removeItem("studentData");
  }

  function clearStudentRegistration() {
    clearStudentDraft();
    clearStudentProfile();
  }

  window.StudentData = {
    DRAFT_KEY,
    PROFILE_KEY,
    FINAL_KEY,
    getStudentDraft,
    saveStudentDraft,
    clearStudentDraft,
    getStudentProfile,
    clearStudentProfile,
    clearStudentRegistration,
  };
})();
