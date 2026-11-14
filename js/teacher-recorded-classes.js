(() => {
  "use strict";

  const cancelledStatuses = new Set(["cancelled", "canceled"]);
  const state = {
    client: null,
    teacher: null,
    classes: [],
    registeredClassGroups: [],
    classesByScope: new Map(),
    liveClassCount: 0,
    classLoadState: "loading",
    classLoadError: "",
    scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    recordings: [],
    liveClassesById: new Map(),
    loadingRecordings: false,
    recordingsError: "",
  };
  const elements = {
    classSelect: document.getElementById("completedClassSelect"),
    classDetails: document.getElementById("selectedClassDetails"),
    classStatus: document.getElementById("eligibleClassStatus"),
    uploadButton: document.getElementById("openRecordingUpload"),
    refresh: document.getElementById("refreshRecordings"),
    search: document.getElementById("recordingSearch"),
    recordingState: document.getElementById("recordingsState"),
    grid: document.getElementById("teacherRecordingGrid"),
    previewDialog: document.getElementById("recordingPreviewDialog"),
    previewTitle: document.getElementById("previewTitle"),
    previewStatus: document.getElementById("previewStatus"),
    previewPlayer: document.getElementById("recordingPreviewPlayer"),
  };

  function subjectName(item) {
    const relation = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
    return String(relation?.name || item.subject_name || item.subject || "Not provided");
  }

  function streamName(value) {
    const labels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const key = String(value || "").trim().toLowerCase();
    return labels[key] || key.replaceAll("_", " ") || "Not provided";
  }

  function normalizeStream(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function scopeKey(grade, stream, subjectId) {
    const normalizedGrade = Number(grade);
    const normalizedStream = normalizedGrade >= 11 ? normalizeStream(stream) : "";
    return `${normalizedGrade}|${normalizedStream}|${String(subjectId ?? "")}`;
  }

  function classGrade(item) {
    const grade = Number(item.grade ?? String(item.class_grade || "").replace(/\D/g, ""));
    return Number.isInteger(grade) ? grade : null;
  }

  function parseScheduledDateTime(dateValue, timeValue, timezone) {
    const dateMatch = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(timeValue || "").match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/);
    if (!dateMatch || !timeMatch) return null;

    const [, yearText, monthText, dayText] = dateMatch;
    const [, hourText, minuteText, secondText = "0", fractionText = ""] = timeMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const milliseconds = Number(`0.${fractionText || "0"}`) * 1000;
    const target = Date.UTC(
      year,
      month - 1,
      day,
      Number(hourText),
      Number(minuteText),
      Number(secondText),
      milliseconds,
    );
    if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== `${yearText}-${monthText}-${dayText}`) {
      return null;
    }

    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      return null;
    }

    let timestamp = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(timestamp)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      );
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
        milliseconds,
      );
      const difference = represented - target;
      if (difference === 0) return new Date(timestamp);
      timestamp -= difference;
    }
    return null;
  }

  function classStart(item) {
    if (item.start_at) {
      const start = new Date(item.start_at);
      return Number.isFinite(start.getTime())
        ? start
        : null;
    }
    return parseScheduledDateTime(item.class_date, item.start_time, state.scheduleTimezone);
  }

  function classEnd(item, start) {
    if (item.end_at) {
      const end = new Date(item.end_at);
      if (Number.isFinite(end.getTime())) return end;
      return null;
    }
    if (start && item.duration_minutes !== null && item.duration_minutes !== undefined) {
      const minutes = Number(item.duration_minutes);
      if (Number.isFinite(minutes) && minutes > 0) {
        return new Date(start.getTime() + minutes * 60_000);
      }
    }
    return null;
  }

  function isEligibleClass(item) {
    const status = String(item.status || "").trim().toLowerCase();
    if (cancelledStatuses.has(status)) return false;
    const start = classStart(item);
    const end = classEnd(item, start);
    const now = Date.now();
    const platform = String(item.meeting_platform || "").toLowerCase();
    return Boolean(
      start &&
      end &&
      start.getTime() <= now &&
      end.getTime() >= start.getTime() &&
      end.getTime() <= now &&
      (platform.includes("zoom") || platform.includes("google") || platform.includes("meet"))
    );
  }

  async function loadScheduleTimezone() {
    const { data, error } = await state.client
      .from("teacher_settings")
      .select("timezone")
      .eq("teacher_id", state.teacher.id)
      .maybeSingle();
    if (error) {
      if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) {
        console.warn("Teacher schedule timezone is unavailable; using the live-class service default.", error);
        return "Asia/Kolkata";
      }
      throw error;
    }
    const timezone = String(data?.timezone || "Asia/Kolkata");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
      return timezone;
    } catch {
      throw new Error("The teacher's saved timezone is invalid. Update it in Settings before uploading a recording.");
    }
  }

  function formatDate(value, timezone = state.scheduleTimezone) {
    if (!value) return "Not provided";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Not provided";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: timezone,
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return "Not provided";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Not provided";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: state.scheduleTimezone,
    }).format(date);
  }

  function formatDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return "Not provided";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${remaining}s`;
    return `${remaining}s`;
  }

  function selectedClass() {
    return state.classes.find((item) => String(item.id) === elements.classSelect.value) || null;
  }

  function detailItem(label, value) {
    const wrapper = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value || "Not provided";
    wrapper.append(name, content);
    return wrapper;
  }

  function renderSelectedClass() {
    const item = selectedClass();
    elements.classDetails.replaceChildren();
    elements.uploadButton.disabled = !item;
    if (!item) {
      const message = document.createElement("p");
      message.textContent = state.classes.length
        ? "Select a completed session under one of your registered classes."
        : state.classLoadState === "loading"
          ? "Loading classes…"
          : state.classLoadError
            ? "Unable to load classes. Please refresh or try again."
            : state.registeredClassGroups.length === 0
              ? "No registered classes found."
              : "Your registered classes are listed above. A completed live session is required before you can upload a recording.";
      elements.classDetails.appendChild(message);
      return;
    }
    const date = classStart(item);
    elements.classDetails.append(
      detailItem("Class title", item.title || "Live class"),
      detailItem("Grade", item.grade || item.class_grade || "Not provided"),
      detailItem("Stream", streamName(item.stream)),
      detailItem("Subject", subjectName(item)),
      detailItem("Chapter", item.chapter),
      detailItem("Topic", item.topic),
      detailItem("Class date", date ? formatDate(date) : item.class_date || "Not provided"),
      detailItem("Start time", date ? formatTime(date) : item.start_time || "Not provided"),
      detailItem("Duration", item.duration_minutes ? `${item.duration_minutes} minutes` : "Not provided"),
      detailItem("Meeting platform", platformName(item.meeting_platform) || "Not provided"),
      detailItem(
        "Student availability",
        String(item.publication_status || "").toLowerCase() === "published"
          ? "Available to authorized students after upload verification"
          : "This session must be published before students can view its recording",
      ),
    );
  }

  function platformName(value) {
    const platform = String(value || "").trim().toLowerCase();
    if (platform.includes("zoom")) return "Zoom";
    if (platform.includes("google") || platform.includes("meet")) return "Google Meet";
    return "Not provided";
  }

  function renderClasses() {
    elements.classSelect.replaceChildren();
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = state.classes.length
      ? "Choose a registered class session"
      : state.classLoadState === "loading"
        ? "Loading your registered classes…"
        : state.classLoadError
          ? "Unable to load classes. Please refresh or try again."
          : state.registeredClassGroups.length === 0
            ? "No registered classes found."
            : "Registered classes (no completed sessions available)";
    elements.classSelect.appendChild(prompt);
    state.registeredClassGroups.forEach((group) => {
      const groupLabel = `Class ${group.grade}${group.stream ? ` · ${streamName(group.stream)}` : ""}`;
      if (!group.subjects.length) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = groupLabel;
        const option = document.createElement("option");
        option.disabled = true;
        option.textContent = "No registered subjects";
        optgroup.appendChild(option);
        elements.classSelect.appendChild(optgroup);
        return;
      }

      group.subjects.forEach((subject) => {
        const optgroup = document.createElement("optgroup");
        optgroup.label = `${groupLabel} · ${subject.name}`;
        const matchingClasses = state.classesByScope.get(
          scopeKey(group.grade, group.stream, subject.id),
        ) || [];
        if (!matchingClasses.length) {
          const option = document.createElement("option");
          option.disabled = true;
          option.textContent = "No completed live session available";
          optgroup.appendChild(option);
        } else {
          matchingClasses.forEach((item) => {
            const option = document.createElement("option");
            option.value = String(item.id);
            const date = classStart(item);
            option.textContent = `${item.title || subjectName(item)} · ${platformName(item.meeting_platform)} · ${date ? formatDate(date) : "Date not provided"}`;
            optgroup.appendChild(option);
          });
        }
        elements.classSelect.appendChild(optgroup);
      });
    });
    elements.classSelect.disabled =
      state.classLoadState === "loading" || state.classLoadState === "error";
    elements.classStatus.textContent = state.classLoadState === "loading"
      ? "Loading your registered classes…"
      : state.classLoadError
        ? "Unable to load classes. Please refresh or try again."
        : state.registeredClassGroups.length === 0
          ? "No registered classes found."
          : state.classes.length === 0
            ? `${state.registeredClassGroups.length} registered class${state.registeredClassGroups.length === 1 ? "" : "es"} found. A completed live session is required before recording.`
            : `${state.registeredClassGroups.length} registered classes · ${state.classes.length} completed session${state.classes.length === 1 ? "" : "s"} eligible for upload`;
    renderSelectedClass();
  }

  function makeRecordingCard(recording) {
    const liveClass = state.liveClassesById.get(String(recording.live_class_id));
    const card = document.createElement("article");
    card.className = "teacher-recording-card";

    const header = document.createElement("div");
    header.className = "teacher-recording-card-header";
    const icon = document.createElement("span");
    icon.className = "teacher-recording-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<i class="fa-solid fa-circle-play"></i>';
    const titleWrap = document.createElement("div");
    titleWrap.className = "teacher-recording-card-title";
    const title = document.createElement("h3");
    title.textContent = recording.title || "Recording";
    const className = document.createElement("p");
    className.className = "teacher-recording-class-name";
    className.textContent = liveClass?.title || "Live class";
    titleWrap.append(title, className);
    const status = document.createElement("span");
    status.className = "recording-status-badge";
    status.textContent = "Available";
    header.append(icon, titleWrap, status);

    const meta = document.createElement("div");
    meta.className = "teacher-recording-meta";
    meta.append(
      detailItem("Grade and stream", `Grade ${liveClass?.grade || liveClass?.class_grade || recording.grade || "Not provided"}${(liveClass?.stream || recording.stream) ? ` · ${streamName(liveClass?.stream || recording.stream)}` : ""}`),
      detailItem("Subject", liveClass ? subjectName(liveClass) : recording.subject_id || "Not provided"),
      detailItem("Chapter", recording.chapter),
      detailItem("Topic", recording.topic),
      detailItem("Platform", platformName(liveClass?.meeting_platform || recording.provider)),
      detailItem("Duration", formatDuration(recording.duration_seconds)),
      detailItem("Class date", formatDate(liveClass ? classStart(liveClass) : recording.started_at)),
      detailItem("Verified", formatDate(recording.recording_verified_at)),
      detailItem("Uploaded", formatDate(recording.ready_at || recording.recording_verified_at)),
    );
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "recording-preview-button";
    preview.dataset.recordingId = String(recording.id);
    preview.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Preview recording';
    card.append(header, meta, preview);
    return card;
  }

  function renderRecordings() {
    if (state.recordingsError) {
      elements.grid.replaceChildren();
      elements.grid.setAttribute("aria-busy", "false");
      elements.recordingState.hidden = false;
      elements.recordingState.className = "recorded-library-state is-error";
      elements.recordingState.replaceChildren(
        document.createTextNode(state.recordingsError),
      );
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => void loadRecordings());
      elements.recordingState.appendChild(retry);
      return;
    }
    const query = elements.search.value.trim().toLocaleLowerCase();
    const filtered = state.recordings.filter((recording) => {
      const liveClass = state.liveClassesById.get(String(recording.live_class_id));
      const content = [
        recording.title,
        recording.chapter,
        recording.topic,
        liveClass?.title,
        liveClass ? subjectName(liveClass) : "",
      ].join(" ").toLocaleLowerCase();
      return content.includes(query);
    });
    elements.grid.replaceChildren(...filtered.map(makeRecordingCard));
    elements.grid.setAttribute("aria-busy", state.loadingRecordings ? "true" : "false");
    if (state.loadingRecordings) {
      elements.recordingState.hidden = false;
      elements.recordingState.className = "recorded-library-state";
      elements.recordingState.textContent = "Loading your recordings…";
    } else if (state.recordings.length === 0) {
      elements.recordingState.hidden = false;
      elements.recordingState.className = "recorded-library-state";
      elements.recordingState.textContent = "No verified recordings have been uploaded yet.";
    } else if (filtered.length === 0) {
      elements.recordingState.hidden = false;
      elements.recordingState.className = "recorded-library-state";
      elements.recordingState.textContent = "No recordings match your search.";
    } else {
      elements.recordingState.hidden = true;
      elements.recordingState.textContent = "";
    }
  }

  async function loadRecordings() {
    state.recordingsError = "";
    state.loadingRecordings = true;
    renderRecordings();
    elements.refresh.disabled = true;
    try {
      const { data, error } = await state.client
        .from("recorded_classes")
        .select("id, live_class_id, teacher_id, title, grade, stream, subject_id, chapter, topic, provider, recording_status, recording_verified_at, storage_path, started_at, duration_seconds, ready_at")
        .eq("teacher_id", state.teacher.id)
        .eq("recording_status", "available")
        .not("recording_verified_at", "is", null)
        .not("storage_path", "is", null)
        .order("ready_at", { ascending: false });
      if (error) throw error;
      state.recordingsError = "";
      state.recordings = (data || []).filter((row) =>
        String(row.teacher_id) === String(state.teacher.id) &&
        row.recording_status === "available" &&
        Boolean(row.recording_verified_at) &&
        Boolean(row.storage_path)
      );
    } catch (error) {
      console.error("Could not load the current teacher's recordings.", error);
      state.recordingsError = error?.message || "Your recordings could not be loaded.";
    } finally {
      state.loadingRecordings = false;
      elements.refresh.disabled = false;
      renderRecordings();
    }
  }

  async function openPreview(recordingId) {
    const recording = state.recordings.find((item) => String(item.id) === recordingId);
    if (!recording) return;
    elements.previewTitle.textContent = recording.title || "Recording preview";
    elements.previewStatus.className = "preview-status";
    elements.previewStatus.textContent = "Requesting an authorized temporary playback link…";
    elements.previewPlayer.hidden = true;
    elements.previewPlayer.removeAttribute("src");
    if (!elements.previewDialog.open) elements.previewDialog.showModal();
    try {
      const { data, error } = await state.client.functions.invoke("recorded-class-playback", {
        body: { recording_id: recordingId },
      });
      if (error) throw error;
      if (!data || data.success === false || typeof data.playback_url !== "string") {
        throw new Error(data?.error || "The playback service did not return a temporary video link.");
      }
      const playbackUrl = new URL(data.playback_url);
      if (playbackUrl.protocol !== "https:") {
        throw new Error("The playback service returned an invalid secure video link.");
      }
      elements.previewPlayer.src = playbackUrl.href;
      elements.previewPlayer.hidden = false;
      elements.previewPlayer.load();
      elements.previewStatus.textContent = "";
    } catch (error) {
      console.error("Could not prepare the teacher's authorized recording preview.", error);
      elements.previewStatus.className = "preview-status is-error";
      elements.previewStatus.textContent = error?.message || "Playback could not be prepared. Please retry.";
    }
  }

  function closePreview() {
    elements.previewPlayer.pause();
    elements.previewPlayer.removeAttribute("src");
    elements.previewPlayer.load();
    elements.previewPlayer.hidden = true;
    elements.previewStatus.textContent = "";
    if (elements.previewDialog.open) elements.previewDialog.close();
  }

  async function initialize() {
    try {
      const teacherContext = await window.TeacherData.requireTeacher();
      if (!teacherContext) {
        state.classLoadState = "error";
        state.classLoadError = "Unable to load classes. Please refresh or try again.";
        renderClasses();
        return;
      }
      state.client = teacherContext.client;
      state.teacher = teacherContext.profile;
      console.info("Teacher recorded-classes page authenticated.", {
        userId: teacherContext.user?.id || null,
        teacherId: state.teacher?.id || null,
      });
      await loadClasses();
      await loadRecordings();
    } catch (error) {
      console.error("Could not initialize the teacher recorded-classes page.", error);
      state.classLoadState = "error";
      state.classLoadError = error?.message || "Unable to load classes. Please refresh or try again.";
      renderClasses();
      elements.recordingState.className = "recorded-library-state is-error";
      elements.recordingState.textContent = error?.message || "The page could not be initialized.";
    }
  }

  async function loadClasses() {
    state.classLoadState = "loading";
    state.classLoadError = "";
    renderClasses();
    try {
      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError) throw authError;
      const userId = authData?.user?.id;
      if (!userId) throw new Error("Your session has expired. Please sign in again.");
      console.info("Loading live classes for authenticated user.", { userId });

      const { data: teacher, error: teacherError } = await state.client
        .from("teachers")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (teacherError) throw teacherError;
      if (!teacher?.id || String(teacher.id) !== String(state.teacher.id)) {
        throw new Error("The authenticated teacher profile could not be verified.");
      }
      console.info("Resolved recorded-classes teacher identity.", { teacherId: teacher.id });

      const registeredGroups = await window.TeacherData.loadRegisteredTeachingScope(
        state.client,
        teacher.id,
      );
      state.registeredClassGroups = (registeredGroups || [])
        .map((group) => {
          const grade = Number(group.grade);
          return {
            grade,
            stream: grade >= 11 ? normalizeStream(group.stream) : "",
            subjects: (group.subjects || [])
              .filter((subject) => subject.id !== null && subject.id !== undefined)
              .map((subject) => ({
                id: subject.id,
                name: String(subject.name || subject.subject || "Subject"),
              })),
          };
        })
        .filter((group) => Number.isInteger(group.grade) && group.grade >= 5 && group.grade <= 12);
      console.info("Resolved the teacher's registered class scopes.", {
        registeredClassCount: state.registeredClassGroups.length,
      });

      const { data: liveClasses, error: classesError } = await state.client
        .from("live_classes")
        .select("id, teacher_id, title, class_grade, subject, grade, stream, subject_id, description, chapter, topic, class_date, start_time, end_time, start_at, end_at, duration_minutes, meeting_platform, status, publication_status")
        .eq("teacher_id", teacher.id)
        .order("class_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (classesError) throw classesError;
      state.liveClassCount = (liveClasses || []).length;
      state.liveClassesById = new Map((liveClasses || []).map((item) => [String(item.id), item]));
      if ((liveClasses || []).some((item) => !item.start_at && item.class_date && item.start_time)) {
        state.scheduleTimezone = await loadScheduleTimezone();
      }
      const registeredScopes = new Set();
      state.registeredClassGroups.forEach((group) => {
        group.subjects.forEach((subject) => {
          registeredScopes.add(scopeKey(group.grade, group.stream, subject.id));
        });
      });
      state.classesByScope = new Map();
      const eligibleClasses = (liveClasses || []).filter(isEligibleClass);
      state.classes = eligibleClasses.filter((item) => {
        const grade = classGrade(item);
        const key = scopeKey(grade, item.stream, item.subject_id);
        if (grade === null || !registeredScopes.has(key)) return false;
        if (!state.classesByScope.has(key)) state.classesByScope.set(key, []);
        state.classesByScope.get(key).push(item);
        return true;
      });
      state.classLoadState = "loaded";
      console.info("Teacher live classes loaded for recordings.", {
        registeredClassCount: state.registeredClassGroups.length,
        fetchedCount: state.liveClassCount,
        eligibleCompletedCount: eligibleClasses.length,
        registeredScopeSessionCount: state.classes.length,
      });
      renderClasses();
    } catch (error) {
      console.error("Could not load the teacher's live classes for recordings.", {
        userId: state.teacher?.user_id || null,
        teacherId: state.teacher?.id || null,
        error,
      });
      state.classLoadState = "error";
      state.classLoadError = error?.message || "Unable to load classes. Please refresh or try again.";
      state.liveClassCount = 0;
      state.classes = [];
      state.classesByScope = new Map();
      state.liveClassesById = new Map();
      renderClasses();
    }
  }

  elements.classSelect.addEventListener("change", renderSelectedClass);
  elements.uploadButton.addEventListener("click", () => {
    const item = selectedClass();
    if (item && window.TeacherRecordingUpload?.open) {
      window.TeacherRecordingUpload.open(item);
    }
  });
  elements.refresh.addEventListener("click", async () => {
    await loadClasses();
    await loadRecordings();
  });
  elements.search.addEventListener("input", renderRecordings);
  elements.grid.addEventListener("click", (event) => {
    const button = event.target.closest(".recording-preview-button");
    if (button) void openPreview(button.dataset.recordingId);
  });
  document.getElementById("closeRecordingPreview").addEventListener("click", closePreview);
  elements.previewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
  elements.previewDialog.addEventListener("click", (event) => {
    if (event.target === elements.previewDialog) closePreview();
  });
  window.addEventListener("smart-learning-live-classes-updated", () => {
    void loadRecordings();
  });
  document.addEventListener("DOMContentLoaded", () => void initialize());
})();
