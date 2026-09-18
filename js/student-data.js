(function () {
  const DRAFT_KEY = "studentRegistrationData";
  const PROFILE_KEY = "studentProfile";
  const FINAL_KEY = "finalStudentRegistration";

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

  function getStudentDraft() {
    return readJson(localStorage, DRAFT_KEY, {}) || {};
  }

  function saveStudentDraft(data) {
    const nextDraft = {
      ...getStudentDraft(),
      ...data,
    };

    writeJson(localStorage, DRAFT_KEY, nextDraft);

    return nextDraft;
  }

  function clearStudentDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function getStudentProfile() {
    return (
      readJson(localStorage, PROFILE_KEY, null) ||
      readJson(localStorage, FINAL_KEY, null) ||
      readJson(sessionStorage, FINAL_KEY, null) ||
      getStudentDraft()
    );
  }

  function saveStudentProfile(data) {
    const nextProfile = {
      ...getStudentProfile(),
      ...data,
      registrationStatus: "completed",
      createdAt: new Date().toISOString(),
    };

    writeJson(localStorage, PROFILE_KEY, nextProfile);
    writeJson(localStorage, "studentData", nextProfile);
    writeJson(sessionStorage, FINAL_KEY, nextProfile);

    return nextProfile;
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
    saveStudentProfile,
    clearStudentProfile,
    clearStudentRegistration,
  };
})();
