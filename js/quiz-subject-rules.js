(() => {
  const gradeSubjects = {
    5: ["English", "Mathematics", "EVS", "Hindi"],
    6: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    7: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    8: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    9: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    10: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    11: {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts_humanities: ["History", "Geography", "Political Science", "Psychology"],
    },
    12: {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts_humanities: ["History", "Geography", "Political Science", "Psychology"],
    },
  };
  const streamLabels = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };
  const normalizeStream = (value) => {
    const stream = String(value ?? "").trim().toLowerCase();
    return Object.hasOwn(streamLabels, stream) ? stream : "";
  };
  const usesStream = (grade) => Number(grade) === 11 || Number(grade) === 12;
  const validStreams = (grade) => usesStream(grade) ? Object.keys(gradeSubjects[Number(grade)] || {}) : [];
  const subjectsFor = (grade, stream = "") => {
    const subjects = gradeSubjects[Number(grade)];
    if (Array.isArray(subjects)) return subjects;
    if (!subjects || !usesStream(grade)) return [];
    return subjects[normalizeStream(stream)] || [];
  };

  window.TeacherQuizSubjectRules = { gradeSubjects, streamLabels, normalizeStream, usesStream, validStreams, subjectsFor };
})();
