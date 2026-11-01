(() => {
  const layoutHost = document.getElementById("studentLayout");
  if (!layoutHost) return;

  const componentUrl = new URL("../components/student-layout.html", window.location.href);
  const page = window.location.pathname.split("/").pop() || "st_dashboard.html";

  async function loadStudentAnnouncements() {
    if (!window.supabase?.createClient) {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }
    if (!window.SmartLearningSupabase) {
      await loadScript(new URL("../js/supabase.js", window.location.href).href);
    }
    await loadScript(new URL("../js/student-announcements.js", window.location.href).href);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.src === src);
      if (existing) {
        if (existing.dataset.loaded === "true") return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    });
  }

  function addRegistrationContext(pageContent) {
    if (!pageContent || pageContent.querySelector("#registrationContext")) return;

    const profileKeys = [
      "studentProfile",
      "studentData",
      "finalStudentRegistration",
      "studentRegistrationData",
    ];
    let profile = null;
    for (const key of profileKeys) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (
          value &&
          typeof value === "object" &&
          (value.classGrade ||
            value.class_grade ||
            value.grade ||
            value.academic?.grade)
        ) {
          profile = value;
          break;
        }
      } catch (error) {
        console.warn(`Unable to read student registration from ${key}.`, error);
      }
    }
    if (!profile) return;

    const grade = String(
      profile.classGrade ??
        profile.class_grade ??
        profile.grade ??
        profile.academic?.grade ??
        "",
    ).match(/\d+/)?.[0];
    if (!grade) return;

    const stream = String(
      profile.stream ??
        profile.classStream ??
        profile.class_stream ??
        profile.academic?.stream ??
        "",
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
    };

    const context = document.createElement("div");
    context.className = "student-registration-context";
    context.setAttribute("aria-label", "Your registered curriculum");

    const label = document.createElement("span");
    label.className = "student-registration-context-label";
    label.textContent = "Your registered curriculum";

    const value = document.createElement("span");
    value.className = "student-registration-context-value";

    const icon = document.createElement("i");
    icon.className = "fa-solid fa-graduation-cap";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    const curriculum = Number(grade) >= 11
      ? `Grade ${grade} - ${streamLabels[stream] || "Selected stream"}`
      : `Grade ${grade}`;
    text.textContent = curriculum;

    value.append(icon, text);
    context.append(label, value);
    pageContent.prepend(context);
  }

  if (!document.querySelector('link[data-student-layout-icons="font-awesome"]')) {
    const iconStylesheet = document.createElement("link");
    iconStylesheet.rel = "stylesheet";
    iconStylesheet.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
    iconStylesheet.dataset.studentLayoutIcons = "font-awesome";
    document.head.appendChild(iconStylesheet);
  }

  if (!document.querySelector('link[data-smart-learning-theme="global"]')) {
    const themeStylesheet = document.createElement("link");
    themeStylesheet.rel = "stylesheet";
    themeStylesheet.href = "../css/theme.css";
    themeStylesheet.dataset.smartLearningTheme = "global";
    document.head.appendChild(themeStylesheet);
  }

  fetch(componentUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Student layout request failed: ${response.status}`);
      return response.text();
    })
    .then((html) => {
      const pageContent = document.querySelector("body > main, body > .page, body > .main, body > .notes-page, body > .quiz-page, body > .main-content");
      layoutHost.innerHTML = html;
      const mainContent = document.getElementById("studentMainContent");

      if (pageContent && mainContent) {
        pageContent.classList.add("student-page-content");
        mainContent.appendChild(pageContent);
        addRegistrationContext(pageContent);
      }

      document.querySelectorAll(".student-nav-link[data-page]").forEach((link) => {
        link.classList.toggle("active", link.dataset.page === page);
      });

      const menuToggle = document.getElementById("studentMenuToggle");
      menuToggle?.addEventListener("click", () => {
        const isOpen = document.body.classList.toggle("student-sidebar-open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
      });

      document.querySelectorAll(".student-nav-link").forEach((link) => {
        link.addEventListener("click", () => document.body.classList.remove("student-sidebar-open"));
      });

      document.getElementById("studentLogout")?.addEventListener("click", () => {
        ["studentProfile", "learnerProfile", "studentData"].forEach((key) => localStorage.removeItem(key));
      });
      loadStudentAnnouncements().catch((error) => {
        console.error("Unable to initialize student announcements.", error);
      });
    })
    .catch((error) => console.error("Unable to load shared student dashboard layout.", error));
})();
