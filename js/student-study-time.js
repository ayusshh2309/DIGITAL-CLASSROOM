(() => {
  const DEFAULT_GOAL_MINUTES = 360;
  const PAGE_SIZE = 1000;
  const SESSION_STATUSES = new Set(["active", "completed", "abandoned", "paused"]);
  const STREAK_THRESHOLD_SECONDS = 30 * 60;
  const CALENDAR_TIME_ZONE = "Asia/Kolkata";
  const calendarFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const state = {
    client: null,
    studentId: null,
    dailyGoalMinutes: DEFAULT_GOAL_MINUTES,
    subjects: [],
    subjectsById: new Map(),
    subjectIdsByName: new Map(),
    subjectsLoading: true,
    subjectLoadError: null,
    dataLoading: true,
    dataLoadError: null,
    goalReady: false,
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
    const parts = indiaDateTimeParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function indiaDateTimeParts(date) {
    const parts = Object.fromEntries(
      calendarFormatter.formatToParts(new Date(date))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  }

  function instantAtIndiaMidnight(year, month, day) {
    const targetUtc = Date.UTC(year, month - 1, day);
    let timestamp = targetUtc;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = indiaDateTimeParts(timestamp);
      const displayedAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
      const correction = targetUtc - displayedAsUtc;
      timestamp += correction;
      if (correction === 0) break;
    }

    return new Date(timestamp);
  }

  function indiaDayStart(date) {
    const parts = indiaDateTimeParts(date);
    return instantAtIndiaMidnight(parts.year, parts.month, parts.day);
  }

  function addDays(date, amount) {
    const parts = indiaDateTimeParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    calendarDate.setUTCDate(calendarDate.getUTCDate() + amount);
    return instantAtIndiaMidnight(
      calendarDate.getUTCFullYear(),
      calendarDate.getUTCMonth() + 1,
      calendarDate.getUTCDate(),
    );
  }

  function mondayOf(date) {
    const parts = indiaDateTimeParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return addDays(calendarDate, -((calendarDate.getUTCDay() + 6) % 7));
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

  async function readAllRows(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await createQuery()
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  function verifiedSegments() {
    const sessionsById = new Map(
      state.sessions
        .filter((session) => SESSION_STATUSES.has(String(session.status || "").toLowerCase()))
        .map((session) => [String(session.id), session]),
    );
    const seenIds = new Set();
    const seenRanges = new Set();
    const segments = [];

    for (const segment of state.segments) {
      const session = sessionsById.get(String(segment.session_id));
      if (!session) continue;

      const durationSeconds = Number(segment.duration_seconds);
      const start = new Date(segment.started_at);
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        !Number.isFinite(start.getTime())
      ) {
        continue;
      }

      const end = segment.ended_at
        ? new Date(segment.ended_at)
        : new Date(start.getTime() + durationSeconds * 1000);
      if (!Number.isFinite(end.getTime()) || end <= start) continue;

      if (segment.id != null) {
        const id = String(segment.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      const rangeKey = [
        session.id,
        start.getTime(),
        end.getTime(),
        durationSeconds,
      ].join(":");
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);

      segments.push({
        session,
        start,
        end,
        durationSeconds,
      });
    }
    segments.sort((left, right) =>
      left.start.getTime() - right.start.getTime() ||
      String(left.session.id).localeCompare(String(right.session.id)),
    );
    const nonOverlappingSegments = [];
    let coveredUntil = -Infinity;
    for (const segment of segments) {
      const originalStart = segment.start.getTime();
      const originalEnd = segment.end.getTime();
      if (originalEnd <= coveredUntil) continue;
      if (originalStart < coveredUntil) {
        const originalInterval = originalEnd - originalStart;
        const retainedInterval = originalEnd - coveredUntil;
        segment.durationSeconds *= retainedInterval / originalInterval;
        segment.start = new Date(coveredUntil);
      }
      coveredUntil = segment.end.getTime();
      nonOverlappingSegments.push(segment);
    }
    return nonOverlappingSegments;
  }

  function addSegmentToDailyTotals(totals, segment, rangeStart, rangeEnd) {
    let cursor = new Date(Math.max(segment.start.getTime(), rangeStart.getTime()));
    const finalTime = Math.min(segment.end.getTime(), rangeEnd.getTime());
    if (finalTime <= cursor) return;

    const intervalMilliseconds = segment.end.getTime() - segment.start.getTime();
    while (cursor.getTime() < finalTime) {
      const nextMidnight = addDays(cursor, 1);
      const intervalEnd = Math.min(nextMidnight.getTime(), finalTime);
      const seconds = segment.durationSeconds *
        (intervalEnd - cursor.getTime()) / intervalMilliseconds;
      const key = dateKey(cursor);
      totals[key] = (totals[key] || 0) + seconds;
      cursor = new Date(intervalEnd);
    }
  }

  function secondsByDate(startDate, endDate) {
    const totals = {};
    const rangeStart = indiaDayStart(startDate);
    const rangeEnd = addDays(indiaDayStart(endDate), 1);
    verifiedSegments().forEach((segment) =>
      addSegmentToDailyTotals(totals, segment, rangeStart, rangeEnd));
    return totals;
  }

  function allDailyTotals() {
    const totals = {};
    verifiedSegments().forEach((segment) =>
      addSegmentToDailyTotals(
        totals,
        segment,
        indiaDayStart(segment.start),
        addDays(indiaDayStart(segment.end), 1),
      ));
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
      timeZone: CALENDAR_TIME_ZONE,
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

    const dailyTotals = allDailyTotals();
    let streak = 0;
    let streakCursor = indiaDayStart(new Date());
    if ((dailyTotals[dateKey(streakCursor)] || 0) < STREAK_THRESHOLD_SECONDS) {
      streakCursor = addDays(streakCursor, -1);
    }
    while ((dailyTotals[dateKey(streakCursor)] || 0) >= STREAK_THRESHOLD_SECONDS) {
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
      `${mondayOf(state.selectedDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: CALENDAR_TIME_ZONE,
      })}`;
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
      return `<div class="bar-group"><div class="bar-wrapper"><div class="bar${todayClass}${zeroClass}" style="height:${height}%" title="${day.toLocaleDateString("en-US", { weekday: "long", timeZone: CALENDAR_TIME_ZONE })}: ${formatDuration(seconds)}"></div></div><span class="hours">${seconds ? `${(seconds / 3600).toFixed(1)}h` : "0h"}</span><span class="day">${day.toLocaleDateString("en-US", { weekday: "short", timeZone: CALENDAR_TIME_ZONE })}</span></div>`;
    }).join("");
  }

  function renderSubjects() {
    const weekStart = mondayOf(state.selectedDate);
    const weekEnd = addDays(weekStart, 7);
    const totals = new Map(state.subjects.map((subject) => [String(subject.id), 0]));

    verifiedSegments().forEach((segment) => {
      const session = segment.session;
      let subjectId = session.subject_id == null ? null : String(session.subject_id);
      if (!totals.has(subjectId)) {
        const matches = state.subjectIdsByName.get(String(session.subject || "").toLowerCase()) || [];
        if (matches.length === 1) subjectId = matches[0];
      }
      if (!totals.has(subjectId)) return;
      const start = Math.max(segment.start.getTime(), weekStart.getTime());
      const end = Math.min(segment.end.getTime(), weekEnd.getTime());
      if (end <= start) return;
      const intervalMilliseconds = segment.end.getTime() - segment.start.getTime();
      const seconds = segment.durationSeconds * (end - start) / intervalMilliseconds;
      totals.set(subjectId, totals.get(subjectId) + seconds);
    });

    const maximum = Math.max(...totals.values(), 1);
    $("subjectList").innerHTML = state.subjectsLoading
      ? '<div class="empty-state">Loading your assigned subjects…</div>'
      : state.subjectLoadError
        ? '<div class="empty-state">Assigned subjects could not be loaded.</div>'
        : state.dataLoading
          ? '<div class="empty-state">Loading verified study time…</div>'
          : state.dataLoadError
            ? '<div class="empty-state">Verified study time could not be loaded.</div>'
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
    $("editGoal").disabled = state.busy || state.dataLoading || !state.goalReady;
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
      const { error } = await state.client.rpc(
        "study_time_set_goal_v1",
        { p_goal_minutes: minutes },
      );
      if (error) throw error;
      state.dailyGoalMinutes = minutes;
      renderAll();
      showStatus("Daily study goal saved to your account.");
    } catch (error) {
      console.error("Could not update the daily study goal.", error);
      showStatus(error.message || "Unable to update your daily goal.", true);
    } finally {
      state.busy = false;
      renderGoalControls();
    }
  }

  async function fetchStudentSessions(studentId) {
    return readAllRows(() => state.client
      .from("study_sessions")
      .select("id, student_id, subject_id, status")
      .eq("student_id", studentId)
      .order("id", { ascending: true }));
  }

  async function fetchSessionSegments(sessions) {
    const sessionIds = sessions
      .map((session) => String(session.id))
      .filter(Boolean);
    const segments = [];
    for (let index = 0; index < sessionIds.length; index += 100) {
      const batch = sessionIds.slice(index, index + 100);
      const rows = await readAllRows(() => state.client
        .from("study_session_segments")
        .select("id, session_id, started_at, ended_at, duration_seconds")
        .in("session_id", batch)
        .order("id", { ascending: true }));
      segments.push(...rows);
    }
    return segments;
  }

  async function fetchDailyGoal(studentId) {
    const { data, error } = await state.client
      .from("students")
      .select("daily_study_goal_minutes")
      .eq("id", studentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your student profile could not be loaded.");
    if (data.daily_study_goal_minutes == null) return DEFAULT_GOAL_MINUTES;

    const goalMinutes = Number(data.daily_study_goal_minutes);
    if (!Number.isInteger(goalMinutes) || goalMinutes < 1 || goalMinutes > 1440) {
      throw new Error("Your saved daily study goal must be between 1 and 1440 minutes.");
    }
    return goalMinutes;
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
    showStatus("Loading your assigned subjects and verified study records…");
    try {
      state.client = window.SmartLearningSupabase?.getClient?.();
      if (!state.client) throw new Error("Supabase is not configured.");
      const curriculum = await window.StudentCurriculum.loadCurrentStudent(state.client);
      if (!Array.isArray(curriculum?.subjects)) {
        throw new Error("The student curriculum query returned an invalid subjects list.");
      }
      if (!curriculum?.student?.id || !curriculum?.user?.id) {
        throw new Error("The authenticated student profile could not be verified.");
      }

      state.studentId = String(curriculum.student.id);
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

      const [sessions, dailyGoalMinutes] = await Promise.all([
        fetchStudentSessions(state.studentId),
        fetchDailyGoal(state.studentId),
      ]);
      const segments = await fetchSessionSegments(sessions);
      state.sessions = sessions;
      state.segments = segments;
      state.dailyGoalMinutes = dailyGoalMinutes;
      state.goalReady = true;
      state.dataLoading = false;
      state.dataLoadError = null;
      renderAll();
      showStatus("");
    } catch (error) {
      console.error("Could not load verified study-time data.", error);
      state.subjectsLoading = false;
      state.dataLoading = false;
      state.dataLoadError = error;
      if (!state.studentId) state.subjectLoadError = error;
      renderAll();
      showStatus(
        `Unable to load verified study-time data: ${error.message || "An unexpected error occurred."}`,
        true,
      );
    }
  }

  document.addEventListener("DOMContentLoaded", () => void init());
})();
