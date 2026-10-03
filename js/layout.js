(() => {
  const layoutHost = document.getElementById("layout");
  if (!layoutHost) return;

  if (!window.__teacherPageAuthGateInstalled) {
    window.__teacherPageAuthGateInstalled = true;
    const originalVisibility = document.documentElement.style.visibility;
    let replayingDOMContentLoaded = false;
    document.documentElement.style.visibility = "hidden";

    document.addEventListener(
      "DOMContentLoaded",
      (event) => {
        if (replayingDOMContentLoaded) return;
        event.stopImmediatePropagation();

        const showValidationError = (error) => {
          let panel = document.getElementById("teacherValidationError");
          if (!panel) {
            panel = document.createElement("main");
            panel.id = "teacherValidationError";
            panel.setAttribute("role", "alert");
            panel.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;gap:14px;padding:24px;background:#f8fafc;color:#172638;font:16px/1.5 sans-serif;visibility:visible;text-align:center";
            const heading = document.createElement("h1");
            heading.textContent = "Unable to verify your teacher account";
            const message = document.createElement("p");
            message.id = "teacherValidationErrorMessage";
            const retryButton = document.createElement("button");
            retryButton.type = "button";
            retryButton.textContent = "Retry";
            retryButton.style.cssText = "justify-self:center;padding:10px 18px;border:0;border-radius:6px;background:#00818a;color:#fff;font:inherit;font-weight:700;cursor:pointer";
            retryButton.addEventListener("click", () => {
              panel.remove();
              void validateAndContinue();
            });
            panel.append(heading, message, retryButton);
            document.body.append(panel);
          }
          panel.querySelector("#teacherValidationErrorMessage").textContent =
            `${error?.message || "A database or network error occurred."} You can retry without signing out.`;
        };

        const validateAndContinue = async () => {
          try {
            const teacher = await window.TeacherData.requireTeacher();
            if (!teacher) return;
            document.getElementById("teacherValidationError")?.remove();
            if (originalVisibility) {
              document.documentElement.style.visibility = originalVisibility;
            } else {
              document.documentElement.style.removeProperty("visibility");
            }
            replayingDOMContentLoaded = true;
            document.dispatchEvent(
              new Event("DOMContentLoaded", { bubbles: true }),
            );
            replayingDOMContentLoaded = false;
          } catch (error) {
            console.error("Teacher account validation failed.", error);
            showValidationError(error);
          }
        };

        void validateAndContinue();
      },
      { capture: true, once: true },
    );
  }

  const layoutPath = new URL("../components/layout.html", window.location.href);
  const requestedPage = window.location.pathname.split("/").pop();
  const currentPage = !requestedPage || requestedPage === "index.html"
    ? "teacher_dashboard.html"
    : requestedPage;
  const activePage = currentPage === "create-announcement.html"
    ? "announcements.html"
    : currentPage;

  if (!document.querySelector('link[data-layout-icons="font-awesome"]')) {
    const iconStylesheet = document.createElement("link");
    iconStylesheet.rel = "stylesheet";
    iconStylesheet.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
    iconStylesheet.dataset.layoutIcons = "font-awesome";
    document.head.appendChild(iconStylesheet);
  }

  if (!document.querySelector('link[data-smart-learning-theme="global"]')) {
    const themeStylesheet = document.createElement("link");
    themeStylesheet.rel = "stylesheet";
    themeStylesheet.href = "../css/theme.css";
    themeStylesheet.dataset.smartLearningTheme = "global";
    document.head.appendChild(themeStylesheet);
  }

  let profileChannel = null;
  let stopAuthWatch = null;

  fetch(layoutPath)
    .then((response) => {
      if (!response.ok) throw new Error(`Layout request failed: ${response.status}`);
      return response.text();
    })
    .then(async (html) => {
      layoutHost.innerHTML = html;

      const profileName = document.getElementById("profileNameEl");
      const teacherRole = document.getElementById("profileRoleEl");
      const avatar = document.getElementById("avatarImg");
      const renderIdentity = async (profile, user) => {
        if (profileName) profileName.textContent = profile.full_name || "Teacher";
        if (teacherRole) {
          teacherRole.textContent = profile.teaching_mode === "subject_specialist"
            ? "Teacher · Subject Specialist"
            : "Teacher · Educator";
        }
        if (!avatar || !profile.profile_photo_url) {
          if (avatar) avatar.hidden = true;
          return;
        }
        try {
          avatar.src = await window.TeacherData.getTeacherProfilePhotoUrl(profile.profile_photo_url);
          avatar.alt = profile.full_name ? `${profile.full_name}'s profile photo` : "Teacher profile photo";
          avatar.hidden = false;
        } catch {
          avatar.hidden = true;
        }
      };

      if (window.TeacherData?.loadCurrentTeacherProfile) {
        try {
          const { client, user, profile } = await window.TeacherData.loadCurrentTeacherProfile();
          await renderIdentity(profile, user);
          profileChannel = window.TeacherData.subscribeToTeacherProfile(user.id, (event) => {
            if (event.eventType === "DELETE") {
              void window.TeacherData.handleUnavailableTeacher(client);
              return;
            }
            if (event.new) renderIdentity(event.new, user);
          });
          stopAuthWatch = window.TeacherData.watchAuthState(() => {
            window.location.assign("../teacher_registration/login.html");
          });
          window.addEventListener("beforeunload", () => {
            if (profileChannel) client.removeChannel(profileChannel);
            stopAuthWatch?.();
          });
        } catch (error) {
          if (["AUTH_REQUIRED", "TEACHER_UNAVAILABLE"].includes(error.code)) return;
          if (profileName) profileName.textContent = "Unable to load profile";
          if (avatar) avatar.hidden = true;
          console.error("Unable to load the shared teacher profile.", error);
          return;
        }
      }

      const legacySidebar = document.querySelector("body > .sidebar");
      const legacyWrapper = document.querySelector("body > .main-wrapper");
      const legacyHeader = legacyWrapper?.querySelector(":scope > .header");
      const legacyContent = legacyWrapper?.querySelector(":scope > .main-box-container");

      legacySidebar?.remove();
      legacyHeader?.remove();
      if (legacyWrapper && legacyContent) {
        legacyWrapper.replaceWith(...Array.from(legacyWrapper.children));
      }

      document.querySelectorAll(".sidebar-link[data-page]").forEach((link) => {
        link.classList.toggle("active", link.dataset.page === activePage);
      });

      const menuToggle = document.getElementById("menuToggle");
      menuToggle?.addEventListener("click", () => {
        const isOpen = document.body.classList.toggle("sidebar-open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
      });

      document.querySelectorAll(".sidebar-link").forEach((link) => {
        link.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
      });

      document.getElementById("logoutBtn")?.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          const client = window.TeacherData?.getSupabaseClient?.();
          if (client) await client.auth.signOut();
        } catch (error) {
          console.error("Unable to sign out.", error);
        }
        window.location.assign("../teacher_registration/login.html");
      });
    })
    .catch((error) => console.error("Unable to load shared dashboard layout.", error));
})();
