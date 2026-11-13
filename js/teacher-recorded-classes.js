(() => {
  "use strict";

  const completedStatuses = new Set(["completed", "attended", "done", "finished"]);
  const cancelledStatuses = new Set(["cancelled", "canceled"]);
  const state = {
    client: null,
    teacher: null,
    classes: [],
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

  function classStart(item) {
    const value = item.start_at ||
      (item.class_date && item.start_time ? `${item.class_date}T${item.start_time}` : "");
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  }

  function classEnd(item, start) {
    if (item.end_at) {
      const end = new Date(item.end_at);
      if (Number.isFinite(end.getTime())) return end;
    }
    if (start) {
      const minutes = Number(item.duration_minutes);
      return new Date(start.getTime() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000);
    }
    return null;
  }

  function isEligibleClass(item) {
    const status = String(item.status || "").trim().toLowerCase();
    if (cancelledStatuses.has(status) || item.publication_status === "draft") return false;
    const start = classStart(item);
    if (!start || start.getTime() > Date.now()) return false;
    const completed = completedStatuses.has(status);
    const ended = classEnd(item, start)?.getTime() <= Date.now();
    const platform = String(item.meeting_platform || "").toLowerCase();
    return (completed || ended) && (platform.includes("zoom") || platform.includes("google") || platform.includes("meet"));
  }

  function formatDate(value) {
    if (!value) return "Not provided";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Not provided";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
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
        ? "Select a class to review its details before uploading."
        : "There are no eligible completed classes available for upload.";
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
    );
  }

  function renderClasses() {
    elements.classSelect.replaceChildren();
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = state.classes.length ? "Choose a completed live class" : "No eligible classes";
    elements.classSelect.appendChild(prompt);
    state.classes.forEach((item) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      const grade = item.grade || item.class_grade || "Grade not provided";
      const date = classStart(item);
      option.textContent = `${item.title || subjectName(item)} · Grade ${grade} · ${subjectName(item)} · ${date ? formatDate(date) : "Date not provided"}`;
      elements.classSelect.appendChild(option);
    });
    elements.classSelect.disabled = state.classes.length === 0;
    elements.classStatus.textContent = state.classes.length
      ? `${state.classes.length} eligible class${state.classes.length === 1 ? "" : "es"}`
      : "Completed classes using Zoom or Google Meet will appear here.";
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
      detailItem("Subject", liveClass ? subjectName(liveClass) : recording.subject_id || "Not provided"),
      detailItem("Chapter", recording.chapter),
      detailItem("Topic", recording.topic),
      detailItem("Duration", formatDuration(recording.duration_seconds)),
      detailItem("Class date", formatDate(liveClass?.start_at || recording.started_at)),
      detailItem("Uploaded", formatDate(recording.created_at || recording.ready_at)),
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
        .select("id, live_class_id, teacher_id, title, subject_id, chapter, topic, recording_status, recording_verified_at, started_at, duration_seconds, ready_at, created_at")
        .eq("teacher_id", state.teacher.id)
        .eq("recording_status", "available")
        .not("recording_verified_at", "is", null)
        .not("storage_path", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      state.recordingsError = "";
      state.recordings = (data || []).filter((row) =>
        String(row.teacher_id) === String(state.teacher.id) &&
        row.recording_status === "available" &&
        Boolean(row.recording_verified_at)
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
      if (!teacherContext) return;
      state.client = teacherContext.client;
      state.teacher = teacherContext.profile;
      await loadClasses();
      await loadRecordings();
    } catch (error) {
      console.error("Could not initialize the teacher recorded-classes page.", error);
      elements.classStatus.textContent = "Your teacher account or classes could not be loaded. Please retry.";
      elements.classSelect.replaceChildren(new Option("Unable to load classes", ""));
      elements.classSelect.disabled = true;
      elements.recordingState.className = "recorded-library-state is-error";
      elements.recordingState.textContent = error?.message || "The page could not be initialized.";
    }
  }

  async function loadClasses() {
    try {
      const liveClasses = await window.LiveClassService.load();
      state.liveClassesById = new Map((liveClasses || []).map((item) => [String(item.id), item]));
      state.classes = (liveClasses || []).filter(isEligibleClass);
      renderClasses();
    } catch (error) {
      console.error("Could not load the teacher's eligible live classes.", error);
      state.classes = [];
      renderClasses();
      elements.classStatus.textContent = error?.message || "Eligible live classes could not be loaded. Please retry.";
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
