(function () {
  const DRAFT_KEY = "smartLearningTeacherRegistration";

  function getDraft() {
    return window.TeacherRegistrationStorage?.getRegistrationDraft?.() || { step1: {}, step2: {}, confirmed: false };
  }

  function saveDraft(draft) {
    return window.TeacherRegistrationStorage?.saveRegistrationDraft?.(draft) || draft;
  }

  function updateStep1(values) {
    return window.TeacherRegistrationStorage?.updateStep1?.(values) || values;
  }

  function updateStep2(values) {
    return window.TeacherRegistrationStorage?.updateStep2?.(values) || values;
  }

  function clearDraft() {
    return window.TeacherRegistrationStorage?.clearRegistrationDraft?.();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function isValidPhoneNumber(value) {
    const cleaned = String(value || "").replace(/\s+/g, "");
    return /^\+?[0-9]{7,15}$/.test(cleaned);
  }

  function isPasswordValid(password) {
    return typeof password === "string" && password.length >= 8;
  }

  function renderNotProvided(value, fallback = "Not provided") {
    if (value === undefined || value === null || value === "" || value === "null" || value === "undefined") return fallback;
    return value;
  }

  function buildTeacherId() {
    const year = new Date().getFullYear();
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    return `TCH-${year}-${randomNumber}`;
  }

  function parseGradeGroups(values) {
    const list = Array.isArray(values) ? values : [];
    return list.filter(Boolean);
  }

  function parseLanguageList(values) {
    const list = Array.isArray(values) ? values : [];
    return list.filter(Boolean).map((language) => String(language).trim()).filter(Boolean);
  }

  function getSupabaseClient() {
    if (!window.SmartLearningSupabase?.getClient) return null;
    return window.SmartLearningSupabase.getClient();
  }

  window.TeacherRegistration = {
    DRAFT_KEY,
    getDraft,
    saveDraft,
    updateStep1,
    updateStep2,
    clearDraft,
    isValidEmail,
    isValidPhoneNumber,
    isPasswordValid,
    renderNotProvided,
    buildTeacherId,
    parseGradeGroups,
    parseLanguageList,
    getSupabaseClient,
  };
})();
