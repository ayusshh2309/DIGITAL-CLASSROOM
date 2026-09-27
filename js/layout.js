(() => {
  const layoutHost = document.getElementById("layout");
  if (!layoutHost) return;

  const layoutPath = new URL("../components/layout.html", window.location.href);
  const requestedPage = window.location.pathname.split("/").pop();
  const currentPage = !requestedPage || requestedPage === "index.html"
    ? "teacher_dashboard.html"
    : requestedPage;

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
              window.__currentTeacherProfile = null;
              window.location.assign("../teacher_registration/login.html");
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
          if (profileName) profileName.textContent = "Unable to load profile";
          if (avatar) avatar.hidden = true;
          if (error.code !== "AUTH_REQUIRED") {
            console.error("Unable to load the shared teacher profile.", error);
          }
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
        link.classList.toggle("active", link.dataset.page === currentPage);
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
