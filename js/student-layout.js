(() => {
  const layoutHost = document.getElementById("studentLayout");
  if (!layoutHost) return;

  const componentUrl = new URL("../components/student-layout.html", window.location.href);
  const page = window.location.pathname.split("/").pop() || "st_dashboard.html";

  if (!document.querySelector('link[data-student-layout-icons="font-awesome"]')) {
    const iconStylesheet = document.createElement("link");
    iconStylesheet.rel = "stylesheet";
    iconStylesheet.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
    iconStylesheet.dataset.studentLayoutIcons = "font-awesome";
    document.head.appendChild(iconStylesheet);
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
    })
    .catch((error) => console.error("Unable to load shared student dashboard layout.", error));
})();
