(() => {
  const profileKeys = ["studentProfile", "studentData", "finalStudentRegistration"];

  function readProfile() {
    return profileKeys
      .map((key) => {
        try {
          return JSON.parse(localStorage.getItem(key) || "null");
        } catch (error) {
          return null;
        }
      })
      .find((profile) => profile && (profile.classGrade || profile.class_grade || profile.grade)) || {};
  }

  function renderRegistrationContext() {
    const context = document.getElementById("registrationContext");
    const text = document.getElementById("registrationContextText");
    if (!context || !text) return;

    const profile = readProfile();
    const grade = String(profile.classGrade || profile.class_grade || profile.grade || "");
    if (!grade) return;

    const stream = String(profile.stream || profile.classStream || "").toLowerCase();
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
    };
    const streamText = grade === "11" || grade === "12"
      ? ` - ${streamLabels[stream] || "Selected stream"}`
      : "";

    text.textContent = `Registered curriculum: Grade ${grade}${streamText}`;
    context.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", renderRegistrationContext);
})();
