(() => {
  const root = document.querySelector(".dashboard-redesign");
  if (!root) return;

  const state = {
    client: null,
    user: null,
    profile: {},
    subjects: [],
    events: [],
    materials: [],
    videos: [],
    sessions: [],
    segments: [],
    attempts: [],
    downloads: [],
    videos: [],
    channel: null,
    loading: true,
    error: null,
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

  const profileValue = (key, fallback = "") => state.profile[key] ?? state.profile.academic?.[key] ?? fallback;
  const normalize = (value) => String(value ?? "").trim().toLowerCase();
  const eventId = (event) => String(event.source_id || event.id || "").replace(/^[^-]+-/, "");
  const now = () => new Date();

  function getLocalProfile() {
    return window.StudentData?.getStudentProfile?.() || {};
  }

  function getSubjects(profile) {
    const values = profile.eligible_subjects || profile.registeredSubjects || profile.registered_subjects || profile.subjects || profile.academic?.subjects || [];
    const direct = (Array.isArray(values) ? values : String(values).split(",")).map((value) => String(value).trim()).filter(Boolean);
    if (direct.length) return [...new Set(direct)];
    const grade = String(profile.grade || profile.classGrade || profile.class_grade || "").replace(/\D/g, "");
    const stream = normalize(profile.stream || profile.classStream);
    const streams = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts: ["History", "Political Science", "Geography", "Sociology"],
      arts_humanities: ["History", "Political Science", "Geography", "Psychology"],
    };
    const standard = {
      "5": ["English", "Mathematics", "EVS", "Hindi"],
      "6": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "7": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "8": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "9": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "10": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    if ((grade === "11" || grade === "12") && streams[stream]) return [...streams[stream], "English", "Computer Science", "Physical Education"];
    return standard[grade] || [];
  }

  function subjectIcon(subject) {
    const value = normalize(subject);
    if (value.includes("math")) return { markup: "&pi;", className: "subject-icon-math" };
    if (value.includes("physics")) return { markup: '<i class="fa-solid fa-atom"></i>', className: "subject-icon-physics" };
    if (value.includes("chem")) return { markup: '<i class="fa-solid fa-flask"></i>', className: "subject-icon-chemistry" };
    if (value.includes("english")) return { markup: '<i class="fa-solid fa-book"></i>', className: "subject-icon-english" };
    if (value.includes("computer") || value.includes("program")) return { markup: '<i class="fa-solid fa-code"></i>', className: "subject-icon-computer" };
    if (value.includes("biology")) return { markup: '<i class="fa-solid fa-dna"></i>', className: "subject-icon-biology" };
    if (value.includes("history")) return { markup: '<i class="fa-solid fa-landmark"></i>', className: "subject-icon-history" };
    return { markup: '<i class="fa-solid fa-book-open"></i>', className: "subject-icon-default" };
  }

  function materialIcon(material) {
    const type = normalize(material.material_type || material.type || material.file_name).replace("application/", "");
    if (type.includes("pdf")) return { icon: "fa-regular fa-file-pdf", className: "accent-red" };
    if (type.includes("video")) return { icon: "fa-solid fa-video", className: "accent-blue" };
    if (type.includes("image")) return { icon: "fa-regular fa-image", className: "accent-orange" };
    if (type.includes("link")) return { icon: "fa-solid fa-link", className: "accent-green" };
    return { icon: "fa-regular fa-file-lines", className: "accent-blue" };
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "Date unavailable";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 60) return `${minutes || 1} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isToday(value) {
    return dateKey(value) === dateKey(now());
  }

  function sessionSeconds(session) {
    let seconds = Number(session.duration_seconds) || 0;
    if (session.status === "active" && session.last_resumed_at) seconds += Math.max(0, (Date.now() - new Date(session.last_resumed_at).getTime()) / 1000);
    return seconds;
  }

  function todayStudySeconds() {
    return state.sessions.reduce((total, session) => {
      if (!isToday(session.start_time) && !isToday(session.end_time || session.start_time)) return total;
      return total + sessionSeconds(session);
    }, 0);
  }

  function weekStudySeconds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return state.sessions.reduce((total, session) => {
      const sessionDate = new Date(session.start_time);
      return sessionDate >= start ? total + sessionSeconds(session) : total;
    }, 0);
  }

  function eventStart(event) {
    const value = event.start_at || event.start_time || event.scheduled_at || event.published_at;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  function eventEnd(event) {
    const start = eventStart(event);
    if (!start) return null;
    if (event.end_at || event.end_time) return new Date(event.end_at || event.end_time);
    return new Date(start.getTime() + (Number(event.duration_minutes) || 60) * 60000);
  }

  function classStatus(event) {
    const raw = normalize(event.status);
    if (raw.includes("cancel")) return { label: "Cancelled", className: "upcoming" };
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!start || !end) return { label: "Upcoming", className: "upcoming" };
    if (now() < start) return { label: "Upcoming", className: "upcoming" };
    if (now() <= end) return { label: "Live", className: "" };
    return { label: "Completed", className: "upcoming" };
  }

  function setStatus(message = "") {
    root.dataset.syncStatus = message ? "error" : "connected";
    root.setAttribute("aria-busy", String(state.loading));
    root.title = message || "Dashboard synchronized";
  }

  function setText(selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  }

  function renderGreeting() {
    const hour = new Date().getHours();
    const period = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const name = String(profileValue("name") || profileValue("full_name") || profileValue("first_name") || profileValue("firstName") || "Student").split(" ")[0];
    setText("#welcomeGreeting", `${period}, ${name}!`);
    setText("#todayDate", formatDate(now()));
    setText("#currentTime", formatTime(now()));
    const grade = profileValue("grade") || profileValue("classGrade") || profileValue("class_grade");
    const stream = profileValue("stream") || profileValue("classStream");
    setText("#studentLocation", [grade && `Grade ${grade}`, stream].filter(Boolean).join(" · ") || "Learning space");
  }

  function renderStats() {
    const stats = root.querySelectorAll(".dashboard-stat");
    const availableQuizzes = state.events.filter((event) => {
      if (event.source !== "quizzes" || event.attempted) return false;
      const status = normalize(event.status);
      if (status === "published") return true;
      return status === "scheduled" && eventStart(event) >= now();
    }).length;
    const liveClasses = state.events.filter((event) => event.source === "live_classes" && !normalize(event.status).includes("cancel") && eventEnd(event) >= now()).length;
    const studySeconds = todayStudySeconds();
    const values = [state.subjects.length, liveClasses, availableQuizzes, state.materials.length, formatDuration(studySeconds)];
    values.forEach((value, index) => {
      const target = stats[index]?.querySelector(".dashboard-stat-value");
      if (target) target.textContent = value;
    });
    const change = stats[4]?.querySelector(".dashboard-stat-link");
    if (change) change.innerHTML = `<i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i> ${formatDuration(weekStudySeconds())} this week`;
  }

  function subjectProgress(subject) {
    const key = normalize(subject);
    const materialIds = new Set(state.materials.filter((item) => normalize(item.subject) === key).map((item) => String(item.id || item.material_id)));
    const completedMaterials = state.downloads.filter((item) => materialIds.has(String(item.material_id))).length + state.videos.filter((item) => item.completed && materialIds.has(String(item.video_id))).length;
    const quizTotal = state.events.filter((event) => event.source === "quizzes" && normalize(event.subject) === key).length;
    const quizCompleted = state.events.filter((event) => event.source === "quizzes" && normalize(event.subject) === key && event.attempted).length;
    const total = materialIds.size + quizTotal;
    return total ? Math.min(100, Math.round(((completedMaterials + quizCompleted) / total) * 100)) : 0;
  }

  function renderSubjects() {
    const panel = root.querySelector(".dashboard-panel");
    if (!panel) return;
    const rows = state.subjects.length ? state.subjects.map((subject) => {
      const icon = subjectIcon(subject);
      const progress = subjectProgress(subject);
      return `<div class="subject-row"><div class="subject-row-top"><span class="subject-row-name"><span class="subject-icon ${icon.className}" aria-hidden="true">${icon.markup}</span>${escapeHtml(subject)}</span><span class="subject-progress-label"><strong>${progress}%</strong></span></div><div class="dashboard-progress-track"><div class="dashboard-progress-fill" style="width:${progress}%"></div></div></div>`;
    }).join("") : '<div class="dashboard-empty"><i class="fa-solid fa-book-open"></i><span>No registered subjects found.</span></div>';
    panel.innerHTML = `<div class="dashboard-panel-header"><h2 class="dashboard-panel-title"><i class="fa-solid fa-book-open"></i>Your Subjects</h2><span class="dashboard-panel-link" onclick="viewAllSubjects()">View All <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></div>${rows}`;
  }

  function renderMaterials() {
    const panel = root.querySelectorAll(".dashboard-panel")[1];
    if (!panel) return;
    const rows = state.materials.slice(0, 4).map((material) => {
      const icon = materialIcon(material);
      const title = material.title || material.name || material.file_name || "Untitled material";
      return `<div class="material-row"><div class="material-type-icon ${icon.className}"><i class="${icon.icon}"></i></div><div class="material-row-info"><div class="material-row-title">${escapeHtml(title)}</div><div class="material-row-meta">${escapeHtml(material.subject || "General")} · ${relativeTime(material.uploaded_at || material.created_at)}</div></div><span class="material-menu" aria-label="More material actions"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></span></div>`;
    }).join("");
    panel.innerHTML = `<div class="dashboard-panel-header"><h2 class="dashboard-panel-title"><i class="fa-solid fa-file-lines"></i>Recent Materials</h2><span class="dashboard-panel-link" onclick="action('materials')">View All <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></div>${rows || '<div class="dashboard-empty"><i class="fa-regular fa-file-lines"></i><span>No materials available yet.</span></div>'}`;
  }

  function renderClasses() {
    const panel = root.querySelectorAll(".dashboard-panel")[2];
    if (!panel) return;
    const classes = state.events.filter((event) => event.source === "live_classes" && isToday(eventStart(event)) && !normalize(event.status).includes("cancel")).sort((left, right) => eventStart(left) - eventStart(right)).slice(0, 6);
    const rows = classes.map((event) => {
      const start = eventStart(event);
      const status = classStatus(event);
      return `<div class="class-row"><span class="class-dot"></span><span class="class-time">${formatTime(start)}</span><div class="class-info"><strong>${escapeHtml(event.subject || event.title || "Class")}${event.teacher_name ? ` · ${escapeHtml(event.teacher_name)}` : ""}</strong><span>${formatTime(start)} – ${formatTime(eventEnd(event))}</span></div><span class="class-status ${status.className}">${status.label} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></div>`;
    }).join("");
    panel.innerHTML = `<div class="dashboard-panel-header"><h2 class="dashboard-panel-title"><i class="fa-regular fa-calendar"></i>Today's Classes</h2><span class="dashboard-panel-link" onclick="action('calendar')">View Schedule <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></div><div class="schedule-timeline">${rows || '<div class="dashboard-empty"><i class="fa-regular fa-calendar-xmark"></i><span>No classes scheduled today.</span></div>'}</div>`;
  }

  function renderProgress() {
    const completedMaterials = new Set(state.downloads.map((item) => String(item.material_id))).size + state.videos.filter((item) => item.completed).length;
    const completedQuizzes = state.attempts.length;
    const availableActivities = state.materials.length + state.events.filter((event) => event.source === "quizzes").length;
    const progress = availableActivities ? Math.min(100, Math.round(((completedMaterials + completedQuizzes) / availableActivities) * 100)) : 0;
    const fill = root.querySelector(".study-progress-panel .dashboard-progress-fill");
    if (fill) fill.style.width = `${progress}%`;
    setText(".study-progress-value", `${progress}%`);
    setText(".study-progress-copy p", availableActivities ? "Based on completed materials and quizzes" : "Complete a learning activity to begin");
  }

  function renderAll() {
    renderGreeting();
    renderStats();
    renderSubjects();
    renderMaterials();
    renderClasses();
    renderProgress();
    setStatus(state.error);
  }

  function renderLoading() {
    root.setAttribute("aria-busy", "true");
    root.querySelectorAll(".dashboard-stat-value").forEach((element) => { element.textContent = "..."; });
    root.querySelectorAll(".dashboard-panel").forEach((panel) => {
      panel.innerHTML = '<div class="dashboard-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Loading your learning data...</span></div>';
    });
    setText(".study-progress-value", "...");
  }

  async function loadData() {
    if (!state.client || !state.user) return;
    state.loading = true;
    try {
      const [eventsResult, materialsResult, videosResult, sessionsResult, segmentsResult, attemptsResult, downloadsResult] = await Promise.all([
        state.client.rpc("get_student_calendar_events", { requested_student_id: state.user.id }),
        state.client.rpc("get_student_materials", { requested_student_id: state.user.id }),
        state.client.rpc("get_student_videos", { requested_student_id: state.user.id }),
        state.client.from("study_sessions").select("*").eq("student_id", state.user.id).order("start_time", { ascending: false }),
        state.client.from("study_session_segments").select("*").eq("student_id", state.user.id).order("start_time", { ascending: false }),
        state.client.from("quiz_attempts").select("quiz_id,score,total_marks,completed_at").eq("student_id", state.user.id),
        state.client.from("material_downloads").select("material_id,downloaded_at").eq("student_id", state.user.id),
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (materialsResult.error) throw materialsResult.error;
      state.events = eventsResult.data || [];
      state.materials = (materialsResult.data || []).sort((left, right) => new Date(right.uploaded_at || right.created_at) - new Date(left.uploaded_at || left.created_at));
      state.videos = videosResult.error ? [] : (videosResult.data || []);
      state.sessions = sessionsResult.error ? [] : (sessionsResult.data || []);
      state.segments = segmentsResult.error ? [] : (segmentsResult.data || []);
      state.attempts = attemptsResult.error ? [] : (attemptsResult.data || []);
      state.downloads = downloadsResult.error ? [] : (downloadsResult.data || []);
      const attempts = new Set(state.attempts.map((attempt) => String(attempt.quiz_id)));
      state.events = state.events.map((event) => ({ ...event, attempted: attempts.has(eventId(event)) }));
      state.error = null;
    } catch (error) {
      console.error("Dashboard data load failed.", error);
      state.error = "Dashboard synchronization is temporarily unavailable.";
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  async function loadProfileAndData() {
    renderLoading();
    state.profile = getLocalProfile();
    state.client = window.SmartLearningSupabase?.getClient?.() || null;
    if (!state.client) {
      state.subjects = getSubjects(state.profile);
      state.loading = false;
      renderAll();
      return;
    }
    const { data: { user } = {}, error } = await state.client.auth.getUser();
    if (error || !user) {
      state.subjects = getSubjects(state.profile);
      state.loading = false;
      state.error = "Sign in to view your personalized dashboard.";
      renderAll();
      return;
    }
    state.user = user;
    const profileResult = await state.client.from("student_profiles").select("*").eq("student_id", user.id).maybeSingle();
    if (!profileResult.error && profileResult.data) state.profile = { ...state.profile, ...profileResult.data };
    state.subjects = getSubjects(state.profile);
    await loadData();
    subscribe();
  }

  function subscribe() {
    if (!state.client || !state.user) return;
    state.channel?.unsubscribe();
    state.channel = state.client.channel(`student-dashboard-${state.user.id}`);
    ["student_profiles", "study_sessions", "study_session_segments", "quiz_attempts", "material_downloads", "student_video_progress", "materials", "live_classes", "quizzes", "assignments"].forEach((table) => {
      const filter = ["student_profiles", "study_sessions", "study_session_segments", "quiz_attempts", "material_downloads", "student_video_progress"].includes(table) ? `student_id=eq.${state.user.id}` : undefined;
      state.channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, loadData);
    });
    state.channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        state.error = "Live updates are reconnecting.";
        setStatus(state.error);
      }
      if (status === "SUBSCRIBED") {
        state.error = null;
        setStatus();
      }
    });
  }

  window.viewAllSubjects = () => { window.location.href = "st_subjects.html"; };
  window.action = (type) => {
    const pages = { materials: "st_notes.html", quiz: "st_quizzes.html", live: "st_live_classes.html", calendar: "st_calendar.html", assignments: "st_calendar.html" };
    if (pages[type]) window.location.href = pages[type];
  };
  window.joinClass = () => { window.location.href = "st_live_classes.html"; };

  renderGreeting();
  const clock = window.setInterval(renderGreeting, 60000);
  const liveRefresh = window.setInterval(() => {
    if (!state.loading) {
      renderStats();
      renderClasses();
      renderProgress();
    }
  }, 30000);
  window.addEventListener("beforeunload", () => {
    window.clearInterval(clock);
    window.clearInterval(liveRefresh);
    state.channel?.unsubscribe();
  });
  document.addEventListener("DOMContentLoaded", () => loadProfileAndData().catch((error) => {
    console.error("Dashboard initialization failed.", error);
    state.error = "Dashboard synchronization is temporarily unavailable.";
    state.loading = false;
    renderAll();
  }));
})();
