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
    const step1 = { ...emptyStep1, ...(source.step1 || {}) };
    delete step1.password;
    delete step1.confirmPassword;
    return {
      step1,
      step2: { ...emptyStep2, ...(source.step2 || {}) },
      confirmed: Boolean(source.confirmed),
    };
  }

  function getRegistrationDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) {
        return normalizeDraft({});
      }
      return normalizeDraft(JSON.parse(raw));
    } catch (error) {
      console.warn("Registration draft could not be parsed.", error);
      return normalizeDraft({});
    }
  }

  function saveRegistrationDraft(draft) {
    const normalized = normalizeDraft(draft);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(normalized));
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
    sessionStorage.removeItem(DRAFT_KEY);
    [
      "teacherPersonalInfo",
      "teacherProfessionalInfo",
      "teacherProfilePhotoName",
      "teacherId",
      "teacherRegistrationNeedsLogin",
    ].forEach((key) => sessionStorage.removeItem(key));
    return true;
  }

  function clearPasswordFromDraft() {
    const draft = getRegistrationDraft();
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
