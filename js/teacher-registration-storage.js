(function () {
  const DRAFT_KEY = "smartLearningTeacherRegistration";

  const emptyStep1 = {
    fullName: "",
    email: "",
    countryCode: "+91",
    phoneNumber: "",
    dateOfBirth: "",
    gender: "",
    country: "",
    state: "",
    city: "",
    password: "",
    confirmPassword: "",
    address: "",
    profilePhoto: null,
    profilePhotoName: "",
  };

  const emptyStep2 = {
    employmentStatus: "",
    institutionName: "",
    institutionType: "",
    yearsExperience: "",
    highestQualification: "",
    degreeCourse: "",
    specialization: "",
    universityCollege: "",
    graduationYear: "",
    teachingMode: "",
    gradeGroups: [],
    selectedGrades: [],
    streams: [],
    subjects: [],
    subjectAssignments: [],
    languages: [],
  };

  function normalizeDraft(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      step1: { ...emptyStep1, ...(source.step1 || {}) },
      step2: { ...emptyStep2, ...(source.step2 || {}) },
      confirmed: Boolean(source.confirmed),
    };
  }

  function getRegistrationDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        const draft = normalizeDraft({});
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        return draft;
      }
      return normalizeDraft(JSON.parse(raw));
    } catch (error) {
      console.warn("Registration draft could not be parsed.", error);
      const draft = normalizeDraft({});
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return draft;
    }
  }

  function saveRegistrationDraft(draft) {
    const normalized = normalizeDraft(draft);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function updateStep1(partial) {
    const draft = getRegistrationDraft();
    draft.step1 = { ...draft.step1, ...partial };
    return saveRegistrationDraft(draft);
  }

  function updateStep2(partial) {
    const draft = getRegistrationDraft();
    draft.step2 = { ...draft.step2, ...partial };
    return saveRegistrationDraft(draft);
  }

  function clearRegistrationDraft() {
    localStorage.removeItem(DRAFT_KEY);
    [
      "teacherPersonalInfo",
      "teacherProfessionalInfo",
      "teacherProfilePhotoName",
    ].forEach((key) => sessionStorage.removeItem(key));
    return true;
  }

  function clearPasswordFromDraft() {
    const draft = getRegistrationDraft();
    draft.step1.password = "";
    draft.step1.confirmPassword = "";
    saveRegistrationDraft(draft);
  }

  function getDraftValue(path, fallback = "") {
    const draft = getRegistrationDraft();
    const segments = path.split(".");
    let value = draft;
    for (const segment of segments) {
      if (!value || typeof value !== "object" || !(segment in value)) {
        return fallback;
      }
      value = value[segment];
    }
    return value ?? fallback;
  }

  window.TeacherRegistrationStorage = {
    DRAFT_KEY,
    getRegistrationDraft,
    saveRegistrationDraft,
    updateStep1,
    updateStep2,
    clearRegistrationDraft,
    clearPasswordFromDraft,
    getDraftValue,
  };
})();
