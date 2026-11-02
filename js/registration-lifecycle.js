(() => {
  const NAVIGATION_KEY = "smartLearningRegistrationNavigation";
  const SECRET_PREFIX = "__smartLearningRegistrationHandoff__:";
  const path = window.location.pathname.toLowerCase();
  const workflow = path.includes("/student_registration/")
    ? "student"
    : path.includes("/teacher_registration/")
      ? "teacher"
      : "";

  if (!workflow) return;

  let secrets = {};
  let pendingNavigation = null;
  try {
    pendingNavigation = JSON.parse(sessionStorage.getItem(NAVIGATION_KEY) || "null");
  } catch (error) {
    console.warn("Registration navigation state could not be read.", error);
  }
  const handoff = pendingNavigation?.workflow === workflow
    && pendingNavigation.targetPath === path;
  sessionStorage.removeItem(NAVIGATION_KEY);

  if (typeof window.name === "string" && window.name.startsWith(SECRET_PREFIX)) {
    try {
      const payload = JSON.parse(window.name.slice(SECRET_PREFIX.length));
      if (handoff && payload.workflow === workflow && payload.secrets) {
        secrets = payload.secrets;
      }
    } catch (error) {
      console.warn("Registration handoff data could not be read.", error);
    }
    window.name = "";
  }

  function clearDraft() {
    if (workflow === "student") {
      window.StudentData?.clearStudentDraft?.();
    } else {
      window.TeacherRegistrationStorage?.clearRegistrationDraft?.();
    }
  }

  function clearSecrets() {
    secrets = {};
    if (window.name.startsWith(SECRET_PREFIX)) window.name = "";
  }

  function clear() {
    clearDraft();
    sessionStorage.removeItem(NAVIGATION_KEY);
    clearSecrets();
  }

  if (!handoff) {
    clearDraft();
    const firstStep = workflow === "student"
      ? path.endsWith("/personal_details.html")
      : path.endsWith("/teacher_personal.html");
    if (!firstStep) {
      const startPage = workflow === "student"
        ? "personal_details.html"
        : "teacher_personal.html";
      window.location.replace(new URL(startPage, window.location.href).href);
      return;
    }
    const forms = [...document.querySelectorAll("form")];
    forms.forEach((form) => form.reset());
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) forms.forEach((form) => form.reset());
    });
  }

  function isWorkflowUrl(url) {
    if (url.origin !== window.location.origin) return false;
    return url.pathname.toLowerCase().includes(`/${workflow}_registration/`);
  }

  function navigate(target, nextSecrets) {
    const url = new URL(target, window.location.href);
    if (!isWorkflowUrl(url)) return;
    if (nextSecrets) {
      secrets = {
        password: String(nextSecrets.password || ""),
        confirmPassword: String(nextSecrets.confirmPassword || ""),
      };
    }
    sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify({
      workflow,
      targetPath: url.pathname.toLowerCase(),
    }));
    window.name = `${SECRET_PREFIX}${JSON.stringify({ workflow, secrets })}`;
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (isWorkflowUrl(url)) navigate(url.href);
  }, true);

  function clearIfAbandoned() {
    let navigation = null;
    try {
      navigation = JSON.parse(sessionStorage.getItem(NAVIGATION_KEY) || "null");
    } catch (error) {
      console.warn("Registration navigation state could not be read.", error);
    }
    if (navigation?.workflow !== workflow || navigation.targetPath === path) clear();
  }

  window.addEventListener("beforeunload", clearIfAbandoned);
  window.addEventListener("pagehide", clearIfAbandoned);

  window.RegistrationLifecycle = {
    clear,
    getSecrets: () => ({ ...secrets }),
    navigate,
  };
})();
