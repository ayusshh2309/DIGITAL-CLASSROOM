(() => {
  const PAGE_SIZE = 4;
  const PAGE_QUERY_SIZE = 1000;
  const STREAM_LABELS = {
    science_pcm: "PCM",
    science_pcb: "PCB",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };
  const SUBJECT_DETAILS = {
    English: ["Aa", "var(--chip-purple)"],
    Mathematics: ["+", "var(--chip-pink)"],
    EVS: ["🌱", "var(--chip-green)"],
    Science: ["⚗", "var(--chip-green)"],
    "Social Science": ["🏛", "var(--chip-cyan)"],
    SST: ["🏛", "var(--chip-cyan)"],
    Hindi: ["अ", "var(--chip-orange)"],
    Physics: ["⚛", "var(--chip-orange)"],
    Chemistry: ["⚗", "var(--chip-blue)"],
    Biology: ["🧬", "var(--chip-green)"],
    Accountancy: ["▤", "var(--chip-purple)"],
    "Business Studies": ["▥", "var(--chip-blue)"],
    Economics: ["▰", "var(--chip-amber)"],
    History: ["🏛", "var(--chip-cyan)"],
    Geography: ["◎", "var(--chip-green)"],
    "Political Science": ["⚖", "var(--chip-purple)"],
    Psychology: ["◉", "var(--chip-pink)"],
    Sociology: ["◌", "var(--chip-cyan)"],
    "Physical Education": ["⚽", "var(--chip-orange)"],
    "Computer Science": ["⌘", "var(--chip-amber)"],
  };

  const normalizeStream = (stream) => String(stream || "").trim().toLowerCase();
  const classKey = (grade, stream) => `${Number(grade)}|${normalizeStream(stream)}`;
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  const subjectIcon = (subject) => SUBJECT_DETAILS[subject] || ["•", "var(--primary)"];

  async function readAllRows(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_QUERY_SIZE) {
      const { data, error } = await createQuery()
        .range(offset, offset + PAGE_QUERY_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_QUERY_SIZE) return rows;
    }
  }

  async function loadTeacher(client) {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw new Error(`Teacher authentication failed: ${authError.message}`);
    const user = authData?.user;
    if (!user?.id) throw new Error("Sign in with your teacher account to view classes.");

    const { data: profile, error: profileError } = await client
      .from("teachers")
      .select("id, user_id, full_name, profile_photo_url")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw new Error(`Teacher profile lookup failed: ${profileError.message}`);
    if (!profile?.id) throw new Error("No teacher profile is linked to this account.");
    return { user, profile };
  }

  async function loadRegisteredClasses(client, teacherId) {
    const [groups, assignmentRows] = await Promise.all([
      readAllRows(() => client
        .from("teacher_grade_groups")
        .select("grade, stream")
        .eq("teacher_id", teacherId)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true })),
      readAllRows(() => client
        .from("teacher_subject_assignments")
        .select("grade, stream, subject_id")
        .eq("teacher_id", teacherId)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true })),
    ]);

    const classes = new Map();
    groups.forEach((row) => {
      const grade = Number(row.grade);
      if (!Number.isInteger(grade) || grade < 1 || grade > 12) return;
      const stream = grade >= 11 ? normalizeStream(row.stream) : "";
      const key = classKey(grade, stream);
      if (!classes.has(key)) {
        classes.set(key, { grade, stream: stream || null, subjects: new Map() });
      }
    });

    const matchedAssignments = assignmentRows.filter((row) => {
      const grade = Number(row.grade);
      const stream = grade >= 11 ? normalizeStream(row.stream) : "";
      return row.subject_id && classes.has(classKey(grade, stream));
    });
    const subjectIds = [...new Set(matchedAssignments.map((row) => String(row.subject_id)))];
    const subjects = subjectIds.length
      ? await readAllRows(() => client
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds)
        .order("name", { ascending: true }))
      : [];
    const subjectById = new Map(
      subjects.filter((subject) => subject.name).map((subject) => [
        String(subject.id),
        { id: subject.id, name: subject.name },
      ]),
    );

    matchedAssignments.forEach((row) => {
      const grade = Number(row.grade);
      const stream = grade >= 11 ? normalizeStream(row.stream) : "";
      const subject = subjectById.get(String(row.subject_id));
      if (!subject) {
        throw new Error(`Assigned subject ID ${row.subject_id} is missing from public.subjects.`);
      }
      classes.get(classKey(grade, stream)).subjects.set(String(subject.id), subject);
    });

    return classes;
  }

  async function loadClassStats(client, teacherId, classes) {
    const stats = new Map([...classes.keys()].map((key) => [
      key,
      { students: 0, lessons: 0 },
    ]));
    let students = null;
    let materials = null;

    try {
      students = await readAllRows(() => client
        .from("students")
        .select("id, grade, stream")
        .order("grade", { ascending: true }));
    } catch (error) {
      console.error("Could not load students for registered classes.", error);
      stats.forEach((value) => { value.students = null; });
    }

    try {
      materials = await readAllRows(() => client
        .from("materials")
        .select("grade, stream")
        .eq("teacher_id", teacherId)
        .order("grade", { ascending: true }));
    } catch (error) {
      console.error("Could not load materials for registered classes.", error);
      stats.forEach((value) => { value.lessons = null; });
    }

    const studentIdsByClass = new Map([...classes.keys()].map((key) => [key, new Set()]));
    (students || []).forEach((student) => {
      const key = classKey(student.grade, student.stream);
      if (studentIdsByClass.has(key)) studentIdsByClass.get(key).add(String(student.id));
    });
    if (students !== null) {
      studentIdsByClass.forEach((ids, key) => {
        stats.get(key).students = ids.size;
      });
    }

    (materials || []).forEach((material) => {
      const key = classKey(material.grade, material.stream);
      if (stats.has(key) && stats.get(key).lessons !== null) {
        stats.get(key).lessons += 1;
      }
    });
    return { stats, students };
  }

  async function loadAverageProgress(client, teacherId, classes, students) {
    if (!students?.length) return null;
    const studentsById = new Map(students.map((student) => [String(student.id), student]));
    let quizzes;
    try {
      quizzes = await readAllRows(() => client
        .from("quizzes")
        .select("id, grade, stream, subject_id")
        .eq("teacher_id", teacherId)
        .eq("status", "published")
        .eq("results_released", true)
        .order("grade", { ascending: true }));
    } catch (error) {
      console.error("Could not load released assessment data for My Classes.", error);
      return null;
    }

    const eligibleQuizzes = quizzes.filter((quiz) => {
      const grade = Number(quiz.grade);
      const stream = grade >= 11 ? normalizeStream(quiz.stream) : "";
      const classInfo = classes.get(classKey(grade, stream));
      if (!classInfo || !classInfo.subjects.has(String(quiz.subject_id))) return false;
      return [...studentsById.values()].some((student) =>
        Number(student.grade) === grade
        && normalizeStream(student.stream) === stream,
      );
    });
    if (!eligibleQuizzes.length) return null;

    const quizIds = eligibleQuizzes.map((quiz) => quiz.id);
    const attemptPages = await Promise.all(
      Array.from({ length: Math.ceil(quizIds.length / 100) }, (_, index) =>
        readAllRows(() => client
          .from("quiz_attempts")
          .select("id, quiz_id, student_id, score, total_marks, percentage, submitted_at, status")
          .in("quiz_id", quizIds.slice(index * 100, (index + 1) * 100))
          .eq("status", "submitted")
          .order("submitted_at", { ascending: true })),
      ),
    );
    const quizzesById = new Map(eligibleQuizzes.map((quiz) => [String(quiz.id), quiz]));
    const latestByStudentQuiz = new Map();
    attemptPages.flat().forEach((attempt) => {
      const quiz = quizzesById.get(String(attempt.quiz_id));
      const student = studentsById.get(String(attempt.student_id));
      if (!quiz || !student) return;
      const grade = Number(quiz.grade);
      const stream = grade >= 11 ? normalizeStream(quiz.stream) : "";
      if (
        Number(student.grade) !== grade
        || normalizeStream(student.stream) !== stream
      ) return;

      const percentage = attempt.percentage == null || attempt.percentage === ""
        ? Number.NaN
        : Number(attempt.percentage);
      const score = Number(attempt.score);
      const total = Number(attempt.total_marks);
      const result = Number.isFinite(percentage)
        ? percentage
        : Number.isFinite(score) && Number.isFinite(total) && total > 0
          ? (score / total) * 100
          : null;
      if (result === null || result < 0 || result > 100) return;

      const key = `${attempt.student_id}|${attempt.quiz_id}`;
      const previous = latestByStudentQuiz.get(key);
      if (!previous || new Date(attempt.submitted_at) >= new Date(previous.submitted_at)) {
        latestByStudentQuiz.set(key, { studentId: String(attempt.student_id), result, submitted_at: attempt.submitted_at });
      }
    });
    const studentAverages = new Map();
    latestByStudentQuiz.forEach(({ studentId, result }) => {
      if (!studentAverages.has(studentId)) studentAverages.set(studentId, []);
      studentAverages.get(studentId).push(result);
    });
    const averages = [...studentAverages.values()].map((values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
    return averages.length
      ? averages.reduce((sum, value) => sum + value, 0) / averages.length
      : null;
  }

  function renderClasses(classesGrid, stats, selectedClasses, currentPage, pageSize) {
    const start = (currentPage - 1) * pageSize;
    const pageClasses = selectedClasses.slice(start, start + pageSize);
    classesGrid.innerHTML = pageClasses.length
      ? pageClasses.map(([key, classInfo]) => {
        const subjects = [...classInfo.subjects.values()]
          .sort((left, right) => left.name.localeCompare(right.name));
        const classStats = stats.get(key) || { students: null, lessons: null };
        const subjectCards = subjects.map((subject) => {
          const [icon, color] = subjectIcon(subject.name);
          return `<div class="subject-item" title="${escapeHtml(subject.name)}">
            <span class="subject-item-icon" style="background-color: ${color}">${icon}</span>
            <span>${escapeHtml(subject.name)}</span>
          </div>`;
        }).join("");
        const accent = subjectIcon(subjects[0]?.name)[1];
        const streamLabel = classInfo.stream
          ? ` · ${escapeHtml(STREAM_LABELS[classInfo.stream] || classInfo.stream)}`
          : "";
        return `
          <div class="class-card registered-class-card">
            <div class="class-card-top">
              <div class="class-icon-wrapper" style="background-color: ${accent}">📚</div>
              <div class="class-info-header">
                <h3>Class ${classInfo.grade}${streamLabel}</h3>
                <p>${subjects.length} registered subjects</p>
              </div>
            </div>
            <div class="class-meta-line">
              <span class="meta-item">👥 ${classStats.students ?? "—"} Students</span>
              <span class="meta-item">📄 ${classStats.lessons ?? "—"} Lessons</span>
              <span class="meta-item"><span class="status-dot-active"></span> Active</span>
            </div>
            <div class="subject-list">${subjectCards || '<p class="class-empty-subjects">No subjects assigned.</p>'}</div>
            <div class="progress-section">
              <div class="progress-labels"><span>Teaching assignment</span><span>Ready</span></div>
            </div>
            <button class="btn-view-class" type="button">View Class</button>
          </div>
        `;
      }).join("")
      : '<p class="empty-state">No classes registered yet.</p>';
  }

  function renderPager(classesGrid, totalPages, currentPage) {
    document.querySelector(".classes-pager")?.remove();
    if (totalPages <= 1) return;
    const pager = document.createElement("nav");
    pager.className = "classes-pager";
    pager.setAttribute("aria-label", "Class pages");
    pager.innerHTML = Array.from({ length: totalPages }, (_, index) => {
      const page = index + 1;
      return `<button type="button" class="classes-page-button${page === currentPage ? " active" : ""}" data-page="${page}">${page}</button>`;
    }).join("");
    classesGrid.after(pager);
    pager.querySelectorAll(".classes-page-button").forEach((button) => {
      button.addEventListener("click", () => {
        const params = new URLSearchParams(window.location.search);
        params.set("page", button.dataset.page);
        window.location.search = params.toString();
      });
    });
  }

  function renderAverageProgress(average) {
    const chart = document.getElementById("averageProgressChart");
    const label = document.getElementById("averageProgressLabel");
    if (average === null) {
      chart.dataset.label = "—";
      chart.style.background = "conic-gradient(#cbd5e1 0% 100%)";
      chart.setAttribute("aria-label", "Average progress unavailable: no released assessment data.");
      label.textContent = "No released assessment data";
      return;
    }
    const percentage = Math.round(average);
    chart.dataset.label = `${percentage}%`;
    chart.style.background = `conic-gradient(#2563eb 0% ${percentage}%, #cbd5e1 ${percentage}% 100%)`;
    chart.setAttribute("aria-label", `Average student assessment score: ${percentage} percent.`);
    label.textContent = "Based on released assessments";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const profileNameElement = document.getElementById("profileNameEl");
    const avatarElement = document.getElementById("avatarImg");
    const classesGrid = document.getElementById("classesGrid");
    const gridViewButton = document.getElementById("gridViewButton");
    const listViewButton = document.getElementById("listViewButton");
    if (classesGrid) {
      classesGrid.setAttribute("aria-busy", "true");
      classesGrid.innerHTML = '<p class="empty-state" role="status">Loading your registered classes…</p>';
    }
    const setView = (view) => {
      const isList = view === "list";
      classesGrid?.classList.toggle("list-view", isList);
      gridViewButton?.classList.toggle("active", !isList);
      listViewButton?.classList.toggle("active", isList);
      gridViewButton?.setAttribute("aria-pressed", String(!isList));
      listViewButton?.setAttribute("aria-pressed", String(isList));
      localStorage.setItem("teacherClassesView", view);
    };
    gridViewButton?.addEventListener("click", () => setView("grid"));
    listViewButton?.addEventListener("click", () => setView("list"));
    setView(localStorage.getItem("teacherClassesView") || "grid");

    let client = null;
    let teacherProfile = null;
    let classLoadError = "";
    let classes = new Map();
    let classStats = new Map();
    let students = null;

    try {
      client = window.TeacherData?.getSupabaseClient?.();
      if (!client) throw new Error("Supabase is not configured for My Classes.");
      const teacher = await loadTeacher(client);
      teacherProfile = teacher.profile;
      if (profileNameElement) {
        profileNameElement.textContent = teacherProfile.full_name || "Teacher";
      }
      if (teacherProfile.profile_photo_url && avatarElement) {
        try {
          avatarElement.src = await window.TeacherData.getTeacherProfilePhotoUrl(
            teacherProfile.profile_photo_url,
          );
        } catch (error) {
          console.error("Could not load the teacher profile photo.", error);
          avatarElement.hidden = true;
        }
      }
      classes = await loadRegisteredClasses(client, teacherProfile.id);
      const classData = await loadClassStats(client, teacherProfile.id, classes);
      classStats = classData.stats;
      students = classData.students;
    } catch (error) {
      console.error("Unable to load registered teacher classes from Supabase.", error);
      classLoadError = error?.message || "Unable to load registered classes from the database.";
    }

    const allClasses = [...classes.entries()].sort(([, left], [, right]) =>
      left.grade - right.grade || String(left.stream || "").localeCompare(String(right.stream || "")),
    );
    const params = new URLSearchParams(window.location.search);
    const requestedGrade = Number(params.get("class_grade"));
    const requestedStream = normalizeStream(params.get("stream"));
    const hasRequestedClass = allClasses.some(([, item]) =>
      (!requestedGrade || item.grade === requestedGrade)
      && (!requestedStream || normalizeStream(item.stream) === requestedStream),
    );
    const selectedClasses = hasRequestedClass
      ? allClasses.filter(([, item]) =>
        (!requestedGrade || item.grade === requestedGrade)
        && (!requestedStream || normalizeStream(item.stream) === requestedStream),
      )
      : allClasses;
    const pageSize = PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(selectedClasses.length / pageSize));
    const currentPage = Math.min(
      Math.max(1, Number(params.get("page")) || 1),
      totalPages,
    );

    if (classesGrid) {
      if (classLoadError) {
        classesGrid.innerHTML = `<p class="empty-state">Database error: ${escapeHtml(classLoadError)}</p>`;
      } else {
        renderClasses(classesGrid, classStats, selectedClasses, currentPage, pageSize);
        renderPager(classesGrid, totalPages, currentPage);
      }
      classesGrid.setAttribute("aria-busy", "false");
    }

    const totalClassesMetric = document.getElementById("totalClassesMetric");
    const totalStudentsMetric = document.getElementById("totalStudentsMetric");
    const totalLessonsMetric = document.getElementById("totalLessonsMetric");
    totalClassesMetric.textContent = classLoadError ? "—" : String(allClasses.length);
    const studentCounts = [...classStats.values()].map((stats) => stats.students);
    const lessonCounts = [...classStats.values()].map((stats) => stats.lessons);
    totalStudentsMetric.textContent = classLoadError || studentCounts.some((count) => count === null)
      ? "—"
      : String(studentCounts.reduce((sum, count) => sum + count, 0));
    totalLessonsMetric.textContent = classLoadError || lessonCounts.some((count) => count === null)
      ? "—"
      : String(lessonCounts.reduce((sum, count) => sum + count, 0));

    if (!classLoadError && client && teacherProfile) {
      try {
        renderAverageProgress(
          await loadAverageProgress(client, teacherProfile.id, classes, students),
        );
      } catch (error) {
        console.error("Could not calculate average progress from released assessments.", error);
        renderAverageProgress(null);
      }
    } else {
      renderAverageProgress(null);
    }

    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) console.error("Teacher sign-out failed.", error);
      }
      window.location.href = "index.html";
    });
  });
})();
