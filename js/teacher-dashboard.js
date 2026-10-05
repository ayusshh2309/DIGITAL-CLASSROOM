(() => {
  const root = document.getElementById("teacherDashboard");
  if (!root) return;
  window.teacherDashboardRedesigned = true;

  root.innerHTML = `
    <div class="dashboard-data-notice" id="dashboardDataNotice" role="status" aria-live="polite">Loading your dashboard data...</div>
    <section class="dashboard-hero" aria-labelledby="greetingEl">
      <span class="hero-mark" aria-hidden="true"><i class="fa-solid fa-graduation-cap"></i></span>
      <div class="hero-copy">
        <h1 id="greetingEl">Good morning!</h1>
        <p>Here's what's happening in your classroom today.</p>
        <div class="hero-meta" aria-label="Current local date and time">
          <span class="hero-meta-pill"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><span id="dashboardDate"></span></span>
          <span class="hero-meta-pill"><i class="fa-regular fa-clock" aria-hidden="true"></i><span id="dashboardTime"></span></span>
        </div>
      </div>
      <div class="hero-quote"><span>“Better Teaching<br>Builds Brighter Futures”</span><i class="fa-solid fa-seedling" aria-hidden="true"></i></div>
    </section>
    <section class="dashboard-stats" aria-label="Classroom statistics" id="dashboardStats"></section>
    <div class="dashboard-analytics">
      <section class="dashboard-panel">
        <div class="panel-heading">
          <div><h2><i class="fa-solid fa-chart-column" aria-hidden="true"></i> Class performance overview</h2><div class="panel-kicker">Assessment scores and attendance</div></div>
          <select class="period-select" id="performancePeriod" aria-label="Performance period">
            <option value="week">This Week</option><option value="month">This Month</option><option value="term">This Term</option>
          </select>
        </div>
        <div class="chart-wrap" id="performanceChart"></div>
      </section>
      <section class="dashboard-panel">
        <div class="panel-heading"><div><h2><i class="fa-solid fa-calendar-day" aria-hidden="true"></i> Today's classes</h2><div class="panel-kicker" id="todaySummary"></div></div><a class="panel-link" href="live_classes.html">View all <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
        <div class="today-list" id="todayClasses"></div>
      </section>
      <section class="dashboard-panel">
        <div class="panel-heading"><div><h2><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Calendar</h2></div><a class="panel-link" href="calendar.html">View all <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
        <div class="calendar-top"><span class="calendar-month" id="calendarMonth"></span><div class="calendar-nav"><button type="button" id="calendarPrevious" aria-label="Previous month">‹</button><button type="button" id="calendarNext" aria-label="Next month">›</button></div></div>
        <div class="calendar-grid" id="calendarGrid"></div><div class="event-list" id="eventList"></div>
      </section>
    </div>
    <section class="dashboard-panel">
      <div class="panel-heading"><div><h2><i class="fa-solid fa-book-open" aria-hidden="true"></i> Your Classes &amp; Subjects</h2><div class="panel-kicker">Subjects assigned to your registered classes</div></div></div>
      <div class="subject-classes" id="subjectGrid"></div>
    </section>
    <section class="dashboard-panel">
      <div class="panel-heading"><div><h2><i class="fa-solid fa-folder-open" aria-hidden="true"></i> Recent Materials</h2><div class="panel-kicker">Materials uploaded by you</div></div><a class="panel-link" href="materials.html">View all <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
      <div class="dashboard-material-list" id="dashboardMaterials"></div>
    </section>
    <dialog class="event-dialog" id="eventDialog"><button type="button" id="closeEventDialog">Close</button><h2 id="eventDialogTitle"></h2><p id="eventDialogDate"></p><p id="eventDialogDescription"></p></dialog>`;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  let teacherName = "N/A";
  const profileName = () => document.getElementById("profileNameEl");
  const avatar = () => document.getElementById("avatarImg");
  if (profileName()) profileName().textContent = "Loading profile...";
  if (avatar()) avatar().hidden = true;
  const state = { user: null, profile: null, client: null, classes: [], gradeGroups: [], assignmentRows: [], assignments: new Map(), materials: [], quizzes: [], students: [], attendance: [], performance: new Map(), liveClasses: [], announcements: [], calendarDate: new Date(), events: [], refreshTimer: null, refreshing: false };
  let profileChannel = null;
  let stopAuthWatch = null;
  const gradeOf = (row) => String(row.class_grade ?? row.grade ?? row.class ?? row.class_number ?? "").match(/\d+/)?.[0] || "";
  const subjectOf = (row) => {
    const relation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    return String(relation?.name ?? row.subject_name ?? row.subject ?? "").trim();
  };
  const dateOf = (row) => row.start_at || row.scheduled_at || row.start_time || row.exam_at || row.due_date || row.published_at || row.created_at || null;
  const streamOf = (row) => {
    const quiz = state.quizzes.find((item) => String(item.id) === String(row.quiz_id || row.assessment_id || row.id));
    return String(row.stream ?? row.class_stream ?? quiz?.stream ?? "").trim();
  };
  const registeredGroup = (row) => state.gradeGroups.some((group) => String(group.grade) === gradeOf(row) && (!streamOf(row) || String(group.stream || "") === streamOf(row)));
  const assignedRow = (row) => {
    if (!registeredGroup(row)) return false;
    const quiz = state.quizzes.find((item) => String(item.id) === String(row.quiz_id || row.assessment_id || row.id));
    const subjectId = String(row.subject_id || quiz?.subject_id || "");
    const subjectName = subjectOf(row) || subjectOf(quiz || {});
    return state.assignmentRows.some((assignment) =>
      String(assignment.grade) === gradeOf(row)
      && (!streamOf(row) || String(assignment.stream || "") === streamOf(row))
      && (subjectId
        ? String(assignment.subject_id) === subjectId
        : !subjectName || assignment.subject.toLowerCase() === subjectName.toLowerCase()),
    );
  };
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

  function setupAssignments(gradeGroups = [], databaseAssignments = [], subjectCatalog = []) {
    const assignments = new Map();
    const groupKeys = new Set();
    state.gradeGroups = gradeGroups.filter((row) => {
      const key = `${row.grade}|${row.stream || ""}`;
      if (groupKeys.has(key)) return false;
      groupKeys.add(key);
      return true;
    });
    state.classes = [...new Set(state.gradeGroups.map((row) => String(row.grade)))].sort((a, b) => Number(a) - Number(b));
    const assignmentKeys = new Set();
    state.assignmentRows = databaseAssignments.map((row) => {
      const joinedSubject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
      if (!joinedSubject?.name) throw new Error(`Registered subject ID ${row.subject_id} is missing from public.subjects.`);
      return { grade: Number(row.grade), stream: row.stream || null, subject: joinedSubject.name, subject_id: row.subject_id };
    }).filter((row) => {
      const key = `${row.grade}|${row.stream || ""}|${row.subject_id}`;
      if (assignmentKeys.has(key)) return false;
      assignmentKeys.add(key);
      return true;
    });
    const standardSubjects = {
      5: ["English", "Mathematics", "EVS", "Hindi"],
      6: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      7: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      8: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      9: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      10: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    const streamSubjects = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts_humanities: ["History", "Geography", "Political Science", "Psychology"],
    };
    state.gradeGroups.filter((group) => group.teach_all_subjects).forEach((group) => {
      const expected = Number(group.grade) < 11
        ? standardSubjects[Number(group.grade)] || []
        : [...(streamSubjects[group.stream] || []), "English", "Physical Education", "Computer Science"];
      expected.forEach((name) => {
        const subject = subjectCatalog.find((item) => String(item.name).trim().toLowerCase() === name.toLowerCase());
        if (!subject) {
          console.warn(`Subject '${name}' is missing from public.subjects.`);
          return;
        }
        const key = `${group.grade}|${group.stream || ""}|${subject.id}`;
        if (assignmentKeys.has(key)) return;
        assignmentKeys.add(key);
        state.assignmentRows.push({ grade: Number(group.grade), stream: group.stream || null, subject: subject.name, subject_id: subject.id });
      });
    });
    state.assignmentRows.forEach((row) => {
      const grade = String(row.grade);
      if (!assignments.has(grade)) assignments.set(grade, new Set());
      assignments.get(grade).add(row.subject);
    });
    state.assignments = assignments;
  }

  async function queryTeacherTable(table, ownerId, fields = "*", options = {}) {
    const { data, error } = await state.client.from(table).select(fields).eq("teacher_id", ownerId);
    if (error) {
      console.error(`Unable to load dashboard ${table}.`, error);
      if (options.optional) {
        console.warn(`Optional dashboard data unavailable for ${table}:`, error);
        return [];
      }
      throw new Error(`Unable to load ${table}. Check your access permissions. ${error.message}`);
    }
    return data || [];
  }

  function normalizeAssessment(row) {
    const quiz = state.quizzes.find((item) => String(item.id) === String(row.quiz_id || row.assessment_id));
    const score = Number(row.score ?? row.marks_obtained ?? row.obtained_marks ?? 0);
    const total = Number(row.total_marks ?? row.max_score ?? row.points_possible ?? quiz?.total_marks ?? 0);
    const subjectId = row.subject_id || quiz?.subject_id || null;
    const assignment = state.assignmentRows.find((item) =>
      String(item.grade) === String(row.grade || quiz?.grade || "")
      && String(item.subject_id || "") === String(subjectId || "")
      && (!streamOf(row) || String(item.stream || "") === streamOf(row)),
    );
    return {
      ...row,
      class_grade: row.class_grade || row.grade || gradeOf(quiz || {}),
      stream: row.stream || quiz?.stream || "",
      subject_id: subjectId,
      subject: row.subject || subjectOf(quiz || {}) || assignment?.subject || "",
      percentage: Number(row.percentage ?? row.percent ?? (total > 0 ? score / total * 100 : NaN)),
      assessment_date: row.assessment_date || row.submitted_at || row.completed_at || row.created_at || null,
    };
  }

  function renderDataNotice(message = "", isError = false) {
    const notice = $("dashboardDataNotice");
    notice.textContent = message;
    notice.hidden = !message;
    notice.classList.toggle("is-error", isError);
    notice.setAttribute("role", isError ? "alert" : "status");
  }

  function renderMaterials() {
    const rows = [...state.materials].sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)).slice(0, 5);
    $("dashboardMaterials").innerHTML = rows.length ? rows.map((item) => {
      const subject = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
      const details = [`Grade ${item.grade ?? "N/A"}`, item.stream, subject?.name, item.material_type, item.created_at ? fmtDate(new Date(item.created_at), { day: "numeric", month: "short", year: "numeric" }) : "N/A"].filter(Boolean);
      return `<article class="dashboard-material-row"><strong>${escapeHtml(item.title || "Untitled material")}</strong><span>${escapeHtml(details.join(" · "))}</span></article>`;
    }).join("") : '<p class="dashboard-empty">No materials uploaded yet.</p>';
  }

  async function loadData() {
    renderDataNotice("Loading your dashboard data...");
    try {
      state.client = window.TeacherData?.getSupabaseClient?.() || null;
      if (!state.client) throw new Error("Supabase is unavailable. Check the shared Supabase client configuration.");
      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError) {
        if (authError.name === "AuthSessionMissingError" || authError.code === "session_not_found") {
          window.location.assign("../teacher_registration/login.html");
          return;
        }
        throw authError;
      }
      if (!authData.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      state.user = authData.user;
      const { data: profile, error: profileError } = await state.client.from("teachers").select("*").eq("user_id", state.user.id).maybeSingle();
      if (profileError) throw new Error(`Unable to load your teacher profile. Check your access permissions. ${profileError.message}`);
      if (!profile) throw new Error("No teacher record was found for the authenticated account.");
      state.profile = profile;

      const teacherDbId = profile.id;
      const [gradeResult, assignmentResult, materialResult] = await Promise.all([
        state.client.from("teacher_grade_groups").select("grade, stream, teach_all_subjects").eq("teacher_id", teacherDbId),
        state.client.from("teacher_subject_assignments").select("subject_id, grade, stream, subjects(name)").eq("teacher_id", teacherDbId),
        state.client.from("materials").select("id, title, grade, stream, subject_id, material_type, created_at, subjects(name)").eq("teacher_id", teacherDbId).order("created_at", { ascending: false }),
      ]);
      for (const [name, result] of [["teacher_grade_groups", gradeResult], ["teacher_subject_assignments", assignmentResult], ["materials", materialResult]]) {
        if (result.error) throw new Error(`Unable to load ${name}. Check your access permissions. ${result.error.message}`);
      }
      const gradeGroups = gradeResult.data || [];
      const assignmentRows = assignmentResult.data || [];
      let subjectCatalog = [];
      if (gradeGroups.some((group) => group.teach_all_subjects)) {
        const { data, error } = await state.client.from("subjects").select("id, name");
        if (error) throw new Error(`Unable to load subjects for teach-all assignments. ${error.message}`);
        subjectCatalog = data || [];
      }
      setupAssignments(gradeGroups, assignmentRows, subjectCatalog);
      state.materials = materialResult.data || [];

      teacherName = profile.full_name || "N/A";
      if (profileName()) profileName().textContent = teacherName;
      if (avatar()) {
        if (profile.profile_photo_url) {
          try {
            avatar().src = await window.TeacherData.getTeacherProfilePhotoUrl(profile.profile_photo_url);
            avatar().hidden = false;
          } catch (photoError) {
            console.error("Unable to load teacher profile photo.", photoError);
            avatar().hidden = true;
          }
        } else {
          avatar().removeAttribute("src");
          avatar().hidden = true;
        }
      }
      renderMaterials();
      updateClock();

      const optionalQueries = [
        ["quizzes", state.profile.id, "*"],
        ["students", state.user.id, "*"],
        ["attendance", state.user.id, "*"],
        ["live_classes", state.user.id, "*, subjects(id, name)"],
        ["announcements", state.user.id, "*"],
      ];
      const optionalData = await Promise.all(optionalQueries.map(([table, ownerId, fields]) => queryTeacherTable(table, ownerId, fields, { optional: true })));
      const [quizzes, students, attendance, liveClasses, announcements] = optionalData;
      state.quizzes = quizzes;
      state.students = students.filter((student) => String(student.status || "Active").toLowerCase() !== "inactive");
      state.attendance = attendance;
      state.liveClasses = liveClasses;
      state.announcements = announcements;
      let quizAttempts = [];
      let performanceLoadError = false;
      if (quizzes.length) {
        const { data, error } = await state.client
          .from("quiz_attempts")
          .select("id, quiz_id, student_id, score, total_marks, percentage, submitted_at, status")
          .in("quiz_id", quizzes.map((quiz) => quiz.id))
          .eq("status", "submitted")
          .order("submitted_at", { ascending: true });
        if (error) {
          console.error("Unable to load dashboard quiz results.", error);
          performanceLoadError = true;
        } else {
          quizAttempts = data || [];
        }
      }
      const assessments = quizAttempts.map(normalizeAssessment).filter((row) => Number.isFinite(row.percentage) && assignedRow(row));
      state.performance = new Map(state.classes.map((grade) => [grade, assessments.filter((row) => gradeOf(row) === grade)]));
      renderAll();
      if (performanceLoadError) renderDataNotice("Quiz performance is temporarily unavailable.", true);
      else if (!quizAttempts.length) renderDataNotice();

      if (!profileChannel && window.TeacherData?.subscribeToTeacherProfile) {
        profileChannel = state.client.channel(`teacher-dashboard-profile-${state.user.id}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "teachers", filter: `user_id=eq.${state.user.id}` }, scheduleRefresh)
          .subscribe();
        stopAuthWatch = window.TeacherData.watchAuthState(() => window.location.assign("../teacher_registration/login.html"));
      }
    } catch (error) {
      console.error("Unable to load teacher dashboard data.", error);
      if (profileName()) profileName().textContent = "Unable to load profile";
      renderDataNotice(error?.message || "Dashboard data could not be loaded.", true);
    }
  }

  function statMarkup(icon, tone, value, label, note) {
    return `<article class="dashboard-stat tone-${tone || "blue"}"><span class="stat-icon ${tone}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><div class="stat-copy"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span><span class="stat-note">${escapeHtml(note)}</span></div></article>`;
  }

  function emptyStateMarkup(variant, icon, title, description, href, actionLabel) {
    const artwork = variant === "chart"
      ? `<div class="empty-artwork chart-artwork" aria-hidden="true"><div class="mini-chart-card"><div class="mini-chart-lines"></div><div class="mini-chart-bars"><i></i><i></i><i></i><i></i></div><i class="fa-solid fa-arrow-trend-up mini-chart-trend"></i></div></div>`
      : `<div class="empty-artwork schedule-artwork" aria-hidden="true"><i class="fa-regular ${icon}"></i><i class="fa-regular fa-clock schedule-clock"></i></div>`;
    const actionIcon = actionLabel === "View Classes" ? "fa-chalkboard" : variant === "chart" ? "fa-chart-line" : "fa-circle-plus";
    return `<div class="dashboard-blank-state ${variant}-blank-state">${artwork}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p><a class="empty-state-action" href="${escapeHtml(href)}"><i class="fa-solid ${actionIcon}" aria-hidden="true"></i>${escapeHtml(actionLabel)}</a></div>`;
  }

  function renderStats() {
    const attendancePresent = state.attendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
    const attendanceRate = state.attendance.length ? `${Math.round(attendancePresent / state.attendance.length * 100)}%` : "--";
    const studentCount = new Set(state.students.map((row) => String(row.student_id || row.id))).size;
    const subjectCount = state.assignmentRows.length;
    const values = [
      ["fa-chalkboard", "", state.classes.length || "0", "My Classes", state.classes.length ? `${subjectCount} registered subject assignments` : "No classes registered yet"],
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
      $("performanceChart").innerHTML = emptyStateMarkup(
        "chart",
        "",
        rows.length ? "Performance data will appear here" : "No classes registered yet",
        rows.length ? "After students complete assessments or attendance is recorded, you'll see class insights and trends." : "Register your classes to start tracking performance.",
        rows.length ? "student_performance.html" : "my_classes.html",
        rows.length ? "View Analytics" : "View Classes",
      );
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
      return `<article class="today-class"><div class="class-time">${fmtTime(start)}<br>${fmtTime(end)}</div><div class="class-detail"><strong>${escapeHtml(subjectOf(item) || item.title || "Class")}</strong><span>Class ${escapeHtml(gradeOf(item))}${stream ? ` · ${escapeHtml(stream)}` : ""}${item.topic ? ` · ${escapeHtml(item.topic)}` : ""}</span></div><div class="class-actions"><span class="status-pill ${status.toLowerCase()}">${status}</span>${action}</div></article>`;
    }).join("") : emptyStateMarkup("schedule", "fa-calendar-days", "No classes scheduled today", "Your planned classes will appear here once you schedule them.", "create_liveclass.html", "Schedule a class");
  }

  function eventRows() {
    const liveEvents = state.liveClasses.map((row) => ({ ...row, subject_name: subjectOf(row), eventType: "class", title: row.title || subjectOf(row) || "Live class", eventDate: dateOf(row), description: row.topic || "Scheduled class" }));
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
    $("eventList").innerHTML = upcoming.length ? upcoming.map((event, index) => `<button class="event-button" type="button" data-event-index="${index}"><span class="event-marker ${event.eventType}"></span><span class="event-copy"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(fmtDate(new Date(event.eventDate), { month: "short", day: "numeric" }))} · ${escapeHtml(event.subject || event.type || event.eventType)}</span></span></button>`).join("") : `<div class="calendar-empty"><span><i class="fa-regular fa-calendar-days" aria-hidden="true"></i></span><div><strong>No upcoming events</strong><small>You don't have any events scheduled.</small></div></div>`;
    $("eventList").querySelectorAll("[data-event-index]").forEach((button) => button.addEventListener("click", () => {
      const event = upcoming[Number(button.dataset.eventIndex)];
      $("eventDialogTitle").textContent = event.title;
      $("eventDialogDate").textContent = fmtDate(new Date(event.eventDate), { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      $("eventDialogDescription").textContent = event.description || "No additional details are available.";
      $("eventDialog").showModal();
    }));
  }

  function renderSubjects() {
    const iconBySubject = {
      Physics: ["fa-atom", "blue"], Chemistry: ["fa-flask", "purple"], Mathematics: ["fa-square-root-variable", "blue"],
      Biology: ["fa-leaf", "green"], English: ["fa-book-open", "cyan"], "Computer Science": ["fa-code", "green"],
    };
    const streamLabels = { science_pcm: "PCM", science_pcb: "PCB", commerce: "Commerce", arts_humanities: "Arts / Humanities" };
    const sections = state.gradeGroups.map((group) => {
      const grade = String(group.grade);
      const stream = group.stream || null;
      const assignments = state.assignmentRows.filter((row) => row.grade === Number(grade) && String(row.stream || "") === String(stream || ""));
      const subjects = assignments.map((row) => row.subject).sort((first, second) => first.localeCompare(second));
      const subjectCards = assignments.map((assignment) => {
        const subject = assignment.subject;
        const performance = (state.performance.get(grade) || []).filter((row) => row.subject === subject && String(row.stream || "") === String(stream || "") && assignedRow(row));
        const average = performance.length ? Math.round(performance.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / performance.length) : null;
        const attendance = state.attendance.filter((row) => gradeOf(row) === grade && subjectOf(row) === subject && String(streamOf(row) || "") === String(stream || ""));
        const present = attendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
        const progress = average ?? (attendance.length ? Math.round(present / attendance.length * 100) : null);
        const progressLabel = progress === null ? "No performance data" : `${progress}% performance`;
        const [icon, tone] = iconBySubject[subject] || ["fa-book-open", "blue"];
        return `<a class="subject-card tone-${tone}" href="my_classes.html?class_grade=${encodeURIComponent(grade)}${stream ? `&stream=${encodeURIComponent(stream)}` : ""}" aria-label="View ${escapeHtml(subject)} in Class ${escapeHtml(grade)}${stream ? ` ${escapeHtml(stream)}` : ""}"><span class="subject-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="subject-copy"><span class="subject-topline"><strong>${escapeHtml(subject)}</strong><span class="subject-assigned">Assigned</span></span><span class="subject-progress" role="img" aria-label="${progressLabel}"><span style="width:${progress ?? 0}%"></span></span></span><i class="fa-solid fa-chevron-right subject-chevron" aria-hidden="true"></i></a>`;
      }).join("");
      const heading = `${subjects.length} Assigned Subjects`;
      return `<section class="subject-class-panel"><header class="subject-class-header"><div class="subject-class-identity"><span class="subject-class-badge">Class ${escapeHtml(grade)}</span><h3>${escapeHtml(heading)}</h3>${stream ? `<span class="subject-stream-badge"><i class="fa-solid fa-flask" aria-hidden="true"></i> Stream <strong>${escapeHtml(streamLabels[stream] || stream)}</strong></span>` : ""}</div><span class="subject-class-active"><i class="fa-solid fa-circle" aria-hidden="true"></i> Registered</span><a class="subject-class-link" href="my_classes.html?class_grade=${encodeURIComponent(grade)}${stream ? `&stream=${encodeURIComponent(stream)}` : ""}">View subjects <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></a></header><div class="subject-class-subjects">${subjectCards || '<p class="dashboard-empty">No subjects registered for this grade and stream.</p>'}</div></section>`;
    });
    $("subjectGrid").innerHTML = sections.length ? sections.join("") : `<div class="dashboard-empty">No subjects assigned yet.</div>`;
  }

  function renderAll() {
    renderStats();
    renderChart();
    renderToday();
    renderCalendar();
    renderSubjects();
  }

  function subscribeRealtime() {
    if (state.client && state.user && state.profile?.id) {
      const channel = state.client.channel(`teacher-dashboard-${state.user.id}`);
      const teacherProfileTables = ["teacher_grade_groups", "teacher_subject_assignments", "materials", "quizzes"];
      const authOwnedTables = ["students", "attendance", "live_classes", "announcements"];
      teacherProfileTables.forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${state.profile.id}` }, scheduleRefresh);
      });
      authOwnedTables.forEach((table) => {
        const ownerId = state.user.id;
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${ownerId}` }, scheduleRefresh);
      });
      channel.on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts" }, scheduleRefresh);
      channel.subscribe();
      window.addEventListener("beforeunload", () => {
        state.client?.removeChannel(channel);
        if (profileChannel) state.client?.removeChannel(profileChannel);
        stopAuthWatch?.();
      }, { once: true });
    }
    ["smart-learning-live-classes-updated", "smart-learning-announcements-updated", "smart-learning-performance-updated", "smart-learning-calendar-updated"].forEach((eventName) => window.addEventListener(eventName, scheduleRefresh));
    state.refreshTimer = window.setInterval(scheduleRefresh, 30000);
    window.addEventListener("beforeunload", () => {
      window.clearInterval(state.refreshTimer);
      window.clearTimeout(refreshTimeout);
    }, { once: true });
  }

  let refreshTimeout;
  let refreshPending = false;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = window.setTimeout(() => {
      if (state.refreshing) {
        refreshPending = true;
        return;
      }
      state.refreshing = true;
      void loadData().finally(() => {
        state.refreshing = false;
        if (refreshPending) {
          refreshPending = false;
          scheduleRefresh();
        }
      });
    }, 250);
  }

  $("performancePeriod").addEventListener("change", renderChart);
  $("calendarPrevious").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar(); });
  $("calendarNext").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar(); });
  $("closeEventDialog").addEventListener("click", () => $("eventDialog").close());
  updateClock();
  window.setInterval(updateClock, 1000);
  document.addEventListener("DOMContentLoaded", () => {
    state.refreshing = true;
    loadData().finally(() => {
      state.refreshing = false;
      subscribeRealtime();
      if (refreshPending) {
        refreshPending = false;
        scheduleRefresh();
      }
    });
  });
})();