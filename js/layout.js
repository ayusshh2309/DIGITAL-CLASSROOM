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

  fetch(layoutPath)
    .then((response) => {
      if (!response.ok) throw new Error(`Layout request failed: ${response.status}`);
      return response.text();
    })
    .then((html) => {
      layoutHost.innerHTML = html;

      const readStoredTeacher = (key) => {
        try {
          return JSON.parse(localStorage.getItem(key) || "null");
        } catch (error) {
          return null;
        }
      };

      const teacherData =
        readStoredTeacher("teacherRegistration") ||
        readStoredTeacher("teacherProfile") ||
        readStoredTeacher("teacherData");
      const teacherName =
        teacherData?.personal?.fullName ||
        teacherData?.personal?.full_name ||
        teacherData?.fullName ||
        teacherData?.full_name;
      const profileName = document.getElementById("profileNameEl");
      if (profileName && teacherName) profileName.textContent = teacherName;

      const teacherRole = document.getElementById("profileRoleEl");
      if (teacherRole && teacherData?.professional?.teachingMode) {
        teacherRole.textContent =
          teacherData.professional.teachingMode === "subject_specialist"
            ? "Teacher · Subject Specialist"
            : "Teacher · All Subjects";
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

      document.getElementById("logoutBtn")?.addEventListener("click", () => {
        window.localStorage.removeItem("teacherProfile");
        window.localStorage.removeItem("teacherData");
      });
    })
    .catch((error) => console.error("Unable to load shared dashboard layout.", error));
})();
