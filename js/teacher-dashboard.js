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
            <option value="week">This Week</option><option value="month">This Month</option><option value="term">This Term</option><option value="year">This Year</option>
          </select>
        </div>
        <div class="chart-wrap" id="performanceChart" aria-live="polite"></div>
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
  const state = { user: null, profile: null, client: null, classes: [], gradeGroups: [], assignmentRows: [], assignments: new Map(), materials: [], quizzes: [], students: [], studentsAvailable: true, attendance: [], attendanceAvailable: true, performance: new Map(), liveClasses: [], announcements: [], calendarDate: new Date(), events: [], refreshing: false };
  let profileChannel = null;
  let stopAuthWatch = null;
  const chartState = { rows: [], assessments: [], status: "loading", message: "", requestId: 0, refreshTimer: null, periodLabel: "" };
  const gradeOf = (row) => String(row.class_grade ?? row.grade ?? row.class ?? row.class_number ?? "").match(/\d+/)?.[0] || "";
  const subjectOf = (row) => {
    const relation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    return String(relation?.name ?? row.subject_name ?? row.subject ?? "").trim();
  };
  const liveClassDate = (row) => row.class_date && row.start_time
    ? `${row.class_date}T${row.start_time}`
    : row.start_at || row.scheduled_at || row.start_time || null;
  const dateOf = (row) => row.class_date && row.start_time
    ? `${row.class_date}T${row.start_time}`
    : row.start_at || row.scheduled_at || row.start_time || row.exam_at || row.due_date || row.published_at || row.created_at || null;
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

  function setupAssignments(gradeGroups = []) {
    const assignments = new Map();
    const groupKeys = new Set();
    state.gradeGroups = gradeGroups.filter((row) => {
      const key = `${row.grade}|${row.stream || ""}`;
      if (groupKeys.has(key)) return false;
      groupKeys.add(key);
      return true;
    });
    state.classes = [...new Set(state.gradeGroups.map((row) => String(row.grade)))].sort((a, b) => Number(a) - Number(b));
    state.assignmentRows = state.gradeGroups.flatMap((group) =>
      (group.subjects || []).map((subject) => ({
        grade: Number(group.grade),
        stream: group.stream || null,
        subject: subject.name,
        subject_id: subject.id,
      })),
    );
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

  async function loadStudentsForRegisteredGroups() {
    const supportedStreams = new Set([
      "science_pcm",
      "science_pcb",
      "commerce",
      "arts_humanities",
    ]);
    const groups = state.gradeGroups.filter((group) => {
      const grade = Number(group.grade);
      const stream = String(group.stream || "").trim().toLowerCase();
      return (grade >= 5 && grade <= 10 && !stream)
        || (grade >= 11 && grade <= 12 && supportedStreams.has(stream));
    });
    if (!groups.length) {
      state.students = [];
      state.studentsAvailable = true;
      return;
    }

    const results = await Promise.all(groups.map((group) => {
      const grade = Number(group.grade);
      const stream = String(group.stream || "").trim().toLowerCase();
      let query = state.client
        .from("students")
        .select("id, student_id, full_name, email, profile_photo_url, grade, stream")
        .eq("grade", grade);
      query = stream ? query.eq("stream", stream) : query.is("stream", null);
      return readAllRows(query);
    }));

    const allowedGroups = new Set(groups.map((group) =>
      `${Number(group.grade)}|${String(group.stream || "").trim().toLowerCase()}`,
    ));
    const studentsById = new Map();
    results.flat().forEach((student) => {
      const key = `${Number(student.grade)}|${String(student.stream || "").trim().toLowerCase()}`;
      if (allowedGroups.has(key)) studentsById.set(student.id, student);
    });
    state.students = [...studentsById.values()];
    state.studentsAvailable = true;
  }

  async function readAllRows(query) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
    }
  }

  async function loadReportingSettings() {
    const { data, error } = await state.client
      .from("teacher_settings")
      .select("timezone, week_start_day")
      .eq("teacher_id", state.profile.id)
      .maybeSingle();
    if (error) throw error;
    const settings = data || { timezone: "Asia/Kolkata", week_start_day: "Monday" };
    const timezone = settings.timezone || "Asia/Kolkata";
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    const weekStartDay = settings.week_start_day || "Monday";
    if (!["Monday", "Sunday"].includes(weekStartDay)) {
      throw new Error("Your week-start setting must be Monday or Sunday.");
    }
    return { timezone, weekStartDay };
  }

  function localDateParts(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return Object.fromEntries(parts
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, Number(value)]));
  }

  function dateKey({ year, month, day }) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function addCalendarDays(key, amount) {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return dateKey({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }

  function startOfDayInTimezone(key, timezone) {
    const [year, month, day] = key.split("-").map(Number);
    const target = Date.UTC(year, month - 1, day);
    let timestamp = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const local = localDateParts(new Date(timestamp), timezone);
      const represented = Date.UTC(local.year, local.month - 1, local.day);
      const difference = represented - target;
      if (difference === 0) break;
      timestamp -= difference;
    }
    return new Date(timestamp).toISOString();
  }

  function formatDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function reportingPeriod(period, settings) {
    if (period === "term") {
      return {
        unavailable: "Academic-term dates are not configured in this project. Add a verified academic-terms source before using This Term.",
      };
    }
    const current = localDateParts(new Date(), settings.timezone);
    const todayKey = dateKey(current);
    let startDate;
    let endDate;
    let note = "";
    if (period === "week") {
      const currentDate = new Date(Date.UTC(current.year, current.month - 1, current.day));
      const weekStart = settings.weekStartDay === "Sunday" ? 0 : 1;
      const daysSinceStart = (currentDate.getUTCDay() - weekStart + 7) % 7;
      startDate = addCalendarDays(todayKey, -daysSinceStart);
      endDate = addCalendarDays(startDate, 7);
    } else if (period === "month") {
      startDate = `${current.year}-${String(current.month).padStart(2, "0")}-01`;
      endDate = current.month === 12
        ? `${current.year + 1}-01-01`
        : `${current.year}-${String(current.month + 1).padStart(2, "0")}-01`;
    } else {
      startDate = `${current.year}-01-01`;
      endDate = `${current.year + 1}-01-01`;
      note = "Calendar-year fallback (no configured academic-year setting)";
    }
    const weekNote = period === "week" ? `Week starts ${settings.weekStartDay.toLowerCase()}` : "";
    return {
      startDate,
      endDate,
      startAt: startOfDayInTimezone(startDate, settings.timezone),
      endAt: startOfDayInTimezone(endDate, settings.timezone),
      label: `${formatDateKey(startDate)} – ${formatDateKey(addCalendarDays(endDate, -1))}`,
      note: [weekNote, note].filter(Boolean).join(" · "),
    };
  }

  function classScopeKey(grade, stream) {
    return `${Number(grade)}|${String(stream || "").trim().toLowerCase()}`;
  }

  function isAssignedChartSubject(grade, stream, subjectId) {
    const key = classScopeKey(grade, stream);
    const group = state.gradeGroups.find((item) =>
      classScopeKey(item.grade, item.stream) === key);
    return Boolean(group && (
      group.teach_all_subjects
      || state.assignmentRows.some((assignment) =>
        classScopeKey(assignment.grade, assignment.stream) === key
        && String(assignment.subject_id) === String(subjectId))
    ));
  }

  function chartGroups() {
    return state.gradeGroups.map((group) => ({
      grade: Number(group.grade),
      stream: String(group.stream || "").trim().toLowerCase(),
    })).filter((group) => Number.isInteger(group.grade))
      .sort((left, right) => left.grade - right.grade || left.stream.localeCompare(right.stream));
  }

  function chartClassLabel(group) {
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const stream = group.stream
      ? streamLabels[group.stream] || formatRegistrationValue(group.stream)
      : "";
    return `Class ${group.grade}${stream ? ` · ${stream}` : ""}`;
  }

  function formatRegistrationValue(value) {
    return String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function loadChartAssessments(groups, bounds) {
    const quizzes = await readAllRows(
      state.client
        .from("quizzes")
        .select("id, grade, stream, subject_id, status")
        .eq("teacher_id", state.profile.id)
        .eq("status", "published"),
    );
    const eligibleQuizzes = (quizzes || []).filter((quiz) =>
      groups.some((group) =>
        group.grade === Number(quiz.grade)
        && group.stream === String(quiz.stream || "").trim().toLowerCase()
        && isAssignedChartSubject(quiz.grade, quiz.stream, quiz.subject_id))
      && state.students.some((student) =>
        String(student.grade) === String(quiz.grade)
        && String(student.stream || "").trim().toLowerCase() === String(quiz.stream || "").trim().toLowerCase()),
    );
    if (!eligibleQuizzes.length) return [];

    const attempts = (await Promise.all(
      Array.from({ length: Math.ceil(eligibleQuizzes.length / 100) }, (_, index) =>
        eligibleQuizzes.slice(index * 100, (index + 1) * 100),
      ).map((quizBatch) =>
        readAllRows(
          state.client
            .from("quiz_attempts")
            .select("id, quiz_id, student_id, score, total_marks, submitted_at, status")
            .in("quiz_id", quizBatch.map((quiz) => quiz.id))
            .eq("status", "submitted")
            .gte("submitted_at", bounds.startAt)
            .lt("submitted_at", bounds.endAt)
            .order("submitted_at", { ascending: true }),
        ),
      ),
    )).flat();
    const quizzesById = new Map(eligibleQuizzes.map((quiz) => [String(quiz.id), quiz]));
    const studentsById = new Map(state.students.map((student) => [String(student.id), student]));
    const latestByStudentQuiz = new Map();
    attempts.forEach((attempt) => {
      const quiz = quizzesById.get(String(attempt.quiz_id));
      const student = studentsById.get(String(attempt.student_id));
      const score = Number(attempt.score);
      const totalMarks = Number(attempt.total_marks);
      if (!quiz || !student
        || !Number.isFinite(score) || !Number.isFinite(totalMarks)
        || totalMarks <= 0 || score < 0 || score > totalMarks) return;
      if (String(student.grade) !== String(quiz.grade)
        || String(student.stream || "").trim().toLowerCase() !== String(quiz.stream || "").trim().toLowerCase()) return;
      const key = `${attempt.quiz_id}|${attempt.student_id}`;
      const previous = latestByStudentQuiz.get(key);
      if (!previous
        || String(attempt.submitted_at) > String(previous.submitted_at)
        || (attempt.submitted_at === previous.submitted_at && String(attempt.id) > String(previous.id))) {
        latestByStudentQuiz.set(key, attempt);
      }
    });
    return [...latestByStudentQuiz.values()].map((attempt) => {
      const quiz = quizzesById.get(String(attempt.quiz_id));
      const assignment = state.assignmentRows.find((item) =>
        classScopeKey(item.grade, item.stream) === classScopeKey(quiz.grade, quiz.stream)
        && String(item.subject_id) === String(quiz.subject_id));
      return {
        grade: Number(quiz.grade),
        stream: String(quiz.stream || "").trim().toLowerCase(),
        percentage: Number(attempt.score) / Number(attempt.total_marks) * 100,
        quizId: String(attempt.quiz_id),
        subject: assignment?.subject || "",
      };
    });
  }

  async function loadChartAttendance(groups, bounds) {
    const sessions = await readAllRows(
      state.client
        .from("attendance_sessions")
        .select("id, grade, stream, subject_id, attendance_date, status")
        .eq("teacher_id", state.profile.id)
        .eq("status", "completed")
        .gte("attendance_date", bounds.startDate)
        .lt("attendance_date", bounds.endDate),
    );
    const eligibleSessions = sessions.filter((session) =>
      groups.some((group) =>
        group.grade === Number(session.grade)
        && group.stream === String(session.stream || "").trim().toLowerCase()
        && isAssignedChartSubject(session.grade, session.stream, session.subject_id)),
    );
    if (!eligibleSessions.length) return [];

    const sessionById = new Map(eligibleSessions.map((session) => [String(session.id), session]));
    const records = (await Promise.all(
      Array.from({ length: Math.ceil(eligibleSessions.length / 100) }, (_, index) =>
        eligibleSessions.slice(index * 100, (index + 1) * 100),
      ).map((sessionBatch) =>
        readAllRows(
          state.client
            .from("attendance_records")
            .select("id, session_id, student_id, status")
            .in("session_id", sessionBatch.map((session) => session.id)),
        ),
      ),
    )).flat();
    const studentsById = new Map(state.students.map((student) => [String(student.id), student]));
    const uniqueRecords = new Map();
    records.forEach((record) => {
      const session = sessionById.get(String(record.session_id));
      const student = studentsById.get(String(record.student_id));
      const status = String(record.status || "").toLowerCase();
      if (!session || !student || !["present", "absent", "late"].includes(status)) return;
      if (Number(student.grade) !== Number(session.grade)
        || String(student.stream || "").trim().toLowerCase() !== String(session.stream || "").trim().toLowerCase()) return;
      uniqueRecords.set(`${session.id}|${student.id}`, {
        grade: Number(session.grade),
        stream: String(session.stream || "").trim().toLowerCase(),
        status,
      });
    });
    return [...uniqueRecords.values()];
  }

  function buildChartRows(groups, assessments, attendance) {
    return groups.map((group) => {
      const classAssessments = assessments.filter((item) =>
        item.grade === group.grade && item.stream === group.stream);
      const classAttendance = attendance.filter((item) =>
        item.grade === group.grade && item.stream === group.stream);
      const score = classAssessments.length
        ? classAssessments.reduce((sum, item) => sum + item.percentage, 0) / classAssessments.length
        : null;
      const present = classAttendance.filter((item) => item.status === "present").length;
      return {
        ...group,
        label: chartClassLabel(group),
        score,
        assessmentCount: classAssessments.length,
        assessmentQuizCount: new Set(classAssessments.map((item) => item.quizId)).size,
        attendance: classAttendance.length ? present / classAttendance.length * 100 : null,
        attendancePresent: present,
        attendanceCount: classAttendance.length,
      };
    });
  }

  async function loadAttendanceRecords(teacherId) {
    const sessions = await readAllRows(
      state.client
        .from("attendance_sessions")
        .select("id, grade, stream, subject_id, attendance_date, subjects(name)")
        .eq("teacher_id", teacherId)
        .eq("status", "completed")
        .order("attendance_date", { ascending: false }),
    );
    if (!sessions.length) {
      state.attendance = [];
      state.attendanceAvailable = true;
      return;
    }

    const recordsBySession = await Promise.all(
      Array.from({ length: Math.ceil(sessions.length / 100) }, (_, index) =>
        sessions.slice(index * 100, (index + 1) * 100),
      ).map((sessionBatch) =>
        readAllRows(
          state.client
            .from("attendance_records")
            .select("id, session_id, student_id, status, created_at, updated_at")
            .in("session_id", sessionBatch.map((session) => session.id)),
        ),
      ),
    );
    const sessionById = new Map(sessions.map((session) => [String(session.id), session]));
    state.attendance = recordsBySession.flat().flatMap((record) => {
      const session = sessionById.get(String(record.session_id));
      return session
        ? [{
          ...record,
          grade: session.grade,
          stream: session.stream,
          subject_id: session.subject_id,
          attendance_date: session.attendance_date,
          subjects: session.subjects,
        }]
        : [];
    });
    state.attendanceAvailable = true;
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
      const [gradeGroups, materialResult] = await Promise.all([
        window.TeacherData.loadRegisteredTeachingScope(state.client, teacherDbId),
        state.client.from("materials").select("id, title, grade, stream, subject_id, material_type, created_at, subjects(name)").eq("teacher_id", teacherDbId).order("created_at", { ascending: false }),
      ]);
      if (materialResult.error) throw new Error(`Unable to load materials. Check your access permissions. ${materialResult.error.message}`);
      setupAssignments(gradeGroups);
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
        ["live_classes", state.profile.id, "id, teacher_id, title, class_grade, subject, topic, grade, stream, subject_id, description, class_date, start_time, end_time, start_at, end_at, duration_minutes, meeting_platform, status, publication_status, created_at, updated_at, subjects(id, name)"],
        ["announcements", state.user.id, "*"],
      ];
      const optionalData = await Promise.all(optionalQueries.map(([table, ownerId, fields]) => queryTeacherTable(table, ownerId, fields, { optional: true })));
      const [quizzes, liveClasses, announcements] = optionalData;
      state.quizzes = quizzes;
      try {
        await loadStudentsForRegisteredGroups();
      } catch (studentError) {
        state.students = [];
        state.studentsAvailable = false;
        console.error("Unable to load students for registered teacher classes.", studentError);
      }
      try {
        await loadAttendanceRecords(profile.id);
      } catch (attendanceError) {
        state.attendance = [];
        state.attendanceAvailable = false;
        console.error("Unable to load teacher attendance records.", attendanceError);
      }
      state.liveClasses = liveClasses;
      state.announcements = announcements;
      renderAll();
      schedulePerformanceChartRefresh();

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
    const markedAttendance = state.attendance.filter((row) => ["present", "late", "absent"].includes(String(row.status || "").toLowerCase()));
    const attendancePresent = markedAttendance.filter((row) => ["present", "late"].includes(String(row.status || "").toLowerCase())).length;
    const attendanceRate = state.attendanceAvailable && markedAttendance.length
      ? `${Math.round(attendancePresent / markedAttendance.length * 100)}%`
      : "--";
    const studentCount = new Set(state.students.map((row) => String(row.id))).size;
    const subjectCount = state.assignmentRows.length;
    const values = [
      ["fa-chalkboard", "", state.classes.length || "0", "My Classes", state.classes.length ? `${subjectCount} registered subject assignments` : "No classes registered yet"],
      ["fa-folder-open", "teal", state.materials.length || "0", "Materials Uploaded", state.materials.length ? "Teacher-owned materials" : "No materials uploaded yet"],
      ["fa-clipboard-check", "purple", state.quizzes.length || "0", "Quizzes Created", state.quizzes.length ? "Published assessments" : "No quizzes created yet"],
      ["fa-user-group", "green", state.studentsAvailable ? studentCount : "—", "Total Students", state.studentsAvailable ? studentCount ? "In your assigned classes" : "No students in your assigned classes" : "Student records unavailable"],
      ["fa-video", "orange", state.liveClasses.length || "0", "Live Classes", state.liveClasses.length ? "Scheduled by you" : "No classes scheduled yet"],
      ["fa-chart-simple", "teal", attendanceRate, "Attendance Rate", !state.attendanceAvailable ? "Attendance records unavailable" : markedAttendance.length ? `${markedAttendance.length} marked attendance records` : "No attendance records yet"],
    ];
    $("dashboardStats").innerHTML = values.map((value) => statMarkup(...value)).join("");
  }

  function renderChart() {
    const root = $("performanceChart");
    const setMessage = (title, description, kind = "status", retry = false) => {
      root.innerHTML = `<div class="dashboard-blank-state" role="${kind}"><div class="empty-artwork chart-artwork" aria-hidden="true"><div class="mini-chart-card"><div class="mini-chart-lines"></div><div class="mini-chart-bars"><i></i><i></i><i></i><i></i></div><i class="fa-solid ${retry ? "fa-triangle-exclamation" : "fa-chart-column"} mini-chart-trend"></i></div></div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${retry ? '<button type="button" class="empty-state-action" id="performanceRetry"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Retry</button>' : ""}</div>`;
      $("performanceRetry")?.addEventListener("click", schedulePerformanceChartRefresh);
    };
    if (chartState.status === "loading") {
      setMessage("Loading class performance…", "Fetching published assessment results and finalized attendance.");
      return;
    }
    if (chartState.status === "error") {
      setMessage("Performance data could not be loaded", chartState.message, "alert", true);
      return;
    }
    if (chartState.status === "unavailable") {
      setMessage("This Term is unavailable", chartState.message);
      return;
    }
    const rows = chartState.rows;
    if (!rows.length) {
      setMessage("No classes registered", "Register your teaching classes to see performance.");
      return;
    }
    const assessmentTotal = rows.reduce((sum, row) => sum + row.assessmentCount, 0);
    const assessmentQuizTotal = rows.reduce((sum, row) => sum + row.assessmentQuizCount, 0);
    const attendanceTotal = rows.reduce((sum, row) => sum + row.attendanceCount, 0);
    const attendancePresent = rows.reduce((sum, row) => sum + row.attendancePresent, 0);
    const periodSummary = `${chartState.periodLabel}${chartState.periodNote ? ` · ${chartState.periodNote}` : ""}`;
    const chartClasses = rows.map((row) => {
      const scoreText = row.score === null ? "--" : `${Math.round(row.score)}%`;
      const attendanceText = row.attendance === null ? "--" : `${Math.round(row.attendance)}%`;
      const scoreHeight = row.score === null ? 0 : Math.max(2, row.score * 2);
      const attendanceHeight = row.attendance === null ? 0 : Math.max(2, row.attendance * 2);
      const scoreTitle = `${row.label} · Average assessment score: ${row.score === null ? "No assessment data" : `${row.score.toFixed(1)}%`} · ${row.assessmentCount} unique graded student-assessment result(s) across ${row.assessmentQuizCount} published assessment(s) · ${periodSummary}`;
      const attendanceTitle = `${row.label} · Attendance: ${row.attendance === null ? "No finalized attendance data" : `${row.attendance.toFixed(1)}% (${row.attendancePresent}/${row.attendanceCount})`} · Present records / finalized student-session records · ${periodSummary}`;
      return `<div class="chart-class"><div class="chart-values"><span>${scoreText}</span><span>${attendanceText}</span></div><div class="bar-pair"><span class="bar ${row.score === null ? "no-data" : ""}" style="height:${scoreHeight}px" title="${escapeHtml(scoreTitle)}" aria-label="${escapeHtml(scoreTitle)}"></span><span class="bar attendance ${row.attendance === null ? "no-data" : ""}" style="height:${attendanceHeight}px" title="${escapeHtml(attendanceTitle)}" aria-label="${escapeHtml(attendanceTitle)}"></span></div><span class="chart-class-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span></div>`;
    }).join("");
    const assessmentSummary = assessmentTotal
      ? `${assessmentTotal} graded student-assessment result(s) across ${assessmentQuizTotal} published assessment(s)`
      : "No assessment data";
    const attendanceSummary = attendanceTotal
      ? `${attendancePresent} present of ${attendanceTotal} finalized student-session record(s)`
      : "No finalized attendance data";
    root.innerHTML = `<div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Average assessment score</span><span class="legend-item"><i class="legend-dot attendance"></i>Attendance</span></div><div class="chart-legend" role="status">${escapeHtml(periodSummary)} · Assessment: ${escapeHtml(assessmentSummary)} · Attendance: ${escapeHtml(attendanceSummary)}</div><div class="chart-scroller"><div class="chart-area"><div class="chart-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="chart-columns">${chartClasses}</div></div></div>`;
  }

  function schedulePerformanceChartRefresh() {
    chartState.requestId += 1;
    const requestId = chartState.requestId;
    window.clearTimeout(chartState.refreshTimer);
    chartState.status = "loading";
    renderChart();
    chartState.refreshTimer = window.setTimeout(() => {
      void loadPerformanceChart(requestId);
    }, 120);
  }

  async function loadPerformanceChart(requestId) {
    try {
      const settings = await loadReportingSettings();
      const bounds = reportingPeriod($("performancePeriod").value, settings);
      if (requestId !== chartState.requestId) return;
      if (bounds.unavailable) {
        chartState.status = "unavailable";
        chartState.message = bounds.unavailable;
        renderChart();
        return;
      }
      if (!state.studentsAvailable) {
        throw new Error("Student records could not be verified for your registered classes. Performance data is withheld until the Students page data is available.");
      }
      const groups = chartGroups();
      const [assessments, attendance] = groups.length
        ? await Promise.all([
          loadChartAssessments(groups, bounds),
          loadChartAttendance(groups, bounds),
        ])
        : [[], []];
      if (requestId !== chartState.requestId) return;
      const period = $("performancePeriod").value;
      chartState.periodLabel = {
        week: "This Week",
        month: "This Month",
        year: "This Year",
      }[period] || period;
      chartState.periodNote = [bounds.note, bounds.timezone ? `Timezone: ${bounds.timezone}` : ""]
        .filter(Boolean)
        .join(" · ");
      chartState.periodLabel += ` · ${bounds.label}`;
      chartState.rows = buildChartRows(groups, assessments, attendance);
      chartState.assessments = assessments;
      state.performance = new Map(state.classes.map((grade) => [
        grade,
        assessments.filter((item) => String(item.grade) === grade),
      ]));
      chartState.status = "ready";
      chartState.message = "";
      renderChart();
      renderSubjects();
    } catch (error) {
      if (requestId !== chartState.requestId) return;
      chartState.status = "error";
      chartState.message = error?.message || "Check your connection and access permissions, then retry.";
      console.error("Unable to load class performance chart data.", error);
      renderChart();
    }
  }

  function liveStatus(row, now = new Date()) {
    const storedStatus = String(row.status || "scheduled").trim().toLowerCase();
    if (["completed", "attended", "done", "finished"].includes(storedStatus)) return "Completed";
    if (["cancelled", "canceled"].includes(storedStatus)) return "Cancelled";
    if (storedStatus === "missed") return "Missed";
    if (["live", "live now", "in_progress", "in progress", "ongoing"].includes(storedStatus)) return "Live";
    const start = new Date(liveClassDate(row));
    const end = new Date(row.end_at || (Number.isFinite(Number(row.duration_minutes)) ? start.getTime() + Number(row.duration_minutes) * 60000 : start.getTime() + 60 * 60000));
    if (!Number.isFinite(start.getTime())) return "Upcoming";
    return now >= end ? "Missed" : "Upcoming";
  }

  function renderToday() {
    const today = new Date();
    const todayKey = today.toDateString();
    const classes = state.liveClasses.filter((item) => {
      const start = new Date(liveClassDate(item));
      return item.publication_status === "published"
        && Number.isFinite(start.getTime())
        && start.toDateString() === todayKey
        && assignedRow(item);
    }).sort((a, b) => new Date(liveClassDate(a)) - new Date(liveClassDate(b)));
    $("todaySummary").textContent = fmtDate(today, { weekday: "long", month: "long", day: "numeric" });
    $("todayClasses").innerHTML = classes.length ? classes.map((item) => {
      const start = new Date(liveClassDate(item));
      const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + Number(item.duration_minutes || 60) * 60000);
      const status = liveStatus(item, today);
      const action = status === "Live"
        ? `<button class="class-open" type="button" data-teacher-live-class-id="${escapeHtml(item.id)}">Join</button>`
        : ["Completed", "Missed", "Cancelled"].includes(status) ? "" : '<a class="class-open" href="live_classes.html">Open</a>';
      const stream = item.stream || item.class_stream;
      return `<article class="today-class"><div class="class-time">${fmtTime(start)}<br>${fmtTime(end)}</div><div class="class-detail"><strong>${escapeHtml(subjectOf(item) || item.title || "Class")}</strong><span>Class ${escapeHtml(gradeOf(item))}${stream ? ` · ${escapeHtml(stream)}` : ""}${item.topic ? ` · ${escapeHtml(item.topic)}` : ""}</span></div><div class="class-actions"><span class="status-pill ${status.toLowerCase()}">${status}</span>${action}</div></article>`;
    }).join("") : emptyStateMarkup("schedule", "fa-calendar-days", "No classes scheduled today", "Your planned classes will appear here once you schedule them.", "create_liveclass.html", "Schedule a class");
    $("todayClasses").querySelectorAll("[data-teacher-live-class-id]").forEach((button) => {
      button.addEventListener("click", () => openTeacherLiveClass(button.dataset.teacherLiveClassId));
    });
  }

  async function openTeacherLiveClass(classId) {
    const meetingWindow = window.open("about:blank", "_blank");
    if (meetingWindow) meetingWindow.opener = null;
    try {
      const meetingUrl = await window.LiveClassService.getMeetingUrl(classId);
      const parsedUrl = new URL(meetingUrl);
      if (parsedUrl.protocol !== "https:") throw new Error("Meeting link is not a secure HTTPS URL.");
      if (meetingWindow) meetingWindow.location.replace(parsedUrl.href);
      else window.location.assign(parsedUrl.href);
    } catch (error) {
      meetingWindow?.close();
      console.error("Could not authorize the teacher live-class meeting link.", error);
      window.alert(error.message || "Meeting link is unavailable.");
    }
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
      const authOwnedTables = ["announcements"];
      teacherProfileTables.forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${state.profile.id}` }, scheduleRefresh);
      });
      authOwnedTables.forEach((table) => {
        const ownerId = state.user.id;
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${ownerId}` }, scheduleRefresh);
      });
      channel.on("postgres_changes", { event: "*", schema: "public", table: "students" }, scheduleRefresh);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "attendance_sessions", filter: `teacher_id=eq.${state.profile.id}` }, scheduleRefresh);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, scheduleRefresh);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "live_class_updates", filter: `teacher_id=eq.${state.profile.id}` }, scheduleRefresh);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts" }, scheduleRefresh);
      channel.subscribe();
      window.addEventListener("beforeunload", () => {
        state.client?.removeChannel(channel);
        if (profileChannel) state.client?.removeChannel(profileChannel);
        stopAuthWatch?.();
      }, { once: true });
    }
    ["smart-learning-live-classes-updated", "smart-learning-announcements-updated", "smart-learning-performance-updated", "smart-learning-calendar-updated"].forEach((eventName) => window.addEventListener(eventName, scheduleRefresh));
    window.addEventListener("beforeunload", () => {
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

  $("performancePeriod").addEventListener("change", schedulePerformanceChartRefresh);
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