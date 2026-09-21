(() => {
  const state = {
    client: null,
    user: null,
    profile: {},
    subjects: [],
    sessions: [],
    segments: [],
    activeSession: null,
    selectedDate: new Date(),
    timer: null,
    channel: null,
    busy: false,
  };

  const $ = (id) => document.getElementById(id);
  const profileKeys = ["studentProfile", "studentData", "finalStudentRegistration"];
  const subjectColors = ["purple", "green", "orange", "blue", "pink"];
  const subjectIcons = {
    physics: "fa-atom",
    chemistry: "fa-flask",
    mathematics: "fa-calculator",
    math: "fa-calculator",
    biology: "fa-dna",
    english: "fa-book-open",
    computer: "fa-code",
    history: "fa-landmark",
  };

  function readProfile() {
    return profileKeys.map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || "null"); }
      catch (error) { console.warn(`Could not read ${key}.`, error); return null; }
    }).find((profile) => profile && (profile.classGrade || profile.class_grade)) || {};
  }

  function renderRegistrationContext() {
    const grade = String(state.profile.classGrade || state.profile.class_grade || state.profile.grade || "");
    if (!grade) return;
    const stream = String(state.profile.stream || state.profile.classStream || "").toLowerCase();
    const streamLabels = { science_pcm: "Science (PCM)", science_pcb: "Science (PCB)", commerce: "Commerce", arts: "Arts / Humanities" };
    const streamText = grade === "11" || grade === "12" ? ` - ${streamLabels[stream] || "Selected stream"}` : "";
    $("registrationContextText").textContent = `Registered curriculum: Grade ${grade}${streamText}`;
    $("registrationContext").hidden = false;
  }

  function registeredSubjects(profile) {
    const grade = String(profile.classGrade || profile.class_grade || profile.grade || "");
    const stream = String(profile.stream || profile.classStream || "").toLowerCase();
    const standard = {
      "5": ["English", "Mathematics", "EVS", "Hindi"],
      "6": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "7": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "8": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "9": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "10": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    const streams = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts: ["History", "Political Science", "Geography", "Sociology"],
    };
    if (grade === "11" || grade === "12") {
      return [...(streams[stream] || []), "English", "Computer Science", "Physical Education"];
    }
    const direct = profile.registeredSubjects || profile.registered_subjects || profile.eligible_subjects;
    return standard[grade] || (Array.isArray(direct) ? direct.map(String) : []);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
      .map((value) => String(value).padStart(2, "0")).join(":");
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function dateKey(date) {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function localDayStart(date) {
    const value = new Date(date);
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function addDays(date, amount) {
    const value = localDayStart(date);
    value.setDate(value.getDate() + amount);
    return value;
  }

  function mondayOf(date) {
    const value = localDayStart(date);
    const offset = (value.getDay() + 6) % 7;
    return addDays(value, -offset);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }

  function subjectClass(subject) {
    const value = String(subject || "").toLowerCase();
    if (value.includes("chem")) return "green";
    if (value.includes("math")) return "orange";
    if (value.includes("english")) return "blue";
    if (value.includes("physical")) return "pink";
    return "purple";
  }

  function subjectIcon(subject) {
    const value = String(subject || "").toLowerCase();
    return subjectIcons[Object.keys(subjectIcons).find((key) => value.includes(key))] || "fa-book";
  }

  function rpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function segmentsFor(session) {
    const segments = state.segments.filter((segment) => segment.session_id === session.id).map((segment) => ({
      start: new Date(segment.start_time),
      end: new Date(segment.end_time),
    }));
    if (session.status === "active") {
      segments.push({ start: new Date(session.last_resumed_at), end: new Date() });
    }
    if (!segments.length && Number(session.duration_seconds) > 0 && session.end_time) {
      const end = new Date(session.end_time);
      segments.push({ start: new Date(end.getTime() - Number(session.duration_seconds) * 1000), end });
    }
    return segments.filter((segment) => segment.end > segment.start);
  }

  function secondsByDate(startDate, endDate) {
    const totals = {};
    const start = localDayStart(startDate);
    const end = addDays(localDayStart(endDate), 1);
    state.sessions.forEach((session) => {
      if (session.status !== "completed" && session.status !== "active" && session.status !== "paused") return;
      segmentsFor(session).forEach((segment) => {
        let cursor = new Date(segment.start);
        while (cursor < segment.end && cursor < end) {
          const boundary = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
          const intervalEnd = new Date(Math.min(boundary.getTime(), segment.end.getTime(), end.getTime()));
          if (intervalEnd > cursor && intervalEnd > start) {
            const key = dateKey(cursor);
            totals[key] = (totals[key] || 0) + Math.max(0, (intervalEnd - cursor) / 1000);
          }
          cursor = intervalEnd;
        }
      });
    });
    return totals;
  }

  function selectedDaySeconds() {
    const totals = secondsByDate(state.selectedDate, state.selectedDate);
    return totals[dateKey(state.selectedDate)] || 0;
  }

  function selectedWeekSeconds() {
    const weekStart = mondayOf(state.selectedDate);
    const weekEnd = addDays(weekStart, 6);
    return secondsByDate(weekStart, weekEnd);
  }

  function updateDate() {
    $("currentDate").textContent = state.selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function renderStats() {
    const daySeconds = selectedDaySeconds();
    const weekTotals = selectedWeekSeconds();
    const weekSeconds = Object.values(weekTotals).reduce((sum, value) => sum + value, 0);
    const average = weekSeconds / 7;
    const goalMinutes = Number(state.profile.daily_study_goal_minutes || 360);
    const percent = Math.min(100, Math.round((daySeconds / (goalMinutes * 60)) * 100));
    $("todayStudyTime").textContent = formatDuration(daySeconds);
    $("weekStudyTime").textContent = formatDuration(weekSeconds);
    $("averageStudyTime").textContent = formatDuration(average);
    $("todayStudyNote").textContent = dateKey(state.selectedDate) === dateKey(new Date()) ? "Completed and active time today" : "Selected date total";
    $("weekStudyNote").textContent = "Monday to Sunday";
    $("averageStudyNote").textContent = "Based on the selected week";
    $("goalPercent").textContent = `${percent}%`;
    $("goalCompleted").textContent = formatDuration(daySeconds);
    $("goalTarget").textContent = formatDuration(goalMinutes * 60);
    $("circleProgress").style.background = `conic-gradient(#603ce7 0deg ${percent * 3.6}deg, #e9e5fa ${percent * 3.6}deg 360deg)`;
    const completedDays = new Set();
    state.sessions.filter((session) => session.status === "completed" && Number(session.duration_seconds) > 0).forEach((session) => {
      segmentsFor(session).forEach((segment) => {
        let cursor = localDayStart(segment.start);
        const lastDay = localDayStart(segment.end);
        while (cursor <= lastDay) {
          completedDays.add(dateKey(cursor));
          cursor = addDays(cursor, 1);
        }
      });
    });
    let streak = 0;
    let cursor = localDayStart(new Date());
    while (completedDays.has(dateKey(cursor))) { streak += 1; cursor = addDays(cursor, -1); }
    $("studyStreak").textContent = `${streak} Day${streak === 1 ? "" : "s"}`;
    $("streakStatus").textContent = streak ? "Active" : "None";
    $("streakNote").textContent = streak ? "Keep your streak going!" : "Complete a session to start";
    const currentDay = dateKey(state.selectedDate) === dateKey(new Date());
    $("todayChange").textContent = currentDay ? "Live" : "View";
    $("weekChange").textContent = `${Math.round(weekSeconds / 3600)}h`;
  }

  function renderChart() {
    const weekStart = mondayOf(state.selectedDate);
    const totals = selectedWeekSeconds();
    const maxSeconds = Math.max(6 * 3600, ...Object.values(totals), 1);
    $("weeklyBars").innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const seconds = totals[dateKey(day)] || 0;
      const height = seconds ? Math.max(7, Math.round((seconds / maxSeconds) * 100)) : 0;
      const todayClass = dateKey(day) === dateKey(new Date()) ? " today" : "";
      return `<div class="bar-group"><div class="bar-wrapper"><div class="bar${todayClass}" style="height:${height}%" title="${day.toLocaleDateString("en-US", { weekday: "long" })}: ${formatDuration(seconds)}"></div></div><span class="hours">${seconds ? `${(seconds / 3600).toFixed(1)}h` : "0h"}</span><span class="day">${day.toLocaleDateString("en-US", { weekday: "short" })}</span></div>`;
    }).join("");
  }

  function renderSubjects() {
    const totals = selectedWeekSeconds();
    const weekStart = mondayOf(state.selectedDate);
    const weekEnd = addDays(weekStart, 6);
    const bySubject = {};
    state.sessions.forEach((session) => {
      if (session.status !== "completed" && session.status !== "active" && session.status !== "paused") return;
      segmentsFor(session).forEach((segment) => {
        const clippedStart = new Date(Math.max(segment.start.getTime(), weekStart.getTime()));
        const clippedEnd = new Date(Math.min(segment.end.getTime(), addDays(weekEnd, 1).getTime()));
        if (clippedEnd > clippedStart) bySubject[session.subject] = (bySubject[session.subject] || 0) + (clippedEnd - clippedStart) / 1000;
      });
    });
    const max = Math.max(...state.subjects.map((subject) => bySubject[subject] || 0), 1);
    $("subjectList").innerHTML = state.subjects.length ? state.subjects.map((subject, index) => {
      const seconds = bySubject[subject] || 0;
      const color = subjectColors[index % subjectColors.length];
      return `<div class="subject-row"><div class="subject-name"><span class="subject-dot dot-${color}"></span>${escapeHtml(subject)}</div><div class="subject-progress"><div class="subject-progress-fill fill-${color}" style="width:${Math.round((seconds / max) * 100)}%"></div></div><div class="subject-time">${formatDuration(seconds)}</div></div>`;
    }).join("") : '<div class="empty-state">No registered subjects found.</div>';
    void totals;
  }

  function renderSessions() {
    const sessions = state.sessions.filter((session) => session.status === "completed").sort((left, right) => new Date(right.end_time || right.start_time) - new Date(left.end_time || left.start_time)).slice(0, 10);
    $("sessionList").innerHTML = sessions.length ? sessions.map((session) => {
      const color = subjectClass(session.subject);
      const when = new Date(session.end_time || session.start_time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
      const title = session.topic ? `${session.subject} - ${session.topic}` : session.subject;
      return `<div class="session"><div class="session-left"><div class="session-icon ${color}"><i class="fa-solid ${subjectIcon(session.subject)}"></i></div><div class="session-info"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(when)}</span></div></div><div class="session-time">${formatDuration(session.duration_seconds)}</div></div>`;
    }).join("") : '<div class="empty-state">No completed study sessions yet.</div>';
  }

  function renderTimer() {
    const session = state.activeSession;
    const elapsed = session ? segmentsFor(session).reduce((sum, segment) => sum + (segment.end - segment.start) / 1000, 0) : 0;
    $("timerDisplay").textContent = formatTime(elapsed);
    $("timerStatus").textContent = session ? `${session.subject}${session.topic ? ` - ${session.topic}` : ""} (${session.status})` : "";
    $("studySubject").disabled = Boolean(session);
    $("studyTopic").disabled = Boolean(session);
    $("startTimer").disabled = Boolean(session) || state.busy;
    $("pauseTimer").disabled = !session || state.busy;
    $("finishTimer").disabled = !session || state.busy;
    if (!session) {
      $("startTimer").innerHTML = '<i class="fa-solid fa-play"></i> Start Studying';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    } else if (session.status === "paused") {
      $("startTimer").innerHTML = '<i class="fa-solid fa-play"></i> Resume';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-play"></i> Resume';
    } else {
      $("startTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    }
  }

  function renderAll() {
    updateDate();
    renderStats();
    renderChart();
    renderSubjects();
    renderSessions();
    renderTimer();
  }

  async function loadData() {
    if (!state.client || !state.user) return;
    const [sessionsResult, segmentsResult, profileResult] = await Promise.all([
      state.client.from("study_sessions").select("*").eq("student_id", state.user.id).order("start_time", { ascending: false }),
      state.client.from("study_session_segments").select("*").eq("student_id", state.user.id).order("start_time", { ascending: false }),
      state.client.from("student_profiles").select("daily_study_goal_minutes").eq("student_id", state.user.id).maybeSingle(),
    ]);
    if (sessionsResult.error) throw sessionsResult.error;
    state.sessions = sessionsResult.data || [];
    state.segments = segmentsResult.data || [];
    if (profileResult.data?.daily_study_goal_minutes) state.profile.daily_study_goal_minutes = profileResult.data.daily_study_goal_minutes;
    state.activeSession = state.sessions.find((session) => session.status === "active" || session.status === "paused") || null;
    renderAll();
  }

  async function runAction(action, args) {
    if (state.busy || !state.client || !state.user) return;
    state.busy = true;
    renderTimer();
    try {
      const { data, error } = await state.client.rpc(action, args || {});
      if (error) throw error;
      const row = rpcRow(data);
      if (action.includes("start")) state.activeSession = row;
      if (action.includes("finish")) state.activeSession = null;
      await loadData();
      state.channel?.send({ type: "broadcast", event: "study-session-updated" });
    } catch (error) {
      console.error(`Study session action failed: ${action}`, error);
      $("timerStatus").textContent = "Unable to save this session. Please try again.";
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  function bindEvents() {
    $("previousDay").addEventListener("click", () => { state.selectedDate = addDays(state.selectedDate, -1); renderAll(); });
    $("nextDay").addEventListener("click", () => { state.selectedDate = addDays(state.selectedDate, 1); renderAll(); });
    $("startTimer").addEventListener("click", () => {
      if (state.activeSession?.status === "paused") return runAction("resume_student_study_session", { requested_session_id: state.activeSession.id });
      const subject = $("studySubject").value;
      if (!subject) { $("timerStatus").textContent = "Select a subject before starting."; return; }
      runAction("start_student_study_session", { requested_subject: subject, requested_topic: $("studyTopic").value });
    });
    $("pauseTimer").addEventListener("click", () => {
      if (!state.activeSession) return;
      const action = state.activeSession.status === "paused" ? "resume_student_study_session" : "pause_student_study_session";
      runAction(action, { requested_session_id: state.activeSession.id });
    });
    $("finishTimer").addEventListener("click", () => {
      if (state.activeSession) runAction("finish_student_study_session", { requested_session_id: state.activeSession.id });
    });
    $("editGoal").addEventListener("click", async () => {
      const currentHours = Number(state.profile.daily_study_goal_minutes || 360) / 60;
      const value = prompt("Enter your daily study goal in hours:", String(currentHours));
      if (value === null || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
      const minutes = Math.min(1440, Math.max(1, Math.round(Number(value) * 60)));
      const { data, error } = await state.client.rpc("set_student_daily_study_goal", { requested_minutes: minutes });
      if (error) { alert("Unable to update the daily goal."); return; }
      state.profile.daily_study_goal_minutes = Number(data || minutes);
      renderAll();
    });
  }

  async function init() {
    bindEvents();
    state.profile = readProfile();
    renderRegistrationContext();
    state.subjects = registeredSubjects(state.profile);
    $("studySubject").innerHTML = '<option value="">Select subject</option>' + state.subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    renderAll();
    state.client = window.SmartLearningSupabase?.getClient?.();
    if (!state.client) { $("timerStatus").textContent = "Study tracking is unavailable until Supabase is configured."; return; }
    const { data: { user } } = await state.client.auth.getUser();
    state.user = user;
    if (!user) { $("timerStatus").textContent = "Sign in to track study time."; return; }
    await loadData();
    state.channel = state.client.channel(`study-time-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "study_sessions", filter: `student_id=eq.${user.id}` }, loadData).on("postgres_changes", { event: "*", schema: "public", table: "study_session_segments", filter: `student_id=eq.${user.id}` }, loadData).subscribe();
    state.channel.on("broadcast", { event: "study-session-updated" }, loadData);
    state.timer = setInterval(() => { if (state.activeSession) { renderTimer(); renderStats(); renderChart(); renderSubjects(); } }, 1000);
    window.addEventListener("beforeunload", () => state.channel?.unsubscribe());
  }

  document.addEventListener("DOMContentLoaded", () => init().catch((error) => {
    console.error("Study Time is unavailable.", error);
    $("timerStatus").textContent = "Study tracking is temporarily unavailable.";
  }));
})();
