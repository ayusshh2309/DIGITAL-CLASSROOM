(() => {
  "use strict";

  const MATERIAL_TYPES = ["pdf", "document", "photo", "image", "video"];
  const FALLBACK_REFRESH_MS = 60_000;
  const REFRESH_DEBOUNCE_MS = 500;
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
    user: null,
    student: null,
    subjects: [],
    materials: [],
    materialCount: null,
    classes: [],
    joinableClassIds: new Set(),
    quizCount: null,
    sessions: [],
    segments: [],
    studyLoading: false,
    rankXp: null,
    errors: {},
    channel: null,
    authSubscription: null,
    debounce: null,
    fallback: null,
    clock: null,
    loadSequence: 0,
    identitySequence: 0,
    started: false,
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  function displayError(error) {
    return String(error?.message || error || "Please try again.");
  }

  function setSyncStatus(message, isError = false) {
    const element = $("dashboardSyncStatus");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = isError ? "error" : "ready";
  }

  function formatDuration(seconds) {
    const minutes = Math.max(0, Math.floor(Number(seconds || 0) / 60));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}h ${rest}m`;
    if (hours) return `${hours}h`;
    return `${rest}m`;
  }

  function formatDate(value) {
    const date = parseZonedTimestamp(value);
    if (!date) return "Date unavailable";
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: CALENDAR_TIME_ZONE,
    });
  }

  function formatTime(value) {
    const date = parseZonedTimestamp(value);
    if (!date) return "";
    return date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: CALENDAR_TIME_ZONE,
    });
  }

  function parseZonedTimestamp(value) {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
    }
    const raw = String(value ?? "").trim();
    const timestamp = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp)) {
      return null;
    }
    const normalized = timestamp.replace(
      /([+-])(\d{2})(?::?(\d{2}))?$/,
      (_, sign, hours, minutes = "00") => `${sign}${hours}:${minutes}`,
    );
    const milliseconds = Date.parse(normalized);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  }

  function calendarDateParts(date) {
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

  function dateKey(date) {
    const parts = calendarDateParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function instantAtCalendarMidnight(year, month, day) {
    const targetUtc = Date.UTC(year, month - 1, day);
    let timestamp = targetUtc;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = calendarDateParts(timestamp);
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

  function calendarMidnight(date) {
    const parts = calendarDateParts(date);
    return instantAtCalendarMidnight(parts.year, parts.month, parts.day);
  }

  function addCalendarDays(date, amount) {
    const parts = calendarDateParts(date);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    calendarDate.setUTCDate(calendarDate.getUTCDate() + amount);
    return instantAtCalendarMidnight(
      calendarDate.getUTCFullYear(),
      calendarDate.getUTCMonth() + 1,
      calendarDate.getUTCDate(),
    );
  }

  function responseRows(data, source) {
    if (data == null) return [];
    if (!Array.isArray(data)) {
      throw new Error(`${source} query returned an unexpected response; expected a row array.`);
    }
    return data;
  }

  async function readAll(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await createQuery(offset, offset + 999);
      if (error) throw error;
      const page = responseRows(data, "Student dashboard");
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  function currentWeekDays(now = new Date()) {
    const parts = calendarDateParts(now);
    const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const monday = addCalendarDays(
      calendarMidnight(now),
      -((calendarDate.getUTCDay() + 6) % 7),
    );
    return Array.from({ length: 7 }, (_, index) => {
      const start = addCalendarDays(monday, index);
      const end = addCalendarDays(start, 1);
      return { start, end, key: dateKey(start) };
    });
  }

  function getStudyIntervals() {
    const utils = window.StudentStudyTimeUtils;
    if (!utils?.getVerifiedSegments) {
      throw new Error("The verified study-time service did not load.");
    }
    return utils.getVerifiedSegments(state.sessions, state.segments).map((segment) => ({
      start: segment.start,
      end: segment.end,
      durationSeconds: segment.durationSeconds,
      subjectId: segment.session.subject_id == null
        ? null
        : String(segment.session.subject_id),
    }));
  }

  function calculateStudyStats(now = new Date()) {
    const days = currentWeekDays(now);
    const byDay = new Map(days.map((day) => [day.key, 0]));
    const bySubject = new Map();
    let weekSeconds = 0;
    let todaySeconds = 0;
    const intervals = getStudyIntervals();
    for (const interval of intervals) {
      for (const day of days) {
        const start = Math.max(interval.start.getTime(), day.start.getTime());
        const end = Math.min(interval.end.getTime(), day.end.getTime());
        if (end <= start) continue;
        const overlapMilliseconds = end - start;
        const intervalMilliseconds = interval.end.getTime() - interval.start.getTime();
        const fullInterval = start === interval.start.getTime() && end === interval.end.getTime();
        const seconds = Number.isFinite(interval.durationSeconds)
          ? (fullInterval
            ? interval.durationSeconds
            : Math.round(interval.durationSeconds * overlapMilliseconds / intervalMilliseconds))
          : Math.round(overlapMilliseconds / 1000);
        weekSeconds += seconds;
        byDay.set(day.key, (byDay.get(day.key) || 0) + seconds);
        if (day.key === dateKey(now)) todaySeconds += seconds;
      }
    }
    const weekStart = days[0].start.getTime();
    const weekEnd = days[days.length - 1].end.getTime();
    for (const interval of intervals) {
      if (!interval.subjectId) continue;
      const start = Math.max(interval.start.getTime(), weekStart);
      const end = Math.min(interval.end.getTime(), weekEnd);
      if (end <= start) continue;
      const duration = interval.end.getTime() - interval.start.getTime();
      const seconds = interval.durationSeconds * (end - start) / duration;
      bySubject.set(interval.subjectId, (bySubject.get(interval.subjectId) || 0) + seconds);
    }
    return { days, byDay, bySubject, weekSeconds, todaySeconds };
  }

  function renderSubjects(stats) {
    const container = $("registeredSubjectsList");
    if (!container) return;
    if (state.errors.curriculum) {
      container.innerHTML = `<div class="dashboard-error">Subjects could not be loaded: ${escapeHtml(displayError(state.errors.curriculum))}</div>`;
      return;
    }
    if (state.studyLoading) {
      container.innerHTML = '<div class="dashboard-loading">Loading verified study time…</div>';
      return;
    }
    if (state.errors.study) {
      container.innerHTML = `<div class="dashboard-error">Study time could not be loaded: ${escapeHtml(displayError(state.errors.study))}</div>`;
      return;
    }
    if (!state.subjects.length) {
      container.innerHTML = '<div class="dashboard-empty">No subjects are available for your registered grade and stream.</div>';
      return;
    }
    const maxStudySeconds = Math.max(0, ...state.subjects.map((subject) =>
      stats.bySubject.get(String(subject.id)) || 0,
    ));
    container.innerHTML = state.subjects.map((subject) => {
      const seconds = stats.bySubject.get(String(subject.id)) || 0;
      const width = maxStudySeconds ? Math.min(100, Math.round(seconds / maxStudySeconds * 100)) : 0;
      return `<div class="subject-row">
        <div class="subject-row-top">
          <span class="subject-row-name">${escapeHtml(subject.name)}</span>
          <span class="subject-progress-label">${escapeHtml(formatDuration(seconds))}</span>
        </div>
        <div class="dashboard-progress-track" role="progressbar" aria-label="${escapeHtml(subject.name)} study time compared with the most studied subject" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}">
          <div class="dashboard-progress-fill" style="width: ${width}%"></div>
        </div>
      </div>`;
    }).join("");
  }

  function getMaterialType(material) {
    const type = String(material.material_type || "").trim().toLowerCase();
    const mimeType = String(material.mime_type || "").trim().toLowerCase();
    const fileName = String(material.file_name || material.title || "").trim().toLowerCase();
    const extension = fileName.match(/\.([a-z0-9]+)$/)?.[1] || "";
    if (type === "video" || mimeType.startsWith("video/") ||
      ["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(extension)) {
      return { label: "Video", icon: "fa-file-video", color: "material-purple" };
    }
    if (type === "pdf" || mimeType === "application/pdf" || extension === "pdf") {
      return { label: "PDF", icon: "fa-file-pdf", color: "material-red" };
    }
    if (["photo", "image"].includes(type) || mimeType.startsWith("image/") ||
      ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tif", "tiff"].includes(extension)) {
      return { label: "Image", icon: "fa-file-image", color: "material-green" };
    }
    if (["presentation", "ppt", "pptx"].includes(type) ||
      ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mimeType) ||
      ["ppt", "pptx"].includes(extension)) {
      return { label: "Presentation", icon: "fa-file-powerpoint", color: "material-orange" };
    }
    if (["spreadsheet", "excel", "xls", "xlsx"].includes(type) ||
      ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mimeType) ||
      ["xls", "xlsx", "csv"].includes(extension)) {
      return { label: "Spreadsheet", icon: "fa-file-excel", color: "material-green" };
    }
    if (["document", "doc", "docx"].includes(type) ||
      ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mimeType) ||
      ["doc", "docx"].includes(extension)) {
      return { label: "Document", icon: "fa-file-word", color: "material-blue" };
    }
    return { label: "Document", icon: "fa-file-lines", color: "material-blue" };
  }

  function renderMaterials() {
    const container = $("recentMaterialsList");
    if (!container) return;
    if (state.errors.materials) {
      container.innerHTML = `<div class="dashboard-error">Materials could not be loaded: ${escapeHtml(displayError(state.errors.materials))}</div>`;
      return;
    }
    if (!state.materials.length) {
      container.innerHTML = '<div class="dashboard-empty">No recent materials are available for your subjects.</div>';
      return;
    }
    container.innerHTML = state.materials.map((material) => {
      const type = getMaterialType(material);
      const subject = state.subjectsById?.get(String(material.subject_id))?.name || "Subject";
      const teacher = material.teacher_name
        ? `<span class="material-teacher">${escapeHtml(material.teacher_name)}</span>`
        : "";
      const actionLabel = type.label === "Document" ? "Download" : "View";
      return `<div class="material">
        <div class="material-icon ${type.color}" aria-hidden="true"><i class="fa-solid ${type.icon}"></i></div>
        <div class="material-info">
          <strong>${escapeHtml(material.title || material.file_name || "Untitled material")}</strong>
          <span>${escapeHtml(subject)} · ${type.label}${teacher ? ` · ${teacher}` : ""}</span>
          <small>${escapeHtml(formatDate(material.created_at))}</small>
        </div>
        <button class="material-action" type="button" data-material-open="${escapeHtml(material.id)}" data-material-action="${actionLabel.toLowerCase()}">${actionLabel}</button>
      </div>`;
    }).join("");
  }

  function classDateTime(item, key) {
    const timestamp = item[key];
    if (timestamp) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) return date;
    }
    const datePart = item.class_date;
    const timePart = key === "start_at" ? item.start_time : item.end_time;
    if (datePart && timePart) {
      const date = new Date(`${datePart}T${String(timePart).slice(0, 8)}`);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  function getClassStatus(item, now = new Date()) {
    const start = classDateTime(item, "start_at");
    const end = classDateTime(item, "end_at");
    const raw = String(item.status || "").toLowerCase();
    if (["cancelled", "canceled", "completed", "ended"].includes(raw)) return "Completed";
    if (start && end && now >= start && now < end) return "Live";
    if (end && now >= end) return "Completed";
    return "Upcoming";
  }

  function isClassRelevant(item) {
    return Number(item.grade) === Number(state.student.grade) &&
      (Number(state.student.grade) <= 10 ||
        String(item.stream || "").trim().toLowerCase() ===
          String(state.student.stream || "").trim().toLowerCase()) &&
      state.subjectIds.has(String(item.subject_id));
  }

  function renderClasses(now = new Date()) {
    const container = $("todayClassesList");
    if (!container) return;
    if (state.errors.classes) {
      container.innerHTML = `<div class="dashboard-error">Classes could not be loaded: ${escapeHtml(displayError(state.errors.classes))}</div>`;
      return;
    }
    const todayKey = dateKey(now);
    const today = state.classes.filter((item) => {
      if (!isClassRelevant(item)) return false;
      const start = classDateTime(item, "start_at");
      return start && dateKey(start) === todayKey;
    }).sort((left, right) =>
      (classDateTime(left, "start_at")?.getTime() || 0) -
      (classDateTime(right, "start_at")?.getTime() || 0),
    );
    if (!today.length) {
      container.innerHTML = '<div class="dashboard-empty">No classes scheduled today.</div>';
      return;
    }
    container.innerHTML = today.map((item) => {
      const status = getClassStatus(item, now);
      const start = classDateTime(item, "start_at");
      const end = classDateTime(item, "end_at");
      const joinButton = status === "Live" && state.joinableClassIds.has(String(item.id))
        ? `<button class="class-join-button" type="button" data-class-join="${escapeHtml(item.id)}">Join Class</button>`
        : "";
      return `<div class="schedule-item">
        <div class="schedule-time">${escapeHtml(start ? formatTime(start) : "")}${end ? ` – ${escapeHtml(formatTime(end))}` : ""}</div>
        <div class="schedule-info">
          <strong>${escapeHtml(item.title || item.topic || "Live class")}</strong>
          <span>${escapeHtml(item.subject_name || "Subject")}${item.teacher_name ? ` · ${escapeHtml(item.teacher_name)}` : ""}</span>
        </div>
        <span class="live-tag">${status}</span>
        ${joinButton}
      </div>`;
    }).join("");
  }

  function renderStudentRank() {
    const title = $("studentRankTitle");
    const subtitle = $("studentRankSubtitle");
    const icon = $("studentRankIcon");
    const progressTrack = $("studentRankProgressTrack");
    const progressFill = $("studentRankProgressFill");
    const progressLabel = $("studentRankProgressLabel");
    const progressPercent = $("studentRankProgressPercent");
    const remaining = $("studentRankRemaining");
    const levelNumber = $("studentRankLevel");
    const xpBadge = $("studentRankXpBadge");
    const panel = document.querySelector(".student-rank-panel");
    const since = $("studentRankSince");
    const status = $("studentRankStatus");
    if (!title || !subtitle || !icon || !progressTrack || !progressFill) return;

    const userCreatedAt = state.user?.created_at
      ? new Date(state.user.created_at)
      : null;
    since.textContent = userCreatedAt && !Number.isNaN(userCreatedAt.getTime())
      ? userCreatedAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : "—";
    status.textContent = state.user && state.student ? "Active" : "—";

    if (state.errors.rank) {
      title.textContent = "Your XP Rank";
      subtitle.textContent = `Rank could not be loaded: ${displayError(state.errors.rank)}`;
      progressLabel.textContent = "Progress unavailable";
      progressPercent.textContent = "—";
      progressFill.style.width = "0%";
      progressTrack.setAttribute("aria-valuenow", "0");
      progressTrack.setAttribute("aria-valuetext", "Rank progress unavailable");
      remaining.textContent = "";
      if (xpBadge) xpBadge.textContent = "— XP";
      levelNumber.textContent = "Level —";
      if (panel) panel.dataset.rankError = "true";
      return;
    }

    if (state.rankXp == null) {
      title.textContent = "Loading rank…";
      subtitle.textContent = "Current Rank";
      progressLabel.textContent = "Loading rank progress…";
      progressPercent.textContent = "—";
      progressFill.style.width = "0%";
      progressTrack.setAttribute("aria-valuenow", "0");
      progressTrack.setAttribute("aria-valuetext", "Loading rank progress");
      remaining.textContent = "";
      if (xpBadge) xpBadge.textContent = "— XP";
      levelNumber.textContent = "Level —";
      if (panel) panel.dataset.rankError = "false";
      return;
    }

    const rankService = window.StudentXpLevel;
    if (!rankService?.getLevel) {
      throw new Error("The shared XP level service did not load.");
    }
    const { currentXp, current, next, progress, remaining: xpRemaining } =
      rankService.getLevel(state.rankXp);
    title.textContent = `${current.title} Rank`;
    subtitle.textContent = "Current Rank";
    icon.dataset.levelColor = current.color;
    icon.innerHTML = `<i class="fa-solid ${current.icon}" aria-hidden="true"></i>`;
    levelNumber.textContent = `Level ${current.number}`;
    progressPercent.textContent = `(${Math.round(progress)}% Complete)`;
    progressFill.style.width = `${progress}%`;
    if (xpBadge) {
      xpBadge.textContent = `${currentXp.toLocaleString()} XP`;
      xpBadge.style.left = `${Math.max(4, Math.min(96, progress))}%`;
    }
    if (panel) panel.dataset.rankError = "false";
    progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
    progressTrack.setAttribute(
      "aria-valuetext",
      next
        ? `${currentXp} XP Coins; ${xpRemaining} needed for ${next.title}`
        : "Maximum XP level reached",
    );
    if (next) {
      progressLabel.textContent = `${currentXp.toLocaleString()} / ${next.minXp.toLocaleString()} XP`;
      remaining.textContent = `Next: ${next.title} Rank (requires ${xpRemaining.toLocaleString()} XP)`;
    } else {
      progressLabel.textContent = "MAX LEVEL";
      progressPercent.textContent = "(100% Complete)";
      remaining.textContent = "You have reached the highest rank.";
    }
  }

  function renderSummary(now = new Date()) {
    const stats = state.errors.study || state.studyLoading ? null : calculateStudyStats(now);
    $("dashboardSubjectCount").textContent = state.errors.curriculum ? "—" : String(state.subjects.length);
    const relevantClasses = state.classes.filter((item) => {
      if (!isClassRelevant(item)) return false;
      const start = classDateTime(item, "start_at");
      const end = classDateTime(item, "end_at");
      const status = getClassStatus(item, now);
      return status === "Live" || (status === "Upcoming" && start && start > now && (!end || end > now));
    });
    $("dashboardLiveClassCount").textContent = state.errors.classes ? "—" : String(relevantClasses.length);
    $("dashboardQuizCount").textContent = state.errors.quizzes ? "—" : String(state.quizCount ?? 0);
    $("dashboardMaterialCount").textContent = state.errors.materials ? "—" : String(state.materialCount ?? 0);
    $("dashboardStudyTime").textContent = stats ? formatDuration(stats.weekSeconds) : "—";
    $("dashboardStudyTimeNote").textContent = state.errors.study ? "Unavailable" : "Verified this week";
    const greeting = $("welcomeGreeting");
    if (greeting) {
      const firstName = String(state.student?.full_name || "").trim().split(/\s+/)[0];
      greeting.textContent = firstName ? `Good to see you, ${firstName}!` : "Welcome back!";
    }
  }

  function renderAll(now = new Date()) {
    if (state.student) {
      state.subjectsById = new Map(state.subjects.map((subject) => [String(subject.id), subject]));
      state.subjectIds = new Set(state.subjects.map((subject) => String(subject.id)));
      const stats = state.errors.study || state.studyLoading
        ? { bySubject: new Map() }
        : calculateStudyStats(now);
      renderSubjects(stats);
      renderSummary(now);
      renderMaterials();
      renderClasses(now);
      renderStudentRank();
    }
    const todayElement = $("todayDate");
    if (todayElement) {
      todayElement.textContent = now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: CALENDAR_TIME_ZONE,
      });
    }
    const clockElement = $("currentTime");
    if (clockElement) {
      clockElement.textContent = now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: CALENDAR_TIME_ZONE,
      });
    }
  }

  function recordSourceError(key, error, label) {
    state.errors[key] = error;
    console.error(`Student dashboard ${label} query failed.`, error);
  }

  async function loadMaterials(sequence) {
    if (!state.subjects.length) {
      state.materials = [];
      state.materialCount = 0;
      delete state.errors.materials;
      return;
    }
    let query = state.client
      .from("materials")
      .select("id, teacher_id, grade, stream, subject_id, title, material_type, file_name, file_path, storage_bucket, mime_type, created_at", { count: "exact" })
      .eq("grade", state.student.grade)
      .in("subject_id", [...state.subjectIds])
      .in("material_type", MATERIAL_TYPES);
    query = Number(state.student.grade) <= 10
      ? query.is("stream", null)
      : query.eq("stream", state.student.stream);
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .limit(5);
    if (sequence !== state.loadSequence) return;
    if (error) throw error;
    state.materials = responseRows(data, "Student materials");
    state.materialCount = count ?? state.materials.length;
    delete state.errors.materials;
    const teacherIds = [...new Set(state.materials.map((row) => row.teacher_id).filter(Boolean))];
    if (teacherIds.length) {
      const { data: teachers, error: teacherError } = await state.client
        .from("teachers")
        .select("id, full_name")
        .in("id", teacherIds);
      if (teacherError) {
        console.warn("Student dashboard could not load optional teacher names.", teacherError);
      } else {
        const names = new Map((teachers || []).map((teacher) => [String(teacher.id), teacher.full_name]));
        state.materials = state.materials.map((material) => ({
          ...material,
          teacher_name: names.get(String(material.teacher_id)) || "",
        }));
      }
    }
  }

  async function loadClasses(sequence) {
    const data = await readAll((from, to) => state.client
      .rpc("get_student_live_classes")
      .range(from, to));
    if (sequence !== state.loadSequence) return;
    state.classes = data.filter(isClassRelevant);
    state.joinableClassIds = new Set();
    delete state.errors.join;
    const now = new Date();
    const liveClasses = state.classes.filter((item) => getClassStatus(item, now) === "Live");
    const joinChecks = await Promise.all(liveClasses.map(async (item) => {
      const { data: url, error } = await state.client.rpc("get_student_live_class_join_url", {
        requested_class_id: item.id,
      });
      if (sequence !== state.loadSequence) return null;
      if (error) {
        if (error.code !== "42501") {
          recordSourceError("join", error, "class-join validation");
        }
        return null;
      }
      if (typeof url === "string" && /^https:\/\/[^\s]+$/i.test(url)) {
        return String(item.id);
      }
      return null;
    }));
    if (sequence !== state.loadSequence) return;
    state.joinableClassIds = new Set(joinChecks.filter(Boolean));
    delete state.errors.classes;
  }

  function quizIsAvailable(quiz, now) {
    if (String(quiz.status || "").toLowerCase() !== "published") return false;
    if (!quiz.scheduled_date) return true;
    const time = String(quiz.scheduled_time || "").slice(0, 8) || "00:00:00";
    const startsAt = new Date(`${quiz.scheduled_date}T${time}+05:30`);
    return Number.isFinite(startsAt.getTime()) && startsAt <= now;
  }

  async function loadQuizzes(now, sequence) {
    const catalog = await readAll((from, to) => state.client
      .rpc("get_student_quiz_catalog")
      .range(from, to));
    if (sequence !== state.loadSequence) return;
    const eligible = catalog.filter((quiz) =>
      quiz.subject_id != null &&
      state.subjectIds.has(String(quiz.subject_id)) &&
      Number(quiz.grade) === Number(state.student.grade) &&
      (Number(state.student.grade) <= 10 ||
        String(quiz.stream || "").trim().toLowerCase() ===
          String(state.student.stream || "").trim().toLowerCase()) &&
      String(quiz.quiz_status || "").toLowerCase() === "published",
    );
    if (!eligible.length) {
      state.quizCount = 0;
      delete state.errors.quizzes;
      return;
    }
    const ids = [...new Set(eligible.map((quiz) => quiz.id))];
    const { data, error } = await state.client
      .from("quizzes")
      .select("id, status, scheduled_date, scheduled_time")
      .in("id", ids);
    if (sequence !== state.loadSequence) return;
    if (error) throw error;
    const availableIds = new Set((data || [])
      .filter((quiz) => quizIsAvailable(quiz, now))
      .map((quiz) => String(quiz.id)));
    state.quizCount = availableIds.size;
    delete state.errors.quizzes;
  }

  async function loadStudyData(sequence) {
    const sessions = await readAll((from, to) => state.client
      .from("study_sessions")
      .select("id, student_id, subject_id, status")
      .eq("student_id", state.student.id)
      .order("id", { ascending: true })
      .range(from, to));
    if (sequence !== state.loadSequence) return;

    const sessionIds = sessions
      .map((session) => String(session.id))
      .filter(Boolean);
    const segments = [];
    for (let index = 0; index < sessionIds.length; index += 100) {
      const batch = sessionIds.slice(index, index + 100);
      const rows = await readAll((from, to) => state.client
        .from("study_session_segments")
        .select("id, session_id, started_at, ended_at, duration_seconds")
        .in("session_id", batch)
        .order("id", { ascending: true })
        .range(from, to));
      if (sequence !== state.loadSequence) return;
      segments.push(...rows);
    }

    if (sequence !== state.loadSequence) return;
    state.sessions = sessions;
    state.segments = segments;
    state.studyLoading = false;
    delete state.errors.study;
  }

  async function loadAchievementXp(sequence) {
    const queryForStudent = (studentId) => readAll((from, to) => state.client
      .from("student_achievements")
      .select("achievement_id, xp_earned")
      .eq("student_id", studentId)
      .order("unlocked_at", { ascending: false })
      .order("achievement_id", { ascending: true })
      .range(from, to));
    let achievements = await queryForStudent(state.user.id);
    if (sequence !== state.loadSequence) return;
    if (!achievements.length && String(state.student.id) !== String(state.user.id)) {
      achievements = await queryForStudent(state.student.id);
      if (sequence !== state.loadSequence) return;
    }
    state.rankXp = achievements.reduce(
      (total, achievement) => total + (Number(achievement.xp_earned) || 0),
      0,
    );
    delete state.errors.rank;
  }

  async function refreshDashboard(showLoading = false) {
    if (!state.client || !state.user || !state.student) return;
    const sequence = ++state.loadSequence;
    if (showLoading) setSyncStatus("Refreshing dashboard…");
    const now = new Date();
    const tasks = [
      ["materials", "materials", () => loadMaterials(sequence)],
      ["classes", "classes", () => loadClasses(sequence)],
      ["quizzes", "quizzes", () => loadQuizzes(now, sequence)],
      ["study", "verified study time", () => loadStudyData(sequence)],
      ["rank", "student rank", () => loadAchievementXp(sequence)],
    ];
    await Promise.all(tasks.map(async ([key, label, load]) => {
      try {
        await load();
        if (sequence === state.loadSequence) delete state.errors[key];
      } catch (error) {
        if (sequence !== state.loadSequence) return;
        recordSourceError(key, error, label);
        if (key === "materials") {
          state.materials = [];
          state.materialCount = null;
        } else if (key === "classes") {
          state.classes = [];
          state.joinableClassIds = new Set();
        } else if (key === "quizzes") {
          state.quizCount = null;
        } else if (key === "study") {
          state.sessions = [];
          state.segments = [];
          state.studyLoading = false;
        } else if (key === "rank") {
          state.rankXp = null;
        }
      }
    }));
    if (sequence !== state.loadSequence) return;
    renderAll();
    const errors = Object.entries(state.errors);
    if (errors.length) {
      setSyncStatus(`Some dashboard data is unavailable (${errors.map(([key]) => key).join(", ")}).`, true);
    } else {
      setSyncStatus("");
    }
  }

  async function loadStudent(user) {
    const identitySequence = ++state.identitySequence;
    const curriculum = await window.StudentCurriculum.loadCurrentStudent(state.client);
    if (!Array.isArray(curriculum?.subjects)) {
      throw new Error("The student curriculum query returned an invalid subjects list.");
    }
    if (identitySequence !== state.identitySequence) return;
    if (String(curriculum.user.id) !== String(user.id)) {
      throw new Error("The signed-in account changed while the dashboard was loading.");
    }
    state.user = user;
    state.student = curriculum.student;
    state.subjects = curriculum.subjects || [];
    state.subjectIds = new Set(state.subjects.map((subject) => String(subject.id)));
    state.subjectsById = new Map(state.subjects.map((subject) => [String(subject.id), subject]));
    state.errors = {};
    state.sessions = [];
    state.segments = [];
    state.studyLoading = true;
    state.rankXp = null;
    renderAll();
    await refreshDashboard(true);
  }

  function scheduleRefresh() {
    if (state.debounce) window.clearTimeout(state.debounce);
    state.debounce = window.setTimeout(() => {
      state.debounce = null;
      void refreshDashboard();
    }, REFRESH_DEBOUNCE_MS);
  }

  function stopRealtime() {
    if (state.channel && state.client) {
      void state.client.removeChannel(state.channel);
      state.channel = null;
    }
    state.realtimeReady = false;
  }

  function startRealtime() {
    stopRealtime();
    if (!state.client || !state.user) return;
    const channel = state.client.channel(`student-dashboard-${state.user.id}`);
    const subscribeTable = (table, filter) => {
      const config = { event: "*", schema: "public", table };
      if (filter) config.filter = filter;
      channel.on("postgres_changes", config, scheduleRefresh);
    };
    subscribeTable("materials");
    subscribeTable("live_classes");
    subscribeTable("quizzes");
    subscribeTable("students", `user_id=eq.${state.user.id}`);
    subscribeTable("subjects");
    subscribeTable("study_sessions", `student_id=eq.${state.student.id}`);
    subscribeTable("study_session_segments");
    subscribeTable("student_achievements", `student_id=eq.${state.student.id}`);
    if (String(state.student.id) !== String(state.user.id)) {
      subscribeTable("student_achievements", `student_id=eq.${state.user.id}`);
    }
    state.channel = channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        state.realtimeReady = true;
        if (!Object.keys(state.errors).length) setSyncStatus("");
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        state.realtimeReady = false;
        console.error("Student dashboard Realtime subscription is unavailable.", error || status);
        setSyncStatus("Live updates unavailable; checking periodically.", true);
      }
    });
  }

  async function openMaterial(materialId, action, button) {
    const helper = window.SmartLearningDownloads;
    if (action !== "download") {
      window.location.assign(`st_notes.html?material_id=${encodeURIComponent(materialId)}`);
      return;
    }
    if (!helper?.downloadMaterial) {
      setSyncStatus("Material download is unavailable because the download service did not load.", true);
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing…";
    }
    try {
      const material = state.materials.find((row) => String(row.id) === String(materialId));
      if (!material) throw new Error("This material is no longer available.");
      await helper.downloadMaterial(material);
    } catch (error) {
      console.error("Student dashboard could not open material.", error);
      setSyncStatus(`Material could not be downloaded: ${displayError(error)}`, true);
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Download";
      }
    }
  }

  async function joinClass(classId, button) {
    if (!state.client) return;
    button.disabled = true;
    button.textContent = "Checking…";
    const newTab = window.open("about:blank", "_blank");
    if (newTab) newTab.opener = null;
    try {
      const { data, error } = await state.client.rpc("get_student_live_class_join_url", {
        requested_class_id: classId,
      });
      if (error) throw error;
      const url = Array.isArray(data) ? data[0] : data;
      if (typeof url !== "string" || !/^https:\/\/[^\s]+$/i.test(url)) {
        throw new Error("The class did not provide a valid secure meeting link.");
      }
      if (newTab) newTab.location.replace(url);
      else window.location.assign(url);
    } catch (error) {
      if (newTab) newTab.close();
      console.error("Student dashboard could not join the class.", error);
      setSyncStatus(`Class could not be joined: ${displayError(error)}`, true);
      button.disabled = false;
      button.textContent = "Join Class";
    }
  }

  function handleDashboardClick(event) {
    const materialButton = event.target.closest("[data-material-open]");
    if (materialButton) {
      void openMaterial(
        materialButton.dataset.materialOpen,
        materialButton.dataset.materialAction,
        materialButton,
      );
      return;
    }
    const joinButton = event.target.closest("[data-class-join]");
    if (joinButton) void joinClass(joinButton.dataset.classJoin, joinButton);
  }

  function clearStudentData() {
    stopRealtime();
    state.identitySequence += 1;
    state.user = null;
    state.student = null;
    state.subjects = [];
    state.materials = [];
    state.materialCount = null;
    state.classes = [];
    state.quizCount = null;
    state.sessions = [];
    state.segments = [];
    state.studyLoading = false;
    state.rankXp = null;
    state.errors = {};
    state.loadSequence += 1;
    $("dashboardSubjectCount").textContent = "—";
    $("dashboardLiveClassCount").textContent = "—";
    $("dashboardQuizCount").textContent = "—";
    $("dashboardMaterialCount").textContent = "—";
    $("dashboardStudyTime").textContent = "—";
    $("registeredSubjectsList").innerHTML = '<div class="dashboard-empty">Sign in to view your subjects.</div>';
    $("recentMaterialsList").innerHTML = '<div class="dashboard-empty">Sign in to view your materials.</div>';
    $("todayClassesList").innerHTML = '<div class="dashboard-empty">Sign in to view your classes.</div>';
    $("studentRankTitle").textContent = "Your XP Rank";
    $("studentRankSubtitle").textContent = "Sign in to view your current rank.";
    $("studentRankIcon").dataset.levelColor = "green";
    $("studentRankIcon").innerHTML = '<i class="fa-solid fa-seedling" aria-hidden="true"></i>';
    $("studentRankLevel").textContent = "Level —";
    $("studentRankProgressLabel").textContent = "—";
    $("studentRankProgressPercent").textContent = "—";
    $("studentRankProgressFill").style.width = "0%";
    $("studentRankXpBadge").textContent = "— XP";
    $("studentRankRemaining").textContent = "";
    $("studentRankSince").textContent = "—";
    $("studentRankStatus").textContent = "—";
    setSyncStatus("Sign in to load your dashboard.", true);
  }

  async function startForCurrentUser() {
    if (!window.SmartLearningSupabase?.isConfigured?.()) {
      throw new Error("Supabase is not configured for this application.");
    }
    state.client = window.SmartLearningSupabase.getClient();
    if (!state.client) throw new Error("Supabase could not be initialized.");
    const { data, error } = await state.client.auth.getUser();
    if (error) throw error;
    if (!data?.user?.id) {
      clearStudentData();
      return;
    }
    if (state.user?.id && state.user.id !== data.user.id) clearStudentData();
    await loadStudent(data.user);
    startRealtime();
  }

  function showInitializationError(error) {
    console.error("Student dashboard could not be initialized.", error);
    setSyncStatus(`Dashboard could not be loaded: ${displayError(error)}`, true);
    const message = `<div class="dashboard-error">${escapeHtml(displayError(error))}</div>`;
    $("registeredSubjectsList").innerHTML = message;
    $("recentMaterialsList").innerHTML = message;
    $("todayClassesList").innerHTML = message;
    $("studentRankSubtitle").textContent = `Rank could not be loaded: ${displayError(error)}`;
    $("studentRankLevel").textContent = "Level —";
    $("studentRankProgressLabel").textContent = "Progress unavailable";
    $("studentRankProgressPercent").textContent = "—";
    $("studentRankProgressFill").style.width = "0%";
    $("studentRankXpBadge").textContent = "— XP";
    $("studentRankRemaining").textContent = "";
  }

  function init() {
    if (state.started) return;
    state.started = true;
    $("dashboard-redesign")?.addEventListener("click", handleDashboardClick);
    void startForCurrentUser().catch(showInitializationError);
    state.fallback = window.setInterval(() => {
      if (state.user) void refreshDashboard();
    }, FALLBACK_REFRESH_MS);
    state.clock = window.setInterval(() => renderAll(new Date()), 15_000);
    const { data: authData } = state.client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const nextUserId = session?.user?.id || null;
      if (nextUserId === state.user?.id) return;
      clearStudentData();
      if (session?.user) {
        void loadStudent(session.user)
          .then(startRealtime)
          .catch(showInitializationError);
      }
    });
    state.authSubscription = authData?.subscription || null;
    window.addEventListener("pagehide", () => {
      stopRealtime();
      state.authSubscription?.unsubscribe();
      state.authSubscription = null;
      if (state.fallback) window.clearInterval(state.fallback);
      if (state.clock) window.clearInterval(state.clock);
      if (state.debounce) window.clearTimeout(state.debounce);
    }, { once: true });
  }

  window.viewAllSubjects = () => window.location.assign("st_subjects.html");
  window.action = (name) => {
    const destinations = {
      subjects: "st_subjects.html",
      materials: "st_notes.html",
      quizzes: "st_quizzes.html",
      calendar: "st_live_classes.html",
      "live-classes": "st_live_classes.html",
      "study-time": "st_study_time.html",
    };
    if (destinations[name]) window.location.assign(destinations[name]);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
