(() => {
  const root = document.getElementById("teacherDashboard");
  if (!root) return;
  window.teacherDashboardRedesigned = true;

  root.innerHTML = `
    <section class="dashboard-hero" aria-labelledby="greetingEl">
      <div class="hero-copy">
        <div class="hero-eyebrow">Teacher dashboard</div>
        <h1 id="greetingEl">Good morning!</h1>
        <p>Here's what's happening in your classroom today.</p>
      </div>
      <div class="hero-clock" aria-label="Current local date and time">
        <div class="hero-date" id="dashboardDate"></div>
        <div class="hero-time" id="dashboardTime"></div>
      </div>
    </section>
    <section class="dashboard-stats" aria-label="Classroom statistics" id="dashboardStats"></section>
    <section class="dashboard-panel">
      <div class="panel-heading">
        <div><h2>Class performance</h2><div class="panel-kicker">Assessment scores and attendance for your assigned classes</div></div>
        <select class="period-select" id="performancePeriod" aria-label="Performance period">
          <option value="week">This Week</option><option value="month">This Month</option><option value="term">This Term</option>
        </select>
      </div>
      <div class="chart-wrap" id="performanceChart"></div>
    </section>
    <div class="dashboard-lower">
      <section class="dashboard-panel">
        <div class="panel-heading"><div><h2>Today's classes</h2><div class="panel-kicker" id="todaySummary"></div></div><a class="panel-link" href="live_classes.html">Full schedule</a></div>
        <div class="today-list" id="todayClasses"></div>
      </section>
      <section class="dashboard-panel">
        <div class="panel-heading"><div><h2>Calendar & events</h2><div class="panel-kicker">Your classes and academic events</div></div><a class="panel-link" href="calendar.html">Open calendar</a></div>
        <div class="calendar-top"><span class="calendar-month" id="calendarMonth"></span><div class="calendar-nav"><button type="button" id="calendarPrevious" aria-label="Previous month">‹</button><button type="button" id="calendarNext" aria-label="Next month">›</button></div></div>
        <div class="calendar-grid" id="calendarGrid"></div><div class="event-list" id="eventList"></div>
      </section>
    </div>
    <section class="dashboard-panel">
      <div class="panel-heading"><div><h2>Your subjects</h2><div class="panel-kicker">Only subjects assigned to your registered classes</div></div></div>
      <div class="subject-grid" id="subjectGrid"></div>
    </section>
    <dialog class="event-dialog" id="eventDialog"><button type="button" id="closeEventDialog">Close</button><h2 id="eventDialogTitle"></h2><p id="eventDialogDate"></p><p id="eventDialogDescription"></p></dialog>`;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const readArray = (key) => {
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
  };
  const registration = window.TeacherData?.getTeacherData?.() || {};
  const profile = registration.personal || {};
  const teacherName = profile.fullName || profile.full_name || registration.fullName || registration.full_name || "Teacher";
  const profileName = document.getElementById("profileNameEl");
  if (profileName) profileName.textContent = teacherName;
  const avatar = document.getElementById("avatarImg");
  if (avatar && profile.profilePhoto) avatar.src = profile.profilePhoto;
  const localTeacherIds = new Set([window.AttendanceService?.teacherId?.(), registration.authUserId, registration.id, registration.teacher_id, registration.teacherId, profile.email].filter(Boolean).map(String));
  const teacherId = () => state.user?.id || window.AttendanceService?.teacherId?.() || "local-teacher";
  const state = { user: null, client: null, classes: [], assignments: new Map(), materials: [], quizzes: [], students: [], attendance: [], performance: new Map(), liveClasses: [], announcements: [], calendarDate: new Date(), events: [], refreshTimer: null, refreshing: false };
  const gradeOf = (row) => String(row.class_grade ?? row.grade ?? row.class ?? row.class_number ?? "").match(/\d+/)?.[0] || "";
  const subjectOf = (row) => String(row.subject ?? row.subject_name ?? "").trim();
  const dateOf = (row) => row.start_at || row.scheduled_at || row.start_time || row.exam_at || row.due_date || row.published_at || row.created_at || null;
  const localOwned = (rows) => rows.filter((row) => row.teacher_id && String(row.teacher_id) !== "local-teacher" && localTeacherIds.has(String(row.teacher_id)));
  const assignedRow = (row) => state.assignments.has(gradeOf(row)) && (!subjectOf(row) || state.assignments.get(gradeOf(row)).has(subjectOf(row)));
  const fmtDate = (date, options = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) => new Intl.DateTimeFormat(undefined, options).format(date);
  const fmtTime = (date) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);

  function updateClock() {
    const now = new Date();
    const hour = now.getHours();
    $("greetingEl").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${teacherName}!`;
    $("dashboardDate").textContent = fmtDate(now);
    $("dashboardTime").textContent = fmtTime(now);
    renderToday();
  }

  function setupAssignments(databaseAssignments = []) {
    const assignments = new Map();
    const localMatchesUser = !state.user || localTeacherIds.has(String(state.user.id));
    const localGrades = localMatchesUser ? window.AttendanceService?.loadTeacherClasses?.() || [] : [];
    localGrades.forEach((grade) => {
      const subjects = window.AttendanceService?.loadTeacherSubjects?.(grade) || [];
      if (subjects.length) assignments.set(String(grade), new Set(subjects.map(String)));
    });
    databaseAssignments.forEach((row) => {
      const grade = gradeOf(row);
      const subject = subjectOf(row);
      if (!grade || !subject) return;
      if (!assignments.has(grade)) assignments.set(grade, new Set());
      assignments.get(grade).add(subject);
    });
    state.assignments = assignments;
    state.classes = [...assignments.keys()].sort((a, b) => Number(a) - Number(b));
  }

  async function queryTeacherTable(table, fields = "*", applyAssignmentScope = true) {
    if (!state.client || !state.user) return [];
    try {
      const { data, error } = await state.client.from(table).select(fields).eq("teacher_id", state.user.id);
      if (error) return [];
      return applyAssignmentScope ? (data || []).filter(assignedRow) : data || [];
    } catch { return []; }
  }

  function normalizeAssessment(row) {
    const quiz = state.quizzes.find((item) => String(item.id) === String(row.quiz_id || row.assessment_id));
    const score = Number(row.score ?? row.marks_obtained ?? row.obtained_marks ?? 0);
    const total = Number(row.total_marks ?? row.max_score ?? row.points_possible ?? quiz?.total_marks ?? 0);
    return {
      ...row,
      class_grade: row.class_grade || row.grade || gradeOf(quiz || {}),
      subject: row.subject || subjectOf(quiz || {}),
      percentage: Number(row.percentage ?? row.percent ?? (total > 0 ? score / total * 100 : NaN)),
      assessment_date: row.assessment_date || row.completed_at || row.created_at || null,
    };
  }

  function localAssessmentRows() {
    const rows = ["performanceRecords", "studentPerformance", "quizResults", "quizAttempts"].flatMap(readArray);
    return rows
      .filter((row) => row.teacher_id && localTeacherIds.has(String(row.teacher_id)))
      .map(normalizeAssessment)
      .filter(assignedRow);
  }

  async function loadData() {
    state.client = window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.() || null;
    state.user = null;
    if (state.client) {
      try {
        const { data, error } = await state.client.auth.getUser();
        if (!error && data?.user) state.user = data.user;
      } catch { state.user = null; }
    }
    let dbAssignments = [];
    if (state.client && state.user) {
      try {
        const { data, error } = await state.client.from("teacher_subjects").select("grade,subject").eq("teacher_id", state.user.id);
        if (!error) dbAssignments = data || [];
      } catch { /* Optional assignment table; local registration remains the source. */ }
    }
    setupAssignments(dbAssignments);
    const id = state.user?.id || "";

    if (state.client && state.user) {
      const [materials, quizzes, students, attendance, liveClasses, announcements] = await Promise.all([
        queryTeacherTable("materials"), queryTeacherTable("quizzes"), queryTeacherTable("students"),
        queryTeacherTable("attendance"), queryTeacherTable("live_classes"), queryTeacherTable("announcements"),
      ]);
      state.materials = materials;
      state.quizzes = quizzes;
      state.students = students.filter((student) => String(student.status || "Active").toLowerCase() !== "inactive");
      state.attendance = attendance;
      state.liveClasses = liveClasses;
      state.announcements = announcements;
    } else {
      const studentRows = localOwned(readArray("teacherStudents"));
      state.students = studentRows.filter(assignedRow).filter((student) => String(student.status || "Active").toLowerCase() !== "inactive");
      state.materials = localOwned(readArray(`teacherMaterials:${[...localTeacherIds][0] || "local-teacher"}`)).filter(assignedRow);
      state.quizzes = localOwned(readArray("smartLearningDC_published_quizzes")).filter(assignedRow).filter((quiz) => String(quiz.status || "published").toLowerCase() === "published");
      state.attendance = localOwned(readArray("smartLearningAttendance")).filter(assignedRow);
      state.liveClasses = localOwned(readArray("smartLearningLiveClasses")).filter(assignedRow);
      state.announcements = localOwned(readArray("smartLearningAnnouncements")).filter(assignedRow);
    }

    const ownedLiveRows = state.liveClasses;
    if (!state.client || !state.user) {
      state.liveClasses = localOwned(ownedLiveRows).filter(assignedRow);
    }
    if (state.client && state.user) {
      const [performanceRecords, quizAttempts] = await Promise.all([
        queryTeacherTable("student_performance"),
        queryTeacherTable("quiz_attempts", "*", false),
      ]);
      const assessments = [...performanceRecords, ...quizAttempts]
        .map(normalizeAssessment)
        .filter((row) => Number.isFinite(row.percentage) && assignedRow(row));
      state.performance = new Map(state.classes.map((grade) => [grade, assessments.filter((row) => gradeOf(row) === grade)]));
      const histories = await Promise.all(state.classes.flatMap((grade) => [...(state.assignments.get(grade) || [])].map(async (subject) => {
        try { return await window.AttendanceService?.getAttendanceHistory?.(grade, subject) || []; } catch { return []; }
      })));
      state.attendance = histories.flat().filter((row) => String(row.teacher_id) === String(id) && assignedRow(row));
    } else {
      const assessments = localAssessmentRows();
      state.performance = new Map(state.classes.map((grade) => [grade, assessments.filter((row) => gradeOf(row) === grade)]));
    }
    renderAll();
  }

  function statMarkup(icon, tone, value, label, note) {
    return `<article class="dashboard-stat"><span class="stat-icon ${tone}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><div class="stat-copy"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span><span class="stat-note">${escapeHtml(note)}</span></div></article>`;
  }

  function renderStats() {
    const attendancePresent = state.attendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
    const attendanceRate = state.attendance.length ? `${Math.round(attendancePresent / state.attendance.length * 100)}%` : "--";
    const studentCount = new Set(state.students.map((row) => String(row.student_id || row.id))).size;
    const values = [
      ["fa-chalkboard", "", state.classes.length || "0", "My Classes", state.classes.length ? "Registered classes" : "No classes registered yet"],
      ["fa-folder-open", "teal", state.materials.length || "0", "Materials Uploaded", state.materials.length ? "Teacher-owned materials" : "No materials uploaded yet"],
      ["fa-clipboard-check", "purple", state.quizzes.length || "0", "Quizzes Created", state.quizzes.length ? "Published assessments" : "No quizzes created yet"],
      ["fa-user-group", "green", studentCount || "0", "Total Students", studentCount ? "In your assigned classes" : "No linked students yet"],
      ["fa-video", "orange", state.liveClasses.length || "0", "Live Classes", state.liveClasses.length ? "Scheduled by you" : "No classes scheduled yet"],
      ["fa-chart-simple", "teal", attendanceRate, "Attendance Rate", state.attendance.length ? `${state.attendance.length} recorded check-ins` : "No attendance records yet"],
    ];
    $("dashboardStats").innerHTML = values.map((value) => statMarkup(...value)).join("");
  }

  function filteredPerformance(grade) {
    const period = $("performancePeriod").value;
    const now = new Date();
    const start = new Date(now);
    if (period === "week") { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
    else if (period === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
    else { start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1); start.setHours(0, 0, 0, 0); }
    return (state.performance.get(grade) || []).filter((row) => {
      const date = new Date(row.assessment_date || row.created_at || 0);
      return Number.isFinite(date.getTime()) && date >= start && assignedRow(row);
    });
  }

  function renderChart() {
    const rows = state.classes.map((grade) => {
      const scores = filteredPerformance(grade).map((row) => Number(row.percentage)).filter(Number.isFinite);
      const attendance = state.attendance.filter((row) => gradeOf(row) === grade && (!subjectOf(row) || state.assignments.get(grade)?.has(subjectOf(row))));
      const present = attendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
      return { grade, score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null, attendance: attendance.length ? present / attendance.length * 100 : null };
    });
    const hasData = rows.some((row) => row.score !== null || row.attendance !== null);
    if (!rows.length || !hasData) {
      $("performanceChart").innerHTML = `<div class="chart-empty">${rows.length ? "Performance data will appear after students complete assessments or attendance is recorded." : "No classes registered yet."}</div>`;
      return;
    }
    const chartClasses = rows.map((row) => {
      const scoreHeight = row.score === null ? 0 : Math.max(2, row.score * 1.45);
      const attendanceHeight = row.attendance === null ? 0 : Math.max(2, row.attendance * 1.45);
      return `<div class="chart-class"><div class="chart-values"><span>${row.score === null ? "--" : `${Math.round(row.score)}%`}</span><span>${row.attendance === null ? "--" : `${Math.round(row.attendance)}%`}</span></div><div class="bar-pair"><span class="bar ${row.score === null ? "no-data" : ""}" style="height:${scoreHeight}px" title="Assessment ${row.score === null ? "no data" : `${Math.round(row.score)}%`}"></span><span class="bar attendance ${row.attendance === null ? "no-data" : ""}" style="height:${attendanceHeight}px" title="Attendance ${row.attendance === null ? "no data" : `${Math.round(row.attendance)}%`}"></span></div><span class="chart-class-label">Class ${escapeHtml(row.grade)}</span></div>`;
    }).join("");
    $("performanceChart").innerHTML = `<div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Average assessment score</span><span class="legend-item"><i class="legend-dot attendance"></i>Attendance</span></div><div class="chart-scroller"><div class="chart-area"><div class="chart-y-axis"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div class="chart-columns">${chartClasses}</div></div></div>`;
  }

  function liveStatus(row, now = new Date()) {
    const start = new Date(row.start_at || row.scheduled_at || row.start_time);
    const end = new Date(row.end_at || (Number.isFinite(Number(row.duration_minutes)) ? start.getTime() + Number(row.duration_minutes) * 60000 : start.getTime() + 60 * 60000));
    if (!Number.isFinite(start.getTime())) return "Upcoming";
    if (now < start) return "Upcoming";
    if (now < end) return "Live";
    return "Completed";
  }

  function renderToday() {
    const today = new Date();
    const todayKey = today.toDateString();
    const classes = state.liveClasses.filter((item) => {
      const start = new Date(item.start_at || item.scheduled_at || item.start_time);
      return Number.isFinite(start.getTime()) && start.toDateString() === todayKey && assignedRow(item);
    }).sort((a, b) => new Date(a.start_at || a.start_time) - new Date(b.start_at || b.start_time));
    $("todaySummary").textContent = fmtDate(today, { weekday: "long", month: "long", day: "numeric" });
    $("todayClasses").innerHTML = classes.length ? classes.map((item) => {
      const start = new Date(item.start_at || item.start_time || item.scheduled_at);
      const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + Number(item.duration_minutes || 60) * 60000);
      const status = liveStatus(item, today);
      const joinUrl = item.meeting_url || item.join_url || item.meetingLink;
      const action = status !== "Completed" ? `<a class="class-open" href="${escapeHtml(joinUrl || "live_classes.html")}" ${joinUrl ? 'target="_blank" rel="noopener"' : ""}>${status === "Live" ? "Join" : "Open"}</a>` : "";
      const stream = item.stream || item.class_stream;
      return `<article class="today-class"><div class="class-time">${fmtTime(start)}<br>${fmtTime(end)}</div><div class="class-detail"><strong>${escapeHtml(item.subject || item.title || "Class")}</strong><span>Class ${escapeHtml(gradeOf(item))}${stream ? ` · ${escapeHtml(stream)}` : ""}${item.topic ? ` · ${escapeHtml(item.topic)}` : ""}</span></div><div class="class-actions"><span class="status-pill ${status.toLowerCase()}">${status}</span>${action}</div></article>`;
    }).join("") : `<div class="dashboard-empty">No classes scheduled today.</div>`;
  }

  function eventRows() {
    const liveEvents = state.liveClasses.map((row) => ({ ...row, eventType: "class", title: row.title || row.subject || "Live class", eventDate: dateOf(row), description: row.topic || "Scheduled class" }));
    const quizEvents = state.quizzes.filter((row) => row.start_at || row.due_date || row.end_at).map((row) => ({ ...row, eventType: "quiz", title: row.title || "Assessment", eventDate: row.start_at || row.due_date || row.end_at, description: row.description || row.subject || "Quiz or assessment" }));
    const announcementEvents = state.announcements.filter((row) => row.scheduled_at || row.published_at).map((row) => ({ ...row, eventType: "announcement", title: row.title || "Announcement", eventDate: row.scheduled_at || row.published_at, description: row.message || row.description || "Teacher announcement" }));
    return [...liveEvents, ...quizEvents, ...announcementEvents].filter((row) => row.eventDate && assignedRow(row) && Number.isFinite(new Date(row.eventDate).getTime())).sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
  }

  function renderCalendar() {
    const current = state.calendarDate;
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthStart = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - ((monthStart.getDay() + 6) % 7));
    const allEvents = eventRows();
    const eventDates = new Set(allEvents.map((row) => new Date(row.eventDate).toDateString()));
    $("calendarMonth").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(current);
    const weekdays = ["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span class="calendar-weekday">${day}</span>`).join("");
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const today = date.toDateString() === new Date().toDateString();
      const hasEvent = eventDates.has(date.toDateString());
      return `<span class="calendar-day ${date.getMonth() !== month ? "muted" : ""} ${today ? "today" : ""} ${hasEvent ? "has-event" : ""}">${date.getDate()}</span>`;
    }).join("");
    $("calendarGrid").innerHTML = weekdays + days;
    const now = new Date();
    const upcoming = allEvents.filter((row) => new Date(row.eventDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).slice(0, 5);
    $("eventList").innerHTML = upcoming.length ? upcoming.map((event, index) => `<button class="event-button" type="button" data-event-index="${index}"><span class="event-marker ${event.eventType}"></span><span class="event-copy"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(fmtDate(new Date(event.eventDate), { month: "short", day: "numeric" }))} · ${escapeHtml(event.subject || event.type || event.eventType)}</span></span></button>`).join("") : `<div class="dashboard-empty" style="min-height:48px;padding:8px">No upcoming events.</div>`;
    $("eventList").querySelectorAll("[data-event-index]").forEach((button) => button.addEventListener("click", () => {
      const event = upcoming[Number(button.dataset.eventIndex)];
      $("eventDialogTitle").textContent = event.title;
      $("eventDialogDate").textContent = fmtDate(new Date(event.eventDate), { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      $("eventDialogDescription").textContent = event.description || "No additional details are available.";
      $("eventDialog").showModal();
    }));
  }

  function renderSubjects() {
    const rows = state.classes.flatMap((grade) => [...(state.assignments.get(grade) || [])].map((subject) => {
      const performance = (state.performance.get(grade) || []).filter((row) => row.subject === subject && assignedRow(row));
      const average = performance.length ? Math.round(performance.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / performance.length) : null;
      const attendance = state.attendance.filter((row) => gradeOf(row) === grade && subjectOf(row) === subject);
      const present = attendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
      const rate = attendance.length ? `${Math.round(present / attendance.length * 100)}% attendance` : "No attendance data";
      return `<article class="subject-card"><span class="subject-icon"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span><div class="subject-copy"><strong>${escapeHtml(subject)}</strong><span>Class ${escapeHtml(grade)} · ${average === null ? "No assessment data" : `${average}% average`} · ${rate}</span></div></article>`;
    }));
    $("subjectGrid").innerHTML = rows.length ? rows.join("") : `<div class="dashboard-empty" style="grid-column:1/-1">No subjects assigned yet.</div>`;
  }

  function renderAll() {
    renderStats();
    renderChart();
    renderToday();
    renderCalendar();
    renderSubjects();
  }

  function subscribeRealtime() {
    if (state.client && state.user) {
      const channel = state.client.channel(`teacher-dashboard-${state.user.id}`);
      ["teacher_subjects", "materials", "quizzes", "students", "attendance", "live_classes", "announcements", "student_performance", "quiz_attempts"].forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${state.user.id}` }, scheduleRefresh);
      });
      channel.subscribe();
      window.addEventListener("beforeunload", () => state.client?.removeChannel(channel), { once: true });
    }
    ["smart-learning-live-classes-updated", "smart-learning-announcements-updated", "smart-learning-performance-updated", "smart-learning-calendar-updated"].forEach((eventName) => window.addEventListener(eventName, scheduleRefresh));
    window.addEventListener("storage", scheduleRefresh);
    state.refreshTimer = window.setInterval(scheduleRefresh, 30000);
  }

  let refreshTimeout;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = window.setTimeout(() => { if (!state.refreshing) void loadData(); }, 250);
  }

  $("performancePeriod").addEventListener("change", renderChart);
  $("calendarPrevious").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar(); });
  $("calendarNext").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar(); });
  $("closeEventDialog").addEventListener("click", () => $("eventDialog").close());
  updateClock();
  window.setInterval(updateClock, 1000);
  state.refreshing = true;
  loadData().finally(() => { state.refreshing = false; subscribeRealtime(); });
})();