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
    const grade = String(
      profile.classGrade ||
        profile.class_grade ||
        profile.grade ||
        profile.academic?.grade ||
        "",
    ).replace(/^(class|grade)\s*/i, "").trim();
    if (!grade) return;

    const stream = String(
      profile.stream ||
        profile.classStream ||
        profile.class_stream ||
        profile.academic?.stream ||
        "",
    ).toLowerCase().trim().replace(/[\s-]+/g, "_");
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
      arts_humanities: "Arts / Humanities",
    };
    const streamText = Number(grade) >= 11
      ? ` - ${streamLabels[stream] || stream.replace(/_/g, " ")}`
      : "";

    text.textContent = `Grade ${grade}${streamText}`;
    context.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", renderRegistrationContext);
})();
