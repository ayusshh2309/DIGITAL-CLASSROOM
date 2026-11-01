(() => {
  const layoutHost = document.getElementById("studentLayout");
  if (!layoutHost) return;

  const componentUrl = new URL("../components/student-layout.html", window.location.href);
  const page = window.location.pathname.split("/").pop() || "st_dashboard.html";
  let studentProfileChannel = null;

  async function loadStudentAnnouncements() {
    await loadStudentSupabaseClient();
    await loadScript(new URL("../js/student-announcements.js", window.location.href).href);
  }

  async function loadStudentSupabaseClient() {
    if (!window.supabase?.createClient) {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }
    if (!window.SmartLearningSupabase) {
      await loadScript(new URL("../js/supabase.js", window.location.href).href);
    }
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
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

  function initializeStudentSearch(pageContent) {
    const input = document.getElementById("studentSearchInput");
    const searchBox = input?.closest(".student-search");
    if (!input || !searchBox) return;

    const results = document.createElement("div");
    results.id = "studentSearchResults";
    results.className = "student-search-results";
    results.hidden = true;
    results.setAttribute("role", "listbox");
    searchBox.appendChild(results);

    let activeHighlight = null;
    let refreshTimer = null;
    const searchSelectors = [
      "section",
      "article",
      "[data-searchable]",
      ".card",
      '[class*="-card"]',
      "tr",
    ].join(",");

    function searchTargets() {
      const candidates = [...pageContent.querySelectorAll(searchSelectors)]
        .filter((element) => element.textContent.trim().length > 2);
      const leaves = candidates.filter(
        (element) => !candidates.some((candidate) =>
          candidate !== element && element.contains(candidate)),
      );
      return leaves.length ? leaves : [pageContent];
    }

    function targetLabel(element) {
      const heading = element.querySelector("[data-search-title], h1, h2, h3, h4, strong");
      const title = heading?.textContent.trim();
      if (title) return title;
      return element.textContent.trim().replace(/\s+/g, " ").slice(0, 72);
    }

    function appendHeading(text) {
      const heading = document.createElement("div");
      heading.className = "student-search-results-heading";
      heading.textContent = text;
      results.appendChild(heading);
    }

    function appendResult(title, description, onSelect) {
      const button = document.createElement("button");
      button.className = "student-search-result";
      button.type = "button";
      button.setAttribute("role", "option");
      const titleNode = document.createElement("strong");
      titleNode.textContent = title;
      const descriptionNode = document.createElement("small");
      descriptionNode.textContent = description;
      button.append(titleNode, descriptionNode);
      button.addEventListener("click", onSelect);
      results.appendChild(button);
    }

    function hideResults() {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }

    function updateResults() {
      const query = input.value.trim().toLocaleLowerCase();
      results.replaceChildren();
      if (!query) {
        hideResults();
        return;
      }

      const pageMatches = searchTargets()
        .map((element) => ({
          element,
          title: targetLabel(element),
          text: element.textContent.trim().replace(/\s+/g, " "),
        }))
        .filter((item) => item.text.toLocaleLowerCase().includes(query))
        .slice(0, 8);

      const navMatches = [...document.querySelectorAll(".student-nav-link[data-page]")]
        .filter((link) => link.textContent.toLocaleLowerCase().includes(query))
        .slice(0, 3);

      if (pageMatches.length) {
        appendHeading("This page");
        pageMatches.forEach(({ element, title, text }) => {
          appendResult(title, text.slice(0, 150), () => {
            activeHighlight?.classList.remove("student-search-target-highlight");
            activeHighlight = element;
            element.classList.add("student-search-target-highlight");
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            window.setTimeout(() => {
              element.classList.remove("student-search-target-highlight");
              if (activeHighlight === element) activeHighlight = null;
            }, 1800);
            hideResults();
          });
        });
      }

      if (navMatches.length) {
        appendHeading("Pages");
        navMatches.forEach((link) => {
          appendResult(link.textContent.trim(), "Open page", () => {
            window.location.assign(new URL(link.getAttribute("href"), window.location.href).href);
          });
        });
      }

      if (!pageMatches.length && !navMatches.length) {
        const empty = document.createElement("div");
        empty.className = "student-search-empty";
        empty.textContent = "No matching content or pages found.";
        results.appendChild(empty);
      }

      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    input.addEventListener("input", updateResults);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        updateResults();
        input.blur();
      } else if (event.key === "Enter" && !results.hidden) {
        results.querySelector(".student-search-result")?.click();
      } else if (event.key === "ArrowDown" && !results.hidden) {
        event.preventDefault();
        results.querySelector(".student-search-result")?.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!searchBox.contains(event.target)) hideResults();
    });

    const observer = new MutationObserver(() => {
      if (!input.value.trim()) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(updateResults, 120);
    });
    observer.observe(pageContent, { childList: true, subtree: true, characterData: true });
  }

  async function loadStudentProfileSummary() {
    const profileButton = document.querySelector(".student-profile-button");
    const nameNode = profileButton?.querySelector(".student-user-info strong");
    const gradeNode = profileButton?.querySelector(".student-user-info small");
    const avatar = profileButton?.querySelector(".student-avatar");
    const fallbackAvatar = profileButton?.querySelector(".student-avatar-fallback");
    if (!profileButton || !nameNode || !gradeNode || !avatar || !fallbackAvatar) return;

    try {
      const client = await loadStudentSupabaseClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      if (!authData?.user?.id) throw new Error("Sign in to load your student profile.");

      const { data: student, error: studentError } = await client
        .from("students")
        .select("full_name, grade, stream, profile_photo_url")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (studentError) throw studentError;
      if (!student) throw new Error("No student profile is linked to this account.");

      const name = String(student.full_name || "").trim() || "Student";
      const grade = Number(student.grade);
      const gradeLabel = Number.isInteger(grade) ? `Grade ${grade}` : "Grade not provided";
      const stream = String(student.stream || "")
        .trim()
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      nameNode.textContent = name;
      gradeNode.textContent = grade >= 11 && stream ? `${gradeLabel} • ${stream}` : gradeLabel;
      profileButton.setAttribute("aria-label", `Open ${name}'s student profile`);
      fallbackAvatar.textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      fallbackAvatar.hidden = false;
      avatar.hidden = true;
      avatar.removeAttribute("src");

      if (!studentProfileChannel && client.channel) {
        studentProfileChannel = client
          .channel(`student-header-profile-${authData.user.id}`)
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "students",
            filter: `user_id=eq.${authData.user.id}`,
          }, () => void loadStudentProfileSummary())
          .subscribe((status) => {
            if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
              console.error("Student header profile realtime updates are unavailable.", status);
            }
          });
      }

      if (!student.profile_photo_url) return;
      let photoUrl = student.profile_photo_url;
      if (!/^https?:\/\//i.test(photoUrl)) {
        const { data, error } = await client.storage
          .from("student-profile-images")
          .createSignedUrl(photoUrl, 3600);
        if (error) throw error;
        photoUrl = data.signedUrl;
      }
      avatar.addEventListener("error", () => {
        avatar.hidden = true;
        fallbackAvatar.hidden = false;
        console.error("Could not display the registered student profile photo.");
      }, { once: true });
      avatar.addEventListener("load", () => {
        avatar.hidden = false;
        fallbackAvatar.hidden = true;
      }, { once: true });
      avatar.src = photoUrl;
    } catch (error) {
      nameNode.textContent = "Profile unavailable";
      gradeNode.textContent = "Sign in to continue";
      profileButton.setAttribute("aria-label", "Student profile unavailable");
      fallbackAvatar.textContent = "?";
      fallbackAvatar.hidden = false;
      avatar.hidden = true;
      console.error("Could not load the registered student header profile.", error);
    }
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
        initializeStudentSearch(pageContent);
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
      loadStudentProfileSummary().catch((error) => {
        console.error("Unable to load the student profile summary.", error);
      });
      loadStudentAnnouncements().catch((error) => {
        console.error("Unable to initialize student announcements.", error);
      });
    })
    .catch((error) => console.error("Unable to load shared student dashboard layout.", error));

  window.addEventListener("beforeunload", () => {
    if (studentProfileChannel) {
      window.SmartLearningSupabase?.getClient?.()?.removeChannel(studentProfileChannel);
    }
  });
})();
