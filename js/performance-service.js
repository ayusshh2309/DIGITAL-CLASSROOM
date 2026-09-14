(() => {
  const LOCAL_KEYS = ["performanceRecords", "studentPerformance", "quizResults", "quizAttempts"];
  const CATEGORIES = ["Excellent", "Very Good", "Good", "Needs Improvement"];

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch {
      return fallback;
    }
  };

  const teacherId = () => window.AttendanceService?.teacherId?.() || "local-teacher";
  const registeredClasses = () => window.AttendanceService?.loadTeacherClasses?.() || [];
  const registeredSubjects = (grade) => window.AttendanceService?.loadTeacherSubjects?.(grade) || [];
  const registeredStudents = (grade) => window.AttendanceService?.loadRegisteredStudents?.(grade) || [];
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const gradeOf = (record) => String(record.class_grade ?? record.grade ?? record.class ?? "").match(/\d+/)?.[0] || String(record.class_grade ?? record.grade ?? record.class ?? "");

  function localRecords() {
    return LOCAL_KEYS.flatMap((key) => readJson(key, [])).filter(Array.isArray).flatMap((records) => records);
  }

  function normalizeRecord(record) {
    const score = number(record.score ?? record.marks_obtained ?? record.obtained_marks ?? record.points, 0);
    const total = number(record.total_marks ?? record.max_score ?? record.total ?? record.points_possible, 0);
    const percentage = number(record.percentage ?? record.percent ?? (total > 0 ? (score / total) * 100 : 0), 0);
    return {
      id: String(record.id ?? record.assessment_id ?? `${record.student_id}-${record.subject}-${record.assessment_date}`),
      teacher_id: String(record.teacher_id ?? teacherId()),
      student_id: String(record.student_id ?? record.learner_id ?? record.user_id ?? ""),
      student_name: record.student_name ?? record.full_name ?? record.name ?? "",
      class_grade: gradeOf(record),
      subject: String(record.subject ?? record.subject_name ?? record.subject_id ?? "Unassigned"),
      assessment_id: String(record.assessment_id ?? record.quiz_id ?? record.exam_id ?? record.id ?? "assessment"),
      assessment_name: record.assessment_name ?? record.title ?? record.quiz_title ?? record.exam_title ?? "Assessment",
      score,
      total_marks: total,
      percentage: Math.max(0, Math.min(100, percentage)),
      assessment_date: record.assessment_date ?? record.date ?? record.created_at ?? new Date().toISOString(),
    };
  }

  async function loadPerformanceRecords(grade, subject = "") {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) {
      return localRecords().map(normalizeRecord).filter((record) => record.teacher_id === teacherId() && record.class_grade === String(grade) && (!subject || record.subject === subject));
    }
    const query = client.from("student_performance").select("*").eq("teacher_id", teacherId()).eq("class_grade", String(grade));
    const { data, error } = subject ? await query.eq("subject", subject) : await query;
    if (error) throw error;
    return (data || []).map(normalizeRecord).filter((record) => !subject || record.subject === subject);
  }

  function categoryFor(average) {
    if (average >= 85) return "Excellent";
    if (average >= 70) return "Very Good";
    if (average >= 60) return "Good";
    return "Needs Improvement";
  }

  function trendFor(records) {
    const sorted = [...records].sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date));
    if (sorted.length < 2) return { value: 0, label: "No trend", direction: "neutral" };
    const midpoint = Math.ceil(sorted.length / 2);
    const first = sorted.slice(0, midpoint).reduce((sum, record) => sum + record.percentage, 0) / midpoint;
    const recent = sorted.slice(midpoint).reduce((sum, record) => sum + record.percentage, 0) / (sorted.length - midpoint);
    const value = Math.round((recent - first) * 10) / 10;
    return { value, label: value > 1 ? "Improving" : value < -1 ? "Declining" : "Stable", direction: value > 1 ? "up" : value < -1 ? "down" : "neutral" };
  }

  function calculatePerformance(records, students, subjects) {
    const normalizedStudents = students.map((student) => ({ id: String(student.student_id), name: student.name, roll_no: student.roll_no }));
    const byStudent = new Map(normalizedStudents.map((student) => [student.id, []]));
    records.forEach((record) => { if (byStudent.has(record.student_id)) byStudent.get(record.student_id).push(record); });
    const studentRows = normalizedStudents.map((student) => {
      const studentRecords = byStudent.get(student.id) || [];
      const average = studentRecords.length ? studentRecords.reduce((sum, record) => sum + record.percentage, 0) / studentRecords.length : 0;
      const subjectScores = Object.fromEntries(subjects.map((item) => { const values = studentRecords.filter((record) => record.subject === item).map((record) => record.percentage); return [item, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null]; }));
      return { ...student, records: studentRecords, average: Math.round(average * 10) / 10, category: categoryFor(average), trend: trendFor(studentRecords), subjectScores };
    });
    const scored = studentRows.filter((student) => student.records.length);
    const classAverage = scored.length ? scored.reduce((sum, student) => sum + student.average, 0) / scored.length : 0;
    const allPercentages = records.map((record) => record.percentage);
    const highest = allPercentages.length ? Math.max(...allPercentages) : 0;
    const improvements = scored.filter((student) => student.records.length > 1).map((student) => student.trend.value);
    const subjectAverages = subjects.map((subject) => { const values = records.filter((record) => record.subject === subject).map((record) => record.percentage); return { subject, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0, count: values.length }; });
    const distribution = Object.fromEntries(CATEGORIES.map((category) => [category, studentRows.filter((student) => student.category === category && student.records.length).length]));
    return { students: studentRows, subjects: subjectAverages, classAverage: Math.round(classAverage * 10) / 10, highestScore: Math.round(highest * 10) / 10, improvement: improvements.length ? Math.round((improvements.reduce((sum, value) => sum + value, 0) / improvements.length) * 10) / 10 : 0, needsHelp: studentRows.filter((student) => student.records.length && student.average < 60).length, totalStudents: studentRows.length, distribution, records };
  }

  function insights(performance) {
    const weak = performance.subjects.filter((subject) => subject.count && subject.average < 60).sort((a, b) => a.average - b.average)[0];
    const improving = performance.students.filter((student) => student.trend.direction === "up").length;
    const declining = performance.students.filter((student) => student.trend.direction === "down").length;
    const messages = [];
    if (weak) messages.push(`Focus on ${weak.subject}; its average is ${weak.average}%.`);
    if (performance.needsHelp) messages.push(`${performance.needsHelp} student${performance.needsHelp === 1 ? " needs" : "s need"} targeted support below 60%.`);
    if (improving) messages.push(`${improving} student${improving === 1 ? " is" : "s are"} showing an improving trend.`);
    if (declining) messages.push(`${declining} student${declining === 1 ? " has" : "s have"} a declining recent trend.`);
    return messages.length ? messages : [performance.records.length ? "Performance is steady. Continue adding assessment results to improve the picture." : "Add quiz, exam, or assignment results to generate performance insights."];
  }

  function subscribeToPerformance({ grade, onChange }) {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) return () => {};
    const channel = client.channel(`performance-${teacherId()}-${grade}`);
    ["student_performance", "quiz_attempts"].forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${teacherId()}` }, (payload) => { const record = payload.new || payload.old; if (!record || gradeOf(record) === String(grade)) onChange(payload); }));
    channel.subscribe();
    return () => client.removeChannel(channel);
  }

  function subscribeToLocalChanges(onChange) {
    const listener = (event) => { if (!event.key || LOCAL_KEYS.includes(event.key)) onChange(event); };
    window.addEventListener("storage", listener);
    window.addEventListener("smart-learning-performance-updated", onChange);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("smart-learning-performance-updated", onChange); };
  }

  window.PerformanceService = { registeredClasses, registeredSubjects, registeredStudents, loadPerformanceRecords, calculatePerformance, insights, subscribeToPerformance, subscribeToLocalChanges, categoryFor, teacherId };
})();
