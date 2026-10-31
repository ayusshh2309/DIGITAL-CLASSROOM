(() => {
  const PAGE_SIZE = 1000;
  const DEFAULT_GOAL_MINUTES = 360;
  const state = {
    client: null,
    user: null,
    profile: null,
    dailyGoalMinutes: DEFAULT_GOAL_MINUTES,
    subjects: [],
    subjectsById: new Map(),
    subjectIdsByName: new Map(),
    sessions: [],
    segments: [],
    activeSession: null,
    selectedDate: new Date(),
    timer: null,
    channel: null,
    busy: false,
    loadSequence: 0,
    refreshTimer: null,
    disposed: false,
  };

  const $ = (id) => document.getElementById(id);
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

  function showStatus(message, isError = false) {
    const status = $("studyTimeStatus");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.state = isError ? "error" : "info";
    status.hidden = !message;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
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
    return addDays(value, -((value.getDay() + 6) % 7));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character]);
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
    const key = Object.keys(subjectIcons).find((candidate) => value.includes(candidate));
    return key ? subjectIcons[key] : "fa-book";
  }

  function subjectName(session) {
    return state.subjectsById.get(String(session.subject_id))?.name ||
      String(session.subject || "Subject unavailable");
  }

  async function readAll(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await createQuery().range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  function segmentsFor(session, now = new Date()) {
    const segments = state.segments
      .filter((segment) => String(segment.session_id) === String(session.id))
      .map((segment) => ({
        start: new Date(segment.start_time),
        end: new Date(segment.end_time),
      }));
    if (session.status === "active" && session.last_resumed_at) {
      segments.push({ start: new Date(session.last_resumed_at), end: now });
    }
    if (!segments.length && Number(session.duration_seconds) > 0) {
      const end = new Date(session.end_time || session.start_time);
      segments.push({
        start: new Date(end.getTime() - Number(session.duration_seconds) * 1000),
        end,
      });
    }
    return segments.filter((segment) =>
      Number.isFinite(segment.start.getTime()) &&
      Number.isFinite(segment.end.getTime()) &&
      segment.end > segment.start,
    );
  }

  function secondsByDate(startDate, endDate) {
    const totals = {};
    const rangeStart = localDayStart(startDate);
    const rangeEnd = addDays(localDayStart(endDate), 1);
    const now = new Date();
    state.sessions.forEach((session) => {
      if (!["completed", "active", "paused"].includes(session.status)) return;
      segmentsFor(session, now).forEach((segment) => {
        let cursor = new Date(segment.start);
        while (cursor < segment.end && cursor < rangeEnd) {
          const nextMidnight = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 1,
          );
          const intervalEnd = new Date(Math.min(
            nextMidnight.getTime(),
            segment.end.getTime(),
            rangeEnd.getTime(),
          ));
          if (intervalEnd > cursor && intervalEnd > rangeStart) {
            const key = dateKey(cursor);
            totals[key] = (totals[key] || 0) +
              Math.max(0, (intervalEnd.getTime() - cursor.getTime()) / 1000);
          }
          cursor = intervalEnd;
        }
      });
    });
    return totals;
  }

  function selectedDaySeconds() {
    return secondsByDate(state.selectedDate, state.selectedDate)[dateKey(state.selectedDate)] || 0;
  }

  function selectedWeekSeconds() {
    const start = mondayOf(state.selectedDate);
    return secondsByDate(start, addDays(start, 6));
  }

  function renderRegistrationContext() {
    const profile = state.profile;
    if (!profile) return;
    const grade = Number(profile.grade);
    const stream = window.StudentCurriculum.normalizeStream(profile.stream);
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const streamText = grade >= 11
      ? ` - ${streamLabels[stream] || profile.stream}`
      : "";
    $("registrationContextText").textContent =
      `Registered curriculum: Grade ${grade}${streamText}`;
    $("registrationContext").hidden = false;
  }

  function renderDate() {
    $("currentDate").textContent = state.selectedDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const nextDay = $("nextDay");
    if (nextDay) nextDay.disabled = dateKey(state.selectedDate) >= dateKey(new Date());
  }

  function renderStats() {
    const daySeconds = selectedDaySeconds();
    const weekTotals = selectedWeekSeconds();
    const weekSeconds = Object.values(weekTotals).reduce((sum, value) => sum + value, 0);
    const goalMinutes = Number(state.dailyGoalMinutes) || DEFAULT_GOAL_MINUTES;
    const goalSeconds = goalMinutes * 60;
    const percent = Math.min(100, Math.round((daySeconds / goalSeconds) * 100));
    const remaining = Math.max(0, goalSeconds - daySeconds);

    $("todayStudyTime").textContent = formatDuration(daySeconds);
    $("weekStudyTime").textContent = formatDuration(weekSeconds);
    $("averageStudyTime").textContent = formatDuration(weekSeconds / 7);
    $("todayStudyNote").textContent = dateKey(state.selectedDate) === dateKey(new Date())
      ? "Completed and active study time"
      : "Selected date total";
    $("weekStudyNote").textContent = "Monday to Sunday";
    $("averageStudyNote").textContent = "Weekly total divided by 7 days";
    $("goalPercent").textContent = `${percent}%`;
    $("goalCompleted").textContent = formatDuration(daySeconds);
    $("goalTarget").textContent = formatDuration(goalSeconds);
    $("goalRemaining").textContent = remaining ? formatDuration(remaining) : "Goal reached";
    const degrees = percent * 3.6;
    $("circleProgress").style.background =
      `conic-gradient(#603ce7 0deg ${degrees}deg, #e9e5fa ${degrees}deg 360deg)`;

    const completedDays = new Set();
    const now = new Date();
    state.sessions
      .filter((session) => session.status === "completed" && Number(session.duration_seconds) > 0)
      .forEach((session) => {
        segmentsFor(session, now).forEach((segment) => {
          let cursor = localDayStart(segment.start);
          const finalDay = localDayStart(new Date(segment.end.getTime() - 1));
          while (cursor <= finalDay) {
            completedDays.add(dateKey(cursor));
            cursor = addDays(cursor, 1);
          }
        });
      });

    let streak = 0;
    let streakCursor = localDayStart(new Date());
    if (!completedDays.has(dateKey(streakCursor))) streakCursor = addDays(streakCursor, -1);
    while (completedDays.has(dateKey(streakCursor))) {
      streak += 1;
      streakCursor = addDays(streakCursor, -1);
    }
    $("studyStreak").textContent = `${streak} Day${streak === 1 ? "" : "s"}`;
    $("streakStatus").textContent = streak ? "Active" : "None";
    $("streakNote").textContent = streak
      ? "Keep your streak going!"
      : "Complete a session to start";
    $("todayChange").textContent =
      dateKey(state.selectedDate) === dateKey(new Date()) ? "Today" : "Selected";
    $("weekChange").textContent =
      `${mondayOf(state.selectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  function renderChart() {
    const weekStart = mondayOf(state.selectedDate);
    const totals = selectedWeekSeconds();
    const maximum = 6 * 3600;
    $("weeklyBars").innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const seconds = totals[dateKey(day)] || 0;
      const height = seconds ? Math.max(1, Math.round((seconds / maximum) * 100)) : 0;
      const todayClass = dateKey(day) === dateKey(new Date()) ? " today" : "";
      const zeroClass = seconds ? "" : " zero";
      return `<div class="bar-group"><div class="bar-wrapper"><div class="bar${todayClass}${zeroClass}" style="height:${height}%" title="${day.toLocaleDateString("en-US", { weekday: "long" })}: ${formatDuration(seconds)}"></div></div><span class="hours">${seconds ? `${(seconds / 3600).toFixed(1)}h` : "0h"}</span><span class="day">${day.toLocaleDateString("en-US", { weekday: "short" })}</span></div>`;
    }).join("");
  }

  function renderSubjects() {
    const weekStart = mondayOf(state.selectedDate);
    const weekEnd = addDays(weekStart, 7);
    const totals = new Map(state.subjects.map((subject) => [String(subject.id), 0]));
    const now = new Date();

    state.sessions.forEach((session) => {
      if (!["completed", "active", "paused"].includes(session.status)) return;
      let subjectId = session.subject_id == null ? null : String(session.subject_id);
      if (!totals.has(subjectId)) {
        const matches = state.subjectIdsByName.get(String(session.subject || "").toLowerCase()) || [];
        if (matches.length === 1) subjectId = matches[0];
      }
      if (!totals.has(subjectId)) return;
      segmentsFor(session, now).forEach((segment) => {
        const start = Math.max(segment.start.getTime(), weekStart.getTime());
        const end = Math.min(segment.end.getTime(), weekEnd.getTime());
        if (end > start) totals.set(subjectId, totals.get(subjectId) + (end - start) / 1000);
      });
    });

    const maximum = Math.max(...totals.values(), 1);
    $("subjectList").innerHTML = state.subjects.length
      ? state.subjects.map((subject, index) => {
        const seconds = totals.get(String(subject.id)) || 0;
        const color = subjectColors[index % subjectColors.length];
        const width = Math.min(100, Math.round((seconds / maximum) * 100));
        return `<div class="subject-row"><div class="subject-name"><span class="subject-dot dot-${color}"></span>${escapeHtml(subject.name)}</div><div class="subject-progress"><div class="subject-progress-fill fill-${color}" style="width:${width}%"></div></div><div class="subject-time">${formatDuration(seconds)}</div></div>`;
      }).join("")
      : '<div class="empty-state">No registered subjects found.</div>';
  }

  function renderSessions() {
    const sessions = [...state.sessions]
      .sort((left, right) =>
        new Date(right.start_time).getTime() - new Date(left.start_time).getTime(),
      )
      .slice(0, 10);
    $("sessionList").innerHTML = sessions.length
      ? sessions.map((session) => {
        const subject = subjectName(session);
        const color = subjectClass(subject);
        const elapsed = segmentsFor(session).reduce((sum, segment) =>
          sum + (segment.end.getTime() - segment.start.getTime()) / 1000, 0);
        const start = formatDateTime(session.start_time);
        const end = session.end_time ? formatDateTime(session.end_time) : "In progress";
        const topic = session.topic ? ` · ${session.topic}` : "";
        const status = String(session.status || "unknown");
        return `<div class="session"><div class="session-left"><div class="session-icon ${color}"><i class="fa-solid ${subjectIcon(subject)}"></i></div><div class="session-info"><strong>${escapeHtml(subject)}${topic ? ` - ${escapeHtml(session.topic)}` : ""}</strong><span>${escapeHtml(start)} – ${escapeHtml(end)} · ${escapeHtml(status)}</span></div></div><div class="session-time">${formatDuration(elapsed)}</div></div>`;
      }).join("")
      : '<div class="empty-state">No study sessions yet. Start your first session below.</div>';
  }

  function activeElapsedSeconds(session) {
    const accumulated = Math.max(0, Number(session.duration_seconds) || 0);
    if (session.status !== "active" || !session.last_resumed_at) return accumulated;
    return accumulated + Math.max(
      0,
      (Date.now() - new Date(session.last_resumed_at).getTime()) / 1000,
    );
  }

  function renderTimer() {
    const session = state.activeSession;
    $("timerDisplay").textContent = formatTime(session ? activeElapsedSeconds(session) : 0);
    if (session) {
      $("timerStatus").textContent =
        `${subjectName(session)}${session.topic ? ` - ${session.topic}` : ""} · ${session.status}`;
    } else if (!state.busy && !$("timerStatus").dataset.error) {
      $("timerStatus").textContent = "";
    }
    $("studySubject").disabled = Boolean(session) || state.busy || !state.user;
    $("studyTopic").disabled = Boolean(session) || state.busy || !state.user;
    $("startTimer").disabled = Boolean(session) || state.busy || !state.user;
    $("pauseTimer").disabled = !session || state.busy || !state.user;
    $("finishTimer").disabled = !session || state.busy || !state.user;
    $("editGoal").disabled = state.busy || !state.user;
    if (!session) {
      $("startTimer").innerHTML = '<i class="fa-solid fa-play"></i> Start Studying';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    } else if (session.status === "paused") {
      $("startTimer").innerHTML = '<i class="fa-solid fa-play"></i> Resume';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-play"></i> Resume';
      $("startTimer").disabled = state.busy;
    } else {
      $("startTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
      $("pauseTimer").innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    }
  }

  function renderAll() {
    renderDate();
    renderStats();
    renderChart();
    renderSubjects();
    renderSessions();
    renderTimer();
  }

  async function loadData() {
    if (!state.client || !state.user) return;
    const sequence = ++state.loadSequence;
    const [sessions, segments, goalResult] = await Promise.all([
      readAll(() => state.client
        .from("study_sessions")
        .select("*")
        .eq("student_id", state.user.id)
        .order("start_time", { ascending: false })),
      readAll(() => state.client
        .from("study_session_segments")
        .select("*")
        .eq("student_id", state.user.id)
        .order("start_time", { ascending: false })),
      state.client.rpc("get_student_daily_study_goal"),
    ]);
    if (goalResult.error) throw goalResult.error;
    if (sequence !== state.loadSequence || state.disposed) return;
    state.sessions = sessions;
    state.segments = segments;
    state.dailyGoalMinutes = Number(goalResult.data) || DEFAULT_GOAL_MINUTES;
    state.activeSession = sessions.find((session) =>
      session.status === "active" || session.status === "paused",
    ) || null;
    renderAll();
  }

  async function refreshData() {
    try {
      await loadData();
      if ($("studyTimeStatus").dataset.state === "error") showStatus("");
    } catch (error) {
      console.error("Could not refresh study-time data.", error);
      showStatus(`Study data could not be refreshed: ${error.message || "Check your connection and try again."}`, true);
    }
  }

  function rowFromRpc(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  async function runAction(action, args = {}) {
    if (state.busy || !state.client || !state.user) return;
    state.busy = true;
    delete $("timerStatus").dataset.error;
    renderTimer();
    try {
      const { data, error } = await state.client.rpc(action, args);
      if (error) throw error;
      const row = rowFromRpc(data);
      if (!row?.id) throw new Error("The study session update was not confirmed by the server.");
      await loadData();
      if (action === "finish_student_study_session") {
        window.StudentAchievements?.evaluate?.();
      }
      showStatus(
        action === "finish_student_study_session"
          ? "Study session saved."
          : action === "start_student_study_session"
            ? "Study session started."
            : action === "pause_student_study_session"
              ? "Study session paused."
              : "Study session resumed.",
      );
    } catch (error) {
      console.error(`Study session action failed: ${action}`, error);
      $("timerStatus").textContent = error.message || "Unable to save this study session.";
      $("timerStatus").dataset.error = "true";
      showStatus(error.message || "Unable to save this study session.", true);
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  async function updateGoal() {
    const currentHours = (Number(state.dailyGoalMinutes) || DEFAULT_GOAL_MINUTES) / 60;
    const value = window.prompt("Enter your daily study goal in hours:", String(currentHours));
    if (value === null) return;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      showStatus("Enter a daily goal greater than 0 and no more than 24 hours.", true);
      return;
    }
    const minutes = Math.round(hours * 60);
    state.busy = true;
    renderTimer();
    try {
      const { data, error } = await state.client.rpc(
        "set_student_daily_study_goal",
        { requested_minutes: minutes },
      );
      if (error) throw error;
      state.dailyGoalMinutes = Number(data) || minutes;
      renderAll();
      showStatus("Daily study goal saved.");
    } catch (error) {
      console.error("Could not save the daily study goal.", error);
      showStatus(error.message || "Unable to save your daily goal.", true);
    } finally {
      state.busy = false;
      renderTimer();
    }
  }

  function bindEvents() {
    $("previousDay").addEventListener("click", () => {
      state.selectedDate = addDays(state.selectedDate, -1);
      renderAll();
    });
    $("nextDay").addEventListener("click", () => {
      if (dateKey(state.selectedDate) >= dateKey(new Date())) return;
      state.selectedDate = addDays(state.selectedDate, 1);
      renderAll();
    });
    $("startTimer").addEventListener("click", () => {
      if (state.activeSession?.status === "paused") {
        void runAction("resume_student_study_session", {
          requested_session_id: state.activeSession.id,
        });
        return;
      }
      if (state.activeSession?.status === "active") {
        void runAction("pause_student_study_session", {
          requested_session_id: state.activeSession.id,
        });
        return;
      }
      const subjectId = $("studySubject").value;
      if (!state.subjectsById.has(String(subjectId))) {
        showStatus("Select a subject from your registered curriculum before starting.", true);
        return;
      }
      delete $("timerStatus").dataset.error;
      void runAction("start_student_study_session", {
        requested_subject_id: Number(subjectId),
        requested_topic: $("studyTopic").value.trim(),
      });
    });
    $("pauseTimer").addEventListener("click", () => {
      if (!state.activeSession) return;
      const action = state.activeSession.status === "paused"
        ? "resume_student_study_session"
        : "pause_student_study_session";
      void runAction(action, { requested_session_id: state.activeSession.id });
    });
    $("finishTimer").addEventListener("click", () => {
      if (state.activeSession) {
        void runAction("finish_student_study_session", {
          requested_session_id: state.activeSession.id,
        });
      }
    });
    $("editGoal").addEventListener("click", () => void updateGoal());
  }

  async function refreshCurriculum() {
    const curriculum = await window.StudentCurriculum.loadCurrentStudent(state.client);
    if (String(curriculum.user.id) !== String(state.user.id)) {
      throw new Error("Your signed-in student account changed. Reload the Study Time page.");
    }
    state.profile = { ...curriculum.student };
    setSubjects(curriculum.subjects);
    renderRegistrationContext();
    renderAll();
  }

  function setSubjects(subjects) {
    state.subjects = subjects;
    state.subjectsById = new Map(subjects.map((subject) => [String(subject.id), subject]));
    state.subjectIdsByName = new Map();
    subjects.forEach((subject) => {
      const key = subject.name.trim().toLowerCase();
      if (!state.subjectIdsByName.has(key)) state.subjectIdsByName.set(key, []);
      state.subjectIdsByName.get(key).push(String(subject.id));
    });
    const selected = $("studySubject").value;
    $("studySubject").innerHTML = '<option value="">Select subject</option>' +
      subjects.map((subject) =>
        `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`,
      ).join("");
    if (state.subjectsById.has(String(selected))) $("studySubject").value = selected;
  }

  async function subscribe() {
    if (state.channel) await state.client.removeChannel(state.channel);
    const channel = state.client.channel(`student-study-time-${state.user.id}`);
    channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "study_sessions",
        filter: `student_id=eq.${state.user.id}`,
      }, () => void refreshData())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "study_session_segments",
        filter: `student_id=eq.${state.user.id}`,
      }, () => void refreshData())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
        filter: `user_id=eq.${state.user.id}`,
      }, async () => {
        try {
          await refreshCurriculum();
          await refreshData();
        } catch (error) {
          console.error("Could not refresh the registered study curriculum.", error);
          showStatus(error.message || "Your registered curriculum could not be refreshed.", true);
        }
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "subjects",
      }, async () => {
        try {
          await refreshCurriculum();
        } catch (error) {
          console.error("Could not refresh study subjects.", error);
          showStatus(error.message || "Registered subjects could not be refreshed.", true);
        }
      })
      .subscribe((status, error) => {
        if (error || ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          console.error("Study-time Realtime subscription failed.", { status, error });
          showStatus("Live updates are unavailable. Data will refresh periodically.", true);
        }
      });
    state.channel = channel;
  }

  async function init() {
    bindEvents();
    showStatus("Loading your registered curriculum and study records.");
    const shared = window.SmartLearningSupabase;
    if (!shared?.isConfigured?.()) {
      throw new Error("Supabase is not configured for Study Time.");
    }
    state.client = shared.getClient?.();
    if (!state.client) throw new Error("Supabase could not be initialized.");

    const curriculum = await window.StudentCurriculum.loadCurrentStudent(state.client);
    state.user = curriculum.user;
    state.profile = { ...curriculum.student };
    setSubjects(curriculum.subjects);
    renderRegistrationContext();
    renderAll();
    await loadData();
    await subscribe();
    showStatus("");

    state.timer = window.setInterval(() => {
      if (!state.activeSession) return;
      renderTimer();
      renderStats();
      renderChart();
      renderSubjects();
      renderSessions();
    }, 1000);
    state.refreshTimer = window.setInterval(() => void refreshData(), 60_000);

    window.addEventListener("focus", () => void refreshData());
    window.addEventListener("online", () => void refreshData());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshData();
    });
    const authResult = state.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id === state.user?.id) return;
      state.user = null;
      state.profile = null;
      setSubjects([]);
      state.activeSession = null;
      state.sessions = [];
      state.segments = [];
      $("registrationContext").hidden = true;
      if (state.channel) void state.client.removeChannel(state.channel);
      state.channel = null;
      showStatus("Your signed-in account changed. Reload this page to continue.", true);
      renderAll();
    });
    state.authSubscription = authResult.data?.subscription || null;
    window.addEventListener("pagehide", () => {
      state.disposed = true;
      state.loadSequence += 1;
      window.clearInterval(state.timer);
      window.clearInterval(state.refreshTimer);
      if (state.channel) void state.client.removeChannel(state.channel);
      state.channel = null;
      state.authSubscription?.unsubscribe();
    }, { once: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    void init().catch((error) => {
      console.error("Study Time could not be initialized.", error);
      showStatus(error.message || "Study tracking is temporarily unavailable.", true);
      $("timerStatus").textContent = error.message || "Study tracking is temporarily unavailable.";
    });
  });
})();
