(() => {
  const DEFAULT_GOAL_MINUTES = 360;
  const state = {
    dailyGoalMinutes: DEFAULT_GOAL_MINUTES,
    subjects: [],
    subjectsById: new Map(),
    subjectIdsByName: new Map(),
    subjectsLoading: true,
    subjectLoadError: null,
    sessions: [],
    segments: [],
    selectedDate: new Date(),
    busy: false,
  };

  const $ = (id) => document.getElementById(id);
  const subjectColors = ["purple", "green", "orange", "blue", "pink"];

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

  function segmentsFor(session, now = new Date()) {
    const segments = state.segments
      .filter((segment) => String(segment.session_id) === String(session.id))
      .filter((segment) => segment.started_at && segment.ended_at)
      .map((segment) => ({
        start: new Date(segment.started_at),
        end: new Date(segment.ended_at),
        durationSeconds: Number(segment.duration_seconds),
      }));
    if (session.status === "active" && session.started_at) {
      segments.push({
        start: new Date(session.started_at),
        end: now,
        durationSeconds: null,
      });
    }
    if (!segments.length && Number(session.duration_seconds) > 0) {
      const end = new Date(session.ended_at || session.started_at);
      segments.push({
        start: new Date(end.getTime() - Number(session.duration_seconds) * 1000),
        end,
        durationSeconds: Number(session.duration_seconds),
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
            const overlapMilliseconds = intervalEnd.getTime() - cursor.getTime();
            const intervalMilliseconds = segment.end.getTime() - segment.start.getTime();
            const fullInterval =
              cursor.getTime() === segment.start.getTime() &&
              intervalEnd.getTime() === segment.end.getTime();
            const seconds = Number.isFinite(segment.durationSeconds)
              ? (fullInterval
                ? segment.durationSeconds
                : Math.round(
                  segment.durationSeconds * overlapMilliseconds / intervalMilliseconds,
                ))
              : Math.round(overlapMilliseconds / 1000);
            totals[key] = (totals[key] || 0) + Math.max(0, seconds);
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
      ? "From tracked learning activities"
      : "Verified activity total";
    $("weekStudyNote").textContent = "Monday to Sunday";
    $("averageStudyNote").textContent = "Weekly total divided by 7 days";
    $("goalPercent").textContent = `${percent}%`;
    $("goalCompleted").textContent = formatDuration(daySeconds);
    $("goalTarget").textContent = formatDuration(goalSeconds);
    $("goalRemaining").textContent = remaining ? formatDuration(remaining) : "Goal reached";
    const degrees = percent * 3.6;
    $("circleProgress").style.background =
      `conic-gradient(#603ce7 0deg ${degrees}deg, #e9e5fa ${degrees}deg 360deg)`;

    const studyDays = new Set();
    const now = new Date();
    state.sessions
      .filter((session) => ["completed", "active", "paused"].includes(session.status))
      .forEach((session) => {
        segmentsFor(session, now).forEach((segment) => {
          let cursor = localDayStart(segment.start);
          const finalDay = localDayStart(new Date(segment.end.getTime() - 1));
          while (cursor <= finalDay) {
            studyDays.add(dateKey(cursor));
            cursor = addDays(cursor, 1);
          }
        });
      });

    let streak = 0;
    let streakCursor = localDayStart(new Date());
    if (!studyDays.has(dateKey(streakCursor))) streakCursor = addDays(streakCursor, -1);
    while (studyDays.has(dateKey(streakCursor))) {
      streak += 1;
      streakCursor = addDays(streakCursor, -1);
    }
    $("studyStreak").textContent = `${streak} Day${streak === 1 ? "" : "s"}`;
    $("streakStatus").textContent = streak ? "Active" : "None";
    $("streakNote").textContent = streak
      ? "Keep your verified activity streak going!"
      : "Complete a tracked learning activity to start";
    $("todayChange").textContent =
      dateKey(state.selectedDate) === dateKey(new Date()) ? "Today" : "Selected";
    $("weekChange").textContent =
      `${mondayOf(state.selectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  function renderChart() {
    const weekStart = mondayOf(state.selectedDate);
    const totals = selectedWeekSeconds();
    const maximum = Math.max(
      6 * 3600,
      Math.ceil(Math.max(0, ...Object.values(totals)) / 3600) * 3600,
    );
    $("weeklyBars").parentElement
      .querySelector(".y-labels").innerHTML = Array.from({ length: 7 }, (_, index) => {
        const hours = (maximum / 3600) * (1 - index / 6);
        return `<span>${Number.isInteger(hours) ? hours : hours.toFixed(1)}h</span>`;
      }).join("");
    $("weeklyBars").innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const seconds = totals[dateKey(day)] || 0;
      const height = seconds ? Math.min(100, Math.max(1, Math.round((seconds / maximum) * 100))) : 0;
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
        if (end <= start) return;
        const overlapMilliseconds = end - start;
        const intervalMilliseconds = segment.end.getTime() - segment.start.getTime();
        const fullInterval =
          start === segment.start.getTime() && end === segment.end.getTime();
        const seconds = Number.isFinite(segment.durationSeconds)
          ? (fullInterval
            ? segment.durationSeconds
            : Math.round(
              segment.durationSeconds * overlapMilliseconds / intervalMilliseconds,
            ))
          : Math.round(overlapMilliseconds / 1000);
        totals.set(subjectId, totals.get(subjectId) + seconds);
      });
    });

    const maximum = Math.max(...totals.values(), 1);
    $("subjectList").innerHTML = state.subjectsLoading
      ? '<div class="empty-state">Loading your assigned subjects…</div>'
      : state.subjectLoadError
        ? '<div class="empty-state">Assigned subjects could not be loaded.</div>'
        : state.subjects.length
      ? state.subjects.map((subject, index) => {
        const seconds = totals.get(String(subject.id)) || 0;
        const color = subjectColors[index % subjectColors.length];
        const width = Math.min(100, Math.round((seconds / maximum) * 100));
        return `<div class="subject-row"><div class="subject-name"><span class="subject-dot dot-${color}"></span>${escapeHtml(subject.name)}</div><div class="subject-progress"><div class="subject-progress-fill fill-${color}" style="width:${width}%"></div></div><div class="subject-time">${formatDuration(seconds)}</div></div>`;
      }).join("")
      : '<div class="empty-state">No assigned subjects found for your registered grade and stream.</div>';
  }

  function renderGoalControls() {
    $("editGoal").disabled = state.busy;
  }

  function renderAll() {
    renderDate();
    renderStats();
    renderChart();
    renderSubjects();
    renderGoalControls();
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
    renderGoalControls();
    try {
      state.dailyGoalMinutes = minutes;
      renderAll();
      showStatus("Daily goal updated for this page only; no backend is connected.");
    } catch (error) {
      console.error("Could not update the daily study goal.", error);
      showStatus(error.message || "Unable to update your daily goal.", true);
    } finally {
      state.busy = false;
      renderGoalControls();
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
    $("editGoal").addEventListener("click", () => void updateGoal());
  }

  async function init() {
    bindEvents();
    renderAll();
    showStatus("Loading your assigned subjects…");
    try {
      const client = window.SmartLearningSupabase?.getClient?.();
      if (!client) throw new Error("Supabase is not configured.");
      const curriculum = await window.StudentCurriculum.loadCurrentStudent(client);
      if (!Array.isArray(curriculum?.subjects)) {
        throw new Error("The student curriculum query returned an invalid subjects list.");
      }

      state.subjects = curriculum.subjects;
      state.subjectsById = new Map(
        state.subjects.map((subject) => [String(subject.id), subject]),
      );
      state.subjectIdsByName = new Map();
      state.subjects.forEach((subject) => {
        const key = String(subject.name || "").trim().toLowerCase();
        if (!key) return;
        const matches = state.subjectIdsByName.get(key) || [];
        matches.push(String(subject.id));
        state.subjectIdsByName.set(key, matches);
      });
      state.subjectsLoading = false;
      renderAll();
      showStatus("Assigned subjects loaded. Study records are unavailable because the Study Time backend is disconnected.");
    } catch (error) {
      console.error("Could not load assigned subjects for study time.", error);
      state.subjectsLoading = false;
      state.subjectLoadError = error;
      renderAll();
      showStatus(
        `Unable to load assigned subjects: ${error.message || "An unexpected error occurred."}`,
        true,
      );
    }
  }

  document.addEventListener("DOMContentLoaded", () => void init());
})();
