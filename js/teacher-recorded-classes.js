(() => {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const state = {
    client: null,
    teacher: null,
    recordings: [],
    liveClassesById: new Map(),
    loading: false,
    error: "",
    manageRecording: null,
  };
  const elements = {
    refresh: document.getElementById("refreshRecordings"),
    search: document.getElementById("recordingSearch"),
    recordingState: document.getElementById("recordingsState"),
    grid: document.getElementById("teacherRecordingGrid"),
    previewDialog: document.getElementById("recordingPreviewDialog"),
    previewTitle: document.getElementById("previewTitle"),
    previewStatus: document.getElementById("previewStatus"),
    previewPlayer: document.getElementById("recordingPreviewPlayer"),
    descriptionDialog: document.getElementById("recordingDescriptionDialog"),
    descriptionForm: document.getElementById("recordingDescriptionForm"),
    descriptionEditor: document.getElementById("recordingDescriptionEditor"),
    manageStatus: document.getElementById("recordingManageStatus"),
    saveDescription: document.getElementById("saveRecordingDescription"),
  };

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
    if (value === null || value === undefined || value === "") return "Not provided";
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return "Not provided";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${remaining}s`;
    return `${remaining}s`;
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

  function platformName(value) {
    const platform = String(value || "").trim().toLowerCase();
    if (platform.includes("zoom")) return "Zoom";
    if (platform.includes("google") || platform.includes("meet")) return "Google Meet";
    return platform.includes("manual") ? "Legacy manual upload" : "Not provided";
  }

  function subjectName(liveClass) {
    return String(liveClass?.subject || liveClass?.subject_id || "Not provided");
  }

  function hasValidPrivateStoragePath(recording) {
    const path = String(recording.storage_path || "");
    const prefix = recording.live_class_id
      ? `manual/${recording.teacher_id}/${recording.live_class_id}/`
      : `manual/${recording.teacher_id}/subject-based/`;
    const file = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    if (recording.live_class_id) {
      return new RegExp(
        "^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\\.(?:mp4|webm|mov)$",
        "i",
      ).test(file);
    }
    return new RegExp(
      `^${String(recording.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(?:mp4|webm|mov)$`,
      "i",
    ).test(file);
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

  function createAction(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function makeRecordingCard(recording) {
    const liveClass = state.liveClassesById.get(String(recording.live_class_id));
    const canPreview = recording.recording_status === "available" &&
      Boolean(recording.recording_verified_at) &&
      hasValidPrivateStoragePath(recording);
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
    title.textContent = liveClass?.title || "Class details unavailable";
    const className = document.createElement("p");
    className.className = "teacher-recording-class-name";
    className.textContent = liveClass
      ? "Live class recording"
      : recording.live_class_id ? "Associated live-class details are unavailable" : "Legacy recording without a live class";
    titleWrap.append(title, className);
    const status = document.createElement("span");
    status.className = "recording-status-badge";
    status.dataset.status = recording.recording_status || "unavailable";
    status.textContent = String(recording.recording_status || "unavailable")
      .replace(/^\w/, (character) => character.toUpperCase());
    header.append(icon, titleWrap, status);

    const meta = document.createElement("div");
    meta.className = "teacher-recording-meta";
    meta.append(
      detailItem(
        "Grade and stream",
        liveClass
          ? `Grade ${liveClass.grade || liveClass.class_grade || "Not provided"}${liveClass.stream ? ` · ${streamName(liveClass.stream)}` : ""}`
          : "Grade and stream unavailable",
      ),
      detailItem("Subject", subjectName(liveClass)),
      detailItem("Chapter", liveClass?.chapter),
      detailItem("Topic", liveClass?.topic),
      detailItem("Platform", platformName(liveClass?.meeting_platform)),
      detailItem("Class date", liveClass?.start_at || liveClass?.class_date
        ? formatDate(liveClass.start_at || liveClass.class_date)
        : "Not provided"),
      detailItem("Duration", formatDuration(recording.duration_seconds)),
      detailItem("Recording upload date", formatDate(recording.ready_at || recording.created_at)),
    );

    const actions = document.createElement("div");
    actions.className = "teacher-recording-card-actions";
    const preview = canPreview
      ? createAction(
        "Preview recording",
        "recording-preview-button",
        () => void openPreview(String(recording.id)),
      )
      : null;
    if (preview) {
      preview.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Preview recording';
    }
    const edit = createAction(
      "Edit description",
      "recording-manage-button",
      () => openDescriptionEditor(recording),
    );
    const remove = createAction(
      "Delete",
      "recording-manage-button recording-delete-button",
      () => void deleteRecording(recording),
    );
    if (preview) actions.appendChild(preview);
    actions.append(edit, remove);
    card.append(header, meta);
    const description = document.createElement("p");
    description.className = "teacher-recording-description";
    description.textContent = recording.description || "No recording description has been provided.";
    card.appendChild(description);
    card.appendChild(actions);
    return card;
  }

  function renderRecordings() {
    if (state.error) {
      elements.grid.replaceChildren();
      elements.grid.setAttribute("aria-busy", "false");
      elements.recordingState.hidden = false;
      elements.recordingState.className = "recorded-library-state is-error";
      elements.recordingState.textContent = state.error;
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
        recording.description,
        liveClass?.title,
        liveClass?.chapter,
        liveClass?.topic,
        subjectName(liveClass),
      ].join(" ").toLocaleLowerCase();
      return content.includes(query);
    });
    elements.grid.replaceChildren(...filtered.map(makeRecordingCard));
    elements.grid.setAttribute("aria-busy", state.loading ? "true" : "false");
    elements.recordingState.className = "recorded-library-state";
    if (state.loading) {
      elements.recordingState.hidden = false;
      elements.recordingState.textContent = "Loading your recordings…";
    } else if (state.recordings.length === 0) {
      elements.recordingState.hidden = false;
      elements.recordingState.textContent = "No verified recordings have been uploaded yet. Upload one from Live Classes after the class ends.";
    } else if (filtered.length === 0) {
      elements.recordingState.hidden = false;
      elements.recordingState.textContent = "No recordings match your search.";
    } else {
      elements.recordingState.hidden = true;
      elements.recordingState.textContent = "";
    }
  }

  async function loadRecordings() {
    state.error = "";
    state.loading = true;
    elements.refresh.disabled = true;
    renderRecordings();
    try {
      const { data, error } = await state.client
        .from("recorded_classes")
        .select("id, live_class_id, teacher_id, description, thumbnail_url, resource_urls, recording_status, recording_verified_at, storage_path, duration_seconds, ready_at, created_at")
        .eq("teacher_id", state.teacher.id)
        .order("ready_at", { ascending: false });
      if (error) throw error;

      state.recordings = (data || []).filter((row) =>
        String(row.teacher_id) === String(state.teacher.id)
      );
      state.liveClassesById = new Map();
      const liveClassIds = [...new Set(
        state.recordings.map((recording) => recording.live_class_id).filter(Boolean).map(String),
      )];
      if (liveClassIds.length) {
        const { data: liveClasses, error: liveClassError } = await state.client
          .from("live_classes")
          .select("id, teacher_id, title, grade, class_grade, stream, subject_id, subject, chapter, topic, class_date, start_time, start_at, end_at, duration_minutes, meeting_platform")
          .eq("teacher_id", state.teacher.id)
          .in("id", liveClassIds);
        if (liveClassError) throw liveClassError;
        state.liveClassesById = new Map(
          (liveClasses || []).map((liveClass) => [String(liveClass.id), liveClass]),
        );
      }
    } catch (error) {
      console.error("Could not load the current teacher's recordings.", error);
      state.error = error?.message || "Your recordings could not be loaded.";
      state.recordings = [];
      state.liveClassesById = new Map();
    } finally {
      state.loading = false;
      elements.refresh.disabled = false;
      renderRecordings();
    }
  }

  async function invokeManagement(body) {
    const { data, error } = await state.client.functions.invoke("manage-recorded-class", { body });
    if (error) {
      let message = error.message || "The recording management service returned an error.";
      try {
        const response = await error.context?.json?.();
        if (response?.error) message = response.error;
      } catch {
        // Keep the function error when its response body is unavailable.
      }
      throw new Error(message);
    }
    if (!data || data.success === false) {
      throw new Error(data?.error || "The recording management service returned an invalid response.");
    }
    return data;
  }

  function openDescriptionEditor(recording) {
    state.manageRecording = recording;
    elements.descriptionEditor.value = recording.description || "";
    elements.manageStatus.textContent = "";
    elements.saveDescription.disabled = false;
    elements.descriptionDialog.showModal();
  }

  async function saveDescription(event) {
    event.preventDefault();
    const recording = state.manageRecording;
    if (!recording || elements.saveDescription.disabled) return;
    elements.saveDescription.disabled = true;
    elements.manageStatus.textContent = "Saving description…";
    try {
      await invokeManagement({
        action: "update_description",
        recording_id: recording.id,
        description: elements.descriptionEditor.value,
      });
      elements.descriptionDialog.close();
      await loadRecordings();
    } catch (error) {
      console.error("Could not update the recording description.", error);
      elements.manageStatus.textContent = error?.message || "The description could not be saved.";
    } finally {
      elements.saveDescription.disabled = false;
    }
  }

  async function deleteRecording(recording) {
    const title = state.liveClassesById.get(String(recording.live_class_id))?.title || "this recording";
    if (!window.confirm(`Delete "${title}"? Students will no longer be able to play it.`)) return;
    try {
      await invokeManagement({
        action: "delete",
        recording_id: recording.id,
      });
      await loadRecordings();
    } catch (error) {
      console.error("Could not delete the teacher's recording.", error);
      window.alert(error?.message || "The recording could not be deleted.");
    }
  }

  async function openPreview(recordingId) {
    const recording = state.recordings.find((item) => String(item.id) === recordingId);
    if (!recording) return;
    const liveClass = state.liveClassesById.get(String(recording.live_class_id));
    if (recording.recording_status !== "available" ||
      !recording.recording_verified_at ||
      !hasValidPrivateStoragePath(recording)) {
      elements.previewStatus.className = "preview-status is-error";
      elements.previewStatus.textContent = "This recording is not verified and available for playback.";
      if (!elements.previewDialog.open) elements.previewDialog.showModal();
      return;
    }
    elements.previewTitle.textContent = liveClass?.title || "Recording preview";
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
      const playback = new URL(data.playback_url);
      const project = new URL(window.SmartLearningSupabase.SUPABASE_URL);
      if (playback.protocol !== "https:" || playback.origin !== project.origin ||
        !playback.pathname.includes("/storage/v1/object/sign/recorded-class-videos/")) {
        throw new Error("The playback service returned an invalid private video link.");
      }
      elements.previewPlayer.src = playback.href;
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
        state.error = "Unable to verify your teacher account. Please sign in again.";
        renderRecordings();
        return;
      }
      state.client = teacherContext.client;
      state.teacher = teacherContext.profile;
      console.info("Teacher recording library authenticated.", {
        userId: teacherContext.user?.id || null,
        teacherId: state.teacher?.id || null,
      });
      await loadRecordings();
    } catch (error) {
      console.error("Could not initialize the teacher recording library.", error);
      state.error = error?.message || "The page could not be initialized.";
      renderRecordings();
    }
  }

  elements.refresh.addEventListener("click", () => void loadRecordings());
  elements.search.addEventListener("input", renderRecordings);
  elements.descriptionForm.addEventListener("submit", (event) => void saveDescription(event));
  document.getElementById("cancelRecordingDescription").addEventListener("click", () => {
    elements.descriptionDialog.close();
  });
  elements.descriptionDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    elements.descriptionDialog.close();
  });
  document.getElementById("closeRecordingPreview").addEventListener("click", closePreview);
  elements.previewDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
  elements.previewDialog.addEventListener("click", (event) => {
    if (event.target === elements.previewDialog) closePreview();
  });
  window.addEventListener("smart-learning-live-classes-updated", () => void loadRecordings());
  document.addEventListener("DOMContentLoaded", () => void initialize());
})();
