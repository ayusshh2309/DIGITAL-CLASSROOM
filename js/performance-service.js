(() => {
  const CATEGORY_NAMES = ["Excellent", "Good", "Average", "Needs Help"];
  const STREAM_LABELS = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };

  async function initialize() {
    const client = window.TeacherData?.getSupabaseClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) {
      const error = new Error("Sign in with a teacher account to view performance.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    const { data: teacher, error: teacherError } = await client
      .from("teachers")
      .select("id, user_id")
      .eq("user_id", authData.user.id)
      .single();
    if (teacherError) throw teacherError;
    const groups = await window.TeacherData.loadRegisteredTeachingScope(client, teacher.id);
    return { client, user: authData.user, teacher, groups };
  }

  function registeredClasses(groups) {
    return [...new Set(groups.map((group) => Number(group.grade)))].sort((a, b) => a - b);
  }

  function registeredGroups(groups, grade) {
    return groups.filter((group) => Number(group.grade) === Number(grade));
  }

  function registeredSubjects(groups, grade, stream) {
    const group = registeredGroups(groups, grade).find((item) =>
      (item.stream || "") === (stream || ""),
    );
    return group?.subjects || [];
  }

  async function loadPerformanceData({ client, teacher, grade, stream, subjectId, groups }) {
    const group = registeredGroups(groups, grade).find((item) =>
      (item.stream || "") === (stream || ""),
    );
    if (!group) throw new Error("The selected grade and stream are not registered to this teacher.");
    const authorizedSubjects = subjectId
      ? group.subjects.filter((subject) => String(subject.id) === String(subjectId))
      : group.subjects;
    if (subjectId && !authorizedSubjects.length) {
      throw new Error("The selected subject is not assigned to this grade and stream.");
    }
    const subjectIds = authorizedSubjects.map((subject) => subject.id);
    if (!subjectIds.length) return { students: [], records: [], subjects: authorizedSubjects };

    let quizQuery = client
      .from("quizzes")
      .select("id, title, subject_id")
      .eq("teacher_id", teacher.id)
      .eq("grade", Number(grade))
      .eq("status", "published")
      .in("subject_id", subjectIds);
    quizQuery = stream ? quizQuery.eq("stream", stream) : quizQuery.is("stream", null);

    let studentQuery = client
      .from("students")
      .select("id, student_id, full_name, grade, stream, roll_number")
      .eq("grade", Number(grade))
      .order("full_name", { ascending: true });
    studentQuery = stream ? studentQuery.eq("stream", stream) : studentQuery.is("stream", null);

    const [quizResult, studentResult] = await Promise.all([quizQuery, studentQuery]);
    if (quizResult.error) throw quizResult.error;
    if (studentResult.error) throw studentResult.error;

    const quizzes = quizResult.data || [];
    const students = studentResult.data || [];
    if (!quizzes.length) return { students, records: [], subjects: authorizedSubjects };

    const { data: attempts, error: attemptError } = await client
      .from("quiz_attempts")
      .select("id, quiz_id, student_id, score, total_marks, percentage, correct_answers, wrong_answers, unanswered, submitted_at, status")
      .in("quiz_id", quizzes.map((quiz) => quiz.id))
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true });
    if (attemptError) throw attemptError;

    const quizById = new Map(quizzes.map((quiz) => [String(quiz.id), quiz]));
    const studentIds = new Set(students.map((student) => String(student.id)));
    const subjectById = new Map(authorizedSubjects.map((subject) => [String(subject.id), subject.name]));
    const records = (attempts || [])
      .filter((attempt) => studentIds.has(String(attempt.student_id)))
      .map((attempt) => {
        const quiz = quizById.get(String(attempt.quiz_id));
        const score = Number(attempt.score);
        const total = Number(attempt.total_marks);
        const percentage = Number(attempt.percentage);
        return {
          id: String(attempt.id),
          quiz_id: String(attempt.quiz_id),
          student_id: String(attempt.student_id),
          student_name: "",
          subject_id: String(quiz.subject_id),
          subject: subjectById.get(String(quiz.subject_id)) || "Unknown subject",
          assessment_name: quiz.title,
          score,
          total_marks: total,
          percentage: Number.isFinite(percentage) ? percentage : (total > 0 ? (score / total) * 100 : 0),
          assessment_date: attempt.submitted_at,
          correct_answers: attempt.correct_answers,
          wrong_answers: attempt.wrong_answers,
          unanswered: attempt.unanswered,
        };
      });

    return { students, records, subjects: authorizedSubjects };
  }

  function categoryFor(average) {
    if (average >= 90) return "Excellent";
    if (average >= 75) return "Good";
    if (average >= 60) return "Average";
    return "Needs Help";
  }

  function trendFor(records) {
    const sorted = [...records].sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date));
    if (sorted.length < 2) return { value: null, label: "Insufficient data", direction: "neutral" };
    const midpoint = Math.ceil(sorted.length / 2);
    const first = sorted.slice(0, midpoint).reduce((sum, record) => sum + record.percentage, 0) / midpoint;
    const recent = sorted.slice(midpoint).reduce((sum, record) => sum + record.percentage, 0) / (sorted.length - midpoint);
    const value = Math.round((recent - first) * 10) / 10;
    return { value, label: value > 1 ? "Improving" : value < -1 ? "Declining" : "Stable", direction: value > 1 ? "up" : value < -1 ? "down" : "neutral" };
  }

  function calculatePerformance(records, students, subjects) {
    const studentRows = students.map((student) => {
      const studentRecords = records
        .filter((record) => record.student_id === String(student.id))
        .sort((left, right) => new Date(left.assessment_date) - new Date(right.assessment_date));
      const average = studentRecords.length
        ? studentRecords.reduce((sum, record) => sum + record.percentage, 0) / studentRecords.length
        : null;
      const subjectScores = Object.fromEntries(subjects.map((subject) => {
        const values = studentRecords.filter((record) => record.subject_id === String(subject.id)).map((record) => record.percentage);
        return [subject.name, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null];
      }));
      return {
        id: String(student.id),
        studentCode: student.student_id,
        name: student.full_name,
        roll_no: student.roll_number || "—",
        records: studentRecords,
        average: average === null ? null : Math.round(average * 10) / 10,
        category: average === null ? "—" : categoryFor(average),
        trend: trendFor(studentRecords),
        subjectScores,
      };
    });

    const assessed = studentRows.filter((student) => student.records.length);
    const classAverage = assessed.length
      ? assessed.reduce((sum, student) => sum + student.average, 0) / assessed.length
      : null;
    const highest = records.length ? Math.max(...records.map((record) => record.percentage)) : null;
    const improvements = assessed
      .filter((student) => student.trend.value !== null)
      .map((student) => student.trend.value);
    const subjectAverages = subjects.map((subject) => {
      const values = records.filter((record) => record.subject_id === String(subject.id)).map((record) => record.percentage);
      return {
        id: String(subject.id),
        subject: subject.name,
        average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        count: values.length,
      };
    });
    const distribution = Object.fromEntries(CATEGORY_NAMES.map((category) => [
      category,
      assessed.filter((student) => student.category === category).length,
    ]));

    return {
      students: studentRows,
      subjects: subjectAverages,
      classAverage: classAverage === null ? null : Math.round(classAverage * 10) / 10,
      highestScore: highest === null ? null : Math.round(highest * 10) / 10,
      improvement: improvements.length
        ? Math.round((improvements.reduce((sum, value) => sum + value, 0) / improvements.length) * 10) / 10
        : null,
      needsHelp: assessed.filter((student) => student.average < 60).length,
      totalStudents: studentRows.length,
      distribution,
      records,
    };
  }

  function insights(performance) {
    if (!performance.records.length) return ["No quiz results available yet."];
    const messages = [
      `Class average: ${performance.classAverage}%.`,
      `Highest quiz score: ${performance.highestScore}%.`,
      `${performance.students.length} students are registered in this grade and stream.`,
      `${performance.needsHelp} assessed student${performance.needsHelp === 1 ? "" : "s"} scored below 60%.`,
    ];
    performance.subjects
      .filter((subject) => subject.average !== null)
      .forEach((subject) => messages.push(`${subject.subject} average: ${Math.round(subject.average)}%.`));
    return messages;
  }

  function subscribeToPerformance({ client, teacher, onChange }) {
    const channel = client
      .channel(`performance-${teacher.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${teacher.id}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_answers" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "teacher_grade_groups", filter: `teacher_id=eq.${teacher.id}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "teacher_subject_assignments", filter: `teacher_id=eq.${teacher.id}` }, onChange)
      .subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.error("Performance realtime subscription is unavailable.", status);
        }
      });
    return () => client.removeChannel(channel);
  }

  window.PerformanceService = {
    initialize,
    registeredClasses,
    registeredGroups,
    registeredSubjects,
    loadPerformanceData,
    calculatePerformance,
    insights,
    subscribeToPerformance,
    categoryFor,
    streamLabels: STREAM_LABELS,
  };
})();
