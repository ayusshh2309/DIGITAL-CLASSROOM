(() => {
  "use strict";

  const state = {
    client: null,
    student: null,
    subjects: [],
    recordings: [],
    watchProgress: new Map(),
    completed: new Set(),
    loading: false,
    playbackRequest: 0,
  };
  const $ = (id) => document.getElementById(id);

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character]);
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function safeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "—";
    const total = Number(seconds);
    if (!Number.isFinite(total) || total < 0) return "—";
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = Math.floor(total % 60);
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
      : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date not provided";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Time not provided";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function subjectIcon(subject) {
    const value = normalize(subject);
    if (value.includes("physics")) return "fa-atom";
    if (value.includes("chem")) return "fa-flask";
    if (value.includes("math")) return "fa-calculator";
    if (value.includes("biology")) return "fa-dna";
    if (value.includes("english") || value.includes("language")) return "fa-book-open";
    if (value.includes("computer") || value.includes("informatics")) return "fa-laptop-code";
    return "fa-book";
  }

  function statusLabel(status) {
    return {
      available: "Available",
      processing: "Processing",
      failed: "Failed",
      unavailable: "Unavailable",
    }[status] || "Unavailable";
  }

  function statusMessage(status) {
    return {
      processing: "Your class recording is being prepared. Check back soon.",
      failed: "This recording could not be processed. Please contact your teacher.",
      unavailable: "This recording is not currently available.",
    }[status] || "";
  }

  function readResources(value) {
    if (!Array.isArray(value)) return [];
    return value.map((resource, index) => {
      if (typeof resource === "string") {
        return {
          title: `Class resource ${index + 1}`,
          fileType: resource.split(".").pop()?.split(/[?#]/)[0] || "file",
          url: safeHttpUrl(resource),
        };
      }
      if (!resource || typeof resource !== "object") return null;
      const url = safeHttpUrl(resource.url || resource.href);
      const title = String(resource.title || resource.name || `Class resource ${index + 1}`);
      const fileType = String(
        resource.file_type ||
          resource.type ||
          title.split(".").pop() ||
          "file",
      ).replace(/^\./, "").toLowerCase();
      return { title, fileType, url };
    }).filter(Boolean);
  }

  function mapRecording(row, subjects, teacherNames) {
    const subject = subjects.find(
      (item) => String(item.id) === String(row.subject_id),
    );
    if (!subject || row.recording_status !== "available" ||
      !row.recording_verified_at || !row.storage_path) return null;
    const grade = Number(row.grade);
    const status = "available";
    return {
      id: String(row.id),
      title: String(row.title || "Title not provided"),
      description: String(row.description || ""),
      grade,
      stream: String(row.stream || ""),
      subjectId: String(row.subject_id),
      subject: subject.name,
      chapter: String(row.chapter || "Not provided"),
      topic: String(row.topic || "Not provided"),
      teacher: String(row.teacher_name || row.teacher?.full_name || teacherNames.get(String(row.teacher_id)) || "Not provided"),
      provider: String(row.provider || "Not provided"),
      providerRecordingId: String(row.provider_recording_id || ""),
      thumbnailUrl: safeHttpUrl(row.thumbnail_url),
      resources: readResources(row.resource_urls),
      status,
      startedAt: row.started_at || null,
      recordingStartedAt: row.recording_started_at || null,
      durationSeconds: Number.isFinite(Number(row.duration_seconds)) && Number(row.duration_seconds) > 0
        ? Number(row.duration_seconds)
        : null,
    };
  }

  async function loadRecordedClassesFromSupabase(client, student, subjects) {
    if (!subjects.length) return [];
    let query = client
      .from("recorded_classes")
      .select(
        "id, live_class_id, teacher_id, title, description, grade, stream, subject_id, chapter, topic, provider, provider_recording_id, thumbnail_url, resource_urls, recording_status, recording_verified_at, recording_started_at, storage_path, started_at, duration_seconds, ready_at, created_at, updated_at",
      )
      .eq("grade", student.grade)
      .eq("recording_status", "available")
      .not("recording_verified_at", "is", null)
      .not("storage_path", "is", null)
      .in("subject_id", subjects.map((subject) => subject.id))
      .order("started_at", { ascending: false });
    if (Number(student.grade) >= 11) {
      query = query.eq("stream", student.stream);
    }
    const { data, error } = await query;
    if (error) throw error;
    const teacherIds = [...new Set((data || []).map((row) => String(row.teacher_id)).filter(Boolean))];
    const teacherNames = new Map();
    if (teacherIds.length) {
      const { data: teachers, error: teacherError } = await client
        .from("teachers")
        .select("id, full_name")
        .in("id", teacherIds);
      if (teacherError) throw teacherError;
      (teachers || []).forEach((teacher) => {
        teacherNames.set(String(teacher.id), String(teacher.full_name || ""));
      });
    }
    return (data || [])
      .map((row) => mapRecording(row, subjects, teacherNames))
      .filter((recording) =>
        recording &&
        recording.grade === Number(student.grade) &&
        (recording.grade < 11 ||
          normalize(recording.stream) === normalize(student.stream))
      );
  }

  async function loadRecordedClasses(client, student, subjects) {
    return loadRecordedClassesFromSupabase(client, student, subjects);
  }

  async function loadStudentContext() {
    if (!window.SubjectService) {
      throw new Error("The student curriculum service could not be loaded.");
    }
    const client = window.SubjectService.getClient();
    const curriculum = await window.SubjectService.getStudentSubjects(client);
    state.client = client;
    state.student = {
      ...curriculum.student,
      grade: Number(curriculum.grade),
      stream: Number(curriculum.grade) >= 11 ? curriculum.stream : "",
    };
    state.subjects = curriculum.subjects || [];
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const stream = normalize(state.student.stream).replace(/[\s-]+/g, "_");
    $("registrationContextText").textContent =
      Number(state.student.grade) >= 11
        ? `Grade ${state.student.grade} - ${streamLabels[stream] || stream.replace(/_/g, " ")}`
        : `Grade ${state.student.grade}`;
    $("registrationContext").hidden = false;
  }

  function setLoading(isLoading) {
    $("recordingGrid").setAttribute("aria-busy", String(isLoading));
    if (!isLoading) return;
    $("recordingGrid").innerHTML = Array.from({ length: 6 }, () =>
      `<div class="recording-skeleton" aria-hidden="true"><div class="skeleton-shimmer"></div><div class="skeleton-copy"><span class="skeleton-line"></span><span class="skeleton-line"></span><span class="skeleton-line"></span></div></div>`
    ).join("");
    $("resultsDescription").textContent = "Loading your learning library…";
  }

  function updateSummary() {
    $("totalRecordings").textContent = String(state.recordings.length);
    $("availableRecordings").textContent = String(
      state.recordings.filter((recording) => recording.status === "available").length,
    );
    $("processingRecordings").textContent = String(
      state.recordings.filter((recording) => recording.status === "processing").length,
    );
  }

  function populateFilters() {
    const subjectFilter = $("subjectFilter");
    const selectedSubject = subjectFilter.value || "all";
    const subjectNames = [...new Set(state.subjects.map((item) => item.name))]
      .sort((left, right) => left.localeCompare(right));
    subjectFilter.innerHTML = `<option value="all">All Subjects</option>${
      subjectNames.map((subject) =>
        `<option value="${escapeHTML(subject)}">${escapeHTML(subject)}</option>`
      ).join("")
    }`;
    if (subjectNames.includes(selectedSubject)) subjectFilter.value = selectedSubject;

    const grades = Number.isFinite(Number(state.student?.grade))
      ? [Number(state.student.grade)]
      : [];
    $("gradeFilter").innerHTML = `<option value="all">All grades</option>${
      grades.map((grade) =>
        `<option value="${grade}">Grade ${grade}</option>`
      ).join("")
    }`;
    $("gradeFilter").value = "all";

    const isSeniorGrade = Number(state.student?.grade) >= 11;
    $("streamFilterGroup").hidden = !isSeniorGrade;
    const streams = isSeniorGrade && state.student?.stream
      ? [state.student.stream]
      : [];
    $("streamFilter").innerHTML = `<option value="all">All streams</option>${
      streams.map((stream) =>
        `<option value="${escapeHTML(stream)}">${escapeHTML(stream.replace(/[_-]+/g, " "))}</option>`
      ).join("")
    }`;
    $("streamFilter").value = "all";
  }

  function filteredRecordings() {
    const query = normalize($("recordingSearch").value);
    const subject = $("subjectFilter").value;
    const grade = $("gradeFilter").value;
    const stream = $("streamFilter").value;
    const status = $("statusFilter").value;
    const sort = $("sortFilter").value;
    const recordings = state.recordings.filter((recording) => {
      const searchable = normalize([
        recording.title,
        recording.chapter,
        recording.topic,
        recording.teacher,
        recording.subject,
        recording.description,
      ].join(" "));
      return (!query || searchable.includes(query)) &&
        (subject === "all" || recording.subject === subject) &&
        (grade === "all" || String(recording.grade) === grade) &&
        (stream === "all" || normalize(recording.stream) === normalize(stream)) &&
        (status === "all" || recording.status === status);
    });
    recordings.sort((left, right) => {
      const delta = Date.parse(left.startedAt || "") - Date.parse(right.startedAt || "");
      return sort === "oldest" ? delta : -delta;
    });
    return recordings;
  }

  function renderRecordingCard(recording, index) {
    const progress = progressFor(recording.id);
    const complete = state.completed.has(recording.id);
    const streamText = recording.grade >= 11 && recording.stream
      ? ` · ${escapeHTML(recording.stream.replace(/[_-]+/g, " "))}`
      : "";
    const canWatch = recording.status === "available";
    const tone = ["purple", "blue", "green", "orange", "pink", "teal"][index % 6];
    const date = recording.startedAt ? formatDate(recording.startedAt) : "Date not provided";
    return `<article class="recording-card" data-recording-card="${escapeHTML(recording.id)}">
      <div class="recording-art art-${tone}">
        ${recording.thumbnailUrl
          ? `<img src="${escapeHTML(recording.thumbnailUrl)}" alt="" loading="lazy">`
          : `<span class="recording-art-icon"><i class="fa-solid ${subjectIcon(recording.subject)}" aria-hidden="true"></i></span>`}
        ${canWatch
          ? `<button class="recording-play" type="button" data-action="watch" data-recording-id="${escapeHTML(recording.id)}" aria-label="Watch ${escapeHTML(recording.title)}"><i class="fa-solid fa-play" aria-hidden="true"></i></button>`
          : ""}
        <span class="recording-status" data-status="${recording.status}">${statusLabel(recording.status)}</span>
        <span class="recording-duration">${formatDuration(recording.durationSeconds)}</span>
        ${complete ? `<span class="completed-chip"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Completed</span>` : ""}
        ${progress > 0 ? `<div class="recording-progress"><span style="width:${progress}%"></span></div>` : ""}
      </div>
      <div class="recording-card-body">
        <div class="recording-subject"><i class="fa-solid ${subjectIcon(recording.subject)}" aria-hidden="true"></i>${escapeHTML(recording.subject)}</div>
        <h3>${escapeHTML(recording.title)}</h3>
        <p class="recording-chapter">${escapeHTML(recording.chapter)} · ${escapeHTML(recording.topic)}</p>
        <div class="recording-meta">
          <span title="Teacher"><i class="fa-solid fa-user-tie" aria-hidden="true"></i><span>${escapeHTML(recording.teacher)}</span></span>
          <span title="Grade and stream"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i><span>Grade ${recording.grade}${streamText}</span></span>
          <span title="Class date"><i class="fa-regular fa-calendar" aria-hidden="true"></i><span>${escapeHTML(date)}</span></span>
          <span title="Recording start"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>${escapeHTML(recording.recordingStartedAt ? formatTime(recording.recordingStartedAt) : "Recording time not provided")}</span></span>
          <span title="Duration"><i class="fa-solid fa-stopwatch" aria-hidden="true"></i><span>${formatDuration(recording.durationSeconds)}</span></span>
          <span title="Recording platform"><i class="fa-solid fa-display" aria-hidden="true"></i><span>${escapeHTML(recording.provider)}</span></span>
        </div>
        <div class="recording-progress-copy"><span>${complete ? "Finished watching" : progress ? "Continue watching" : "Watch progress"}</span><strong>${progress}%</strong></div>
        <div class="recording-progress-track" aria-label="${progress}% watched"><span style="width:${progress}%"></span></div>
        ${canWatch
          ? `<div class="recording-actions">
              <button class="lecture-button lecture-button-primary" type="button" data-action="watch" data-recording-id="${escapeHTML(recording.id)}"><i class="fa-solid fa-play" aria-hidden="true"></i>${progress ? "Continue" : "Watch Lecture"}</button>
              <button class="lecture-button" type="button" data-action="details" data-recording-id="${escapeHTML(recording.id)}">View Details</button>
            </div>`
          : `<p class="recording-state-message" data-status="${recording.status}">${escapeHTML(statusMessage(recording.status))}</p>
             <div class="recording-actions"><button class="lecture-button" type="button" data-action="details" data-recording-id="${escapeHTML(recording.id)}">View Details</button></div>`}
      </div>
    </article>`;
  }

  function renderRecordings() {
    const grid = $("recordingGrid");
    const recordings = filteredRecordings();
    $("resultsDescription").textContent =
      `${recordings.length} ${recordings.length === 1 ? "recording" : "recordings"} found`;
    if (!recordings.length) {
      const hasRecordings = state.recordings.length > 0;
      grid.innerHTML = `<div class="recorded-empty"><div><i class="fa-solid fa-video-slash" aria-hidden="true"></i><h3>${hasRecordings ? "No recordings match your filters" : "No recorded classes yet"}</h3><p>${hasRecordings ? "Try a different search or clear the selected filters to see your class recordings." : "Your recorded classes will appear here when they are available."}</p>${hasRecordings ? '<button class="clear-filters" type="button" data-action="clear">Clear filters</button>' : ""}</div></div>`;
      return;
    }
    grid.innerHTML = recordings.map(renderRecordingCard).join("");
  }

  function showError(error) {
    console.error("Recorded classes could not be loaded.", error);
    $("recordingGrid").setAttribute("aria-busy", "false");
    $("recordingGrid").innerHTML = `<div class="recorded-error" role="alert"><div><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><h3>Recorded classes could not be loaded</h3><p>${escapeHTML(error?.message || "Please try again.")}</p><button class="lecture-button lecture-button-primary" id="retryRecordings" type="button">Try again</button></div></div>`;
    $("resultsDescription").textContent = "Please retry loading your learning library.";
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $("refreshRecordings").disabled = true;
    setLoading(true);
    try {
      await loadStudentContext();
      state.recordings = await loadRecordedClasses(
        state.client,
        state.student,
        state.subjects,
      );
      updateSummary();
      populateFilters();
      renderRecordings();
    } catch (error) {
      showError(error);
    } finally {
      state.loading = false;
      $("refreshRecordings").disabled = false;
      $("recordingGrid").setAttribute("aria-busy", "false");
    }
  }

  function playbackSource(url) {
    const safeUrl = safeHttpUrl(url);
    if (!safeUrl) return null;
    try {
      const parsed = new URL(safeUrl);
      const projectUrl = new URL(window.SmartLearningSupabase.SUPABASE_URL);
      if (parsed.origin !== projectUrl.origin ||
        !parsed.pathname.includes("/storage/v1/object/sign/recorded-class-videos/") ||
        !/\.(mp4|webm|mov)$/i.test(parsed.pathname)) return null;
      return safeUrl;
    } catch {
      return null;
    }
  }

  async function getPlaybackUrl(recording) {
    const { data, error } = await state.client.functions.invoke("recorded-class-playback", {
      body: { recording_id: recording.id },
    });
    if (error) {
      let message = error.message || "A secure playback link could not be created.";
      try {
        const response = await error.context?.json?.();
        if (response?.error) message = response.error;
      } catch {
        // The function response may already have been consumed.
      }
      throw new Error(message);
    }
    const url = playbackSource(data?.playback_url);
    if (!url) throw new Error("The playback service returned an invalid or non-private video URL.");
    return url;
  }

  function detailInfo(recording) {
    const rows = [
      ["Teacher", recording.teacher],
      ["Grade", `Grade ${recording.grade}`],
      ["Stream", recording.grade >= 11 ? recording.stream || "Not provided" : "—"],
      ["Subject", recording.subject],
      ["Chapter", recording.chapter],
      ["Topic", recording.topic],
      ["Class date", recording.startedAt ? formatDate(recording.startedAt) : "Not provided"],
      ["Scheduled class start", recording.startedAt ? formatTime(recording.startedAt) : "Not provided"],
      ["Actual recording start", recording.recordingStartedAt ? `${formatDate(recording.recordingStartedAt)} · ${formatTime(recording.recordingStartedAt)}` : "Not provided"],
      ["Duration", formatDuration(recording.durationSeconds)],
      ["Platform", recording.provider],
    ];
    return rows.map(([label, value]) =>
      `<div class="lecture-info-item"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`
    ).join("");
  }

  function renderResources(recording) {
    if (!recording.resources.length) {
      return `<p class="resource-empty">No study resources have been attached to this class.</p>`;
    }
    return `<div class="resource-list">${recording.resources.map((resource) => {
      const icon = resource.fileType === "pdf"
        ? "fa-file-pdf"
        : resource.fileType.includes("doc") || resource.fileType === "notes"
          ? "fa-file-lines"
          : "fa-paperclip";
      const action = resource.url
        ? `<a class="resource-action" href="${escapeHTML(resource.url)}" target="_blank" rel="noopener noreferrer">View</a>`
        : `<button class="resource-action" type="button" disabled title="No linked file is available">Unavailable</button>`;
      return `<div class="resource-item"><i class="fa-solid ${icon} resource-type-icon" aria-hidden="true"></i><div class="resource-copy"><strong>${escapeHTML(resource.title)}</strong><small>${escapeHTML(resource.fileType)}</small></div>${action}</div>`;
    }).join("")}</div>`;
  }

  async function renderLectureDetails(recording) {
    const requestId = ++state.playbackRequest;
    const progress = progressFor(recording.id);
    $("lectureDialogContent").innerHTML = `<div class="lecture-detail-header"><div><div class="recorded-eyebrow"><span class="recording-status" data-status="${recording.status}">${escapeHTML(statusLabel(recording.status))}</span></div><h2 id="detailTitle">${escapeHTML(recording.title)}</h2><p>${escapeHTML(recording.subject)} · ${escapeHTML(recording.chapter)}</p></div><button class="dialog-close" type="button" data-close-dialog aria-label="Close lecture details"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
      <div class="lecture-player"><div class="player-placeholder" id="lecturePlayerStatus"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><strong>Preparing secure playback</strong><p>A temporary link is being created after checking your access.</p></div></div>
      <div class="lecture-detail-content"><section><h3>About this class</h3><p class="lecture-description">${escapeHTML(recording.description || "No class description has been provided.")}</p><div class="lecture-info-grid">${detailInfo(recording)}</div></section><aside class="lecture-resources"><h3>Study resources</h3><p>Notes and attachments shared with this lecture.</p>${renderResources(recording)}</aside></div>
      <div class="detail-progress"><div class="detail-progress-head"><span>${state.completed.has(recording.id) ? "Lecture completed" : "Watch progress (this session only)"}</span><strong id="detailProgressValue">${progress}%</strong></div><div class="recording-progress-track"><span id="detailProgressBar" style="width:${progress}%"></span></div></div>`;

    const dialog = $("lectureDialog");
    dialog.dataset.recordingId = recording.id;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
    try {
      const url = await getPlaybackUrl(recording);
      if (requestId !== state.playbackRequest || !dialog.open) return;
      dialog.querySelector(".lecture-player").innerHTML =
        `<video id="lectureVideo" controls playsinline preload="metadata" aria-label="${escapeHTML(recording.title)}" src="${escapeHTML(url)}"></video>`;
      dialog.querySelector(".player-extra-controls")?.remove();
      const extraControls = document.createElement("div");
      extraControls.className = "player-extra-controls";
      extraControls.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Use the video controls to play, pause, adjust volume, seek, or enter fullscreen.</span><label for="playbackSpeed">Speed<select id="playbackSpeed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>';
      dialog.querySelector(".lecture-player").after(extraControls);
      dialog.querySelector("#playbackSpeed")?.addEventListener("change", (event) => {
        const video = dialog.querySelector("#lectureVideo");
        if (video) video.playbackRate = Number(event.currentTarget.value);
      });
      const video = dialog.querySelector("#lectureVideo");
      video.addEventListener("loadedmetadata", () => {
        const savedPosition = state.watchProgress.get(recording.id)?.position || 0;
        if (savedPosition > 0 && savedPosition < video.duration) video.currentTime = savedPosition;
      }, { once: true });
      video.addEventListener("timeupdate", () => updateWatchProgress(recording, video));
      video.addEventListener("ended", () => {
        state.completed.add(recording.id);
        updateWatchProgress(recording, video);
      });
      video.addEventListener("error", () => {
        const player = dialog.querySelector(".lecture-player");
        if (player) {
          player.innerHTML = `<div class="player-placeholder" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><strong>Playback is unavailable</strong><p>The temporary playback link may have expired. Request a fresh link and try again.</p><button class="lecture-button lecture-button-primary" type="button" data-action="retry-playback">Retry playback</button></div>`;
        }
      }, { once: true });
    } catch (error) {
      if (requestId !== state.playbackRequest || !dialog.open) return;
      console.error("Secure recording playback could not be prepared.", error);
      const player = dialog.querySelector(".lecture-player");
      if (player) {
        player.innerHTML = `<div class="player-placeholder" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><strong>Playback could not be prepared</strong><p>${escapeHTML(error?.message || "Please retry.")}</p><button class="lecture-button lecture-button-primary" type="button" data-action="retry-playback">Retry playback</button></div>`;
      }
    }
  }

  function updateWatchProgress(recording, video) {
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const percent = Math.max(0, Math.min(100, Math.round(video.currentTime / duration * 100)));
    state.watchProgress.set(recording.id, {
      position: video.currentTime,
      percent,
    });
    if (percent >= 100) state.completed.add(recording.id);
    const value = $("detailProgressValue");
    const bar = $("detailProgressBar");
    if (value) value.textContent = `${percent}%`;
    if (bar) bar.style.width = `${percent}%`;
    const card = [...document.querySelectorAll("[data-recording-card]")]
      .find((item) => item.dataset.recordingCard === recording.id);
    if (card) {
      const copy = card.querySelector(".recording-progress-copy");
      const track = card.querySelector(".recording-progress-track span");
      const art = card.querySelector(".recording-art");
      if (copy) {
        copy.innerHTML = `<span>${state.completed.has(recording.id) ? "Finished watching" : "Continue watching"}</span><strong>${percent}%</strong>`;
      }
      if (track) track.style.width = `${percent}%`;
      if (art) {
        let progressBar = art.querySelector(".recording-progress span");
        if (!progressBar) {
          art.insertAdjacentHTML("beforeend", `<div class="recording-progress"><span></span></div>`);
          progressBar = art.querySelector(".recording-progress span");
        }
        progressBar.style.width = `${percent}%`;
        if (state.completed.has(recording.id) && !art.querySelector(".completed-chip")) {
          art.insertAdjacentHTML(
            "beforeend",
            `<span class="completed-chip"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Completed</span>`,
          );
        }
      }
    }
  }

  function progressFor(recordingId) {
    const progress = state.watchProgress.get(recordingId);
    return Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  }

  function findRecording(id) {
    return state.recordings.find((recording) => recording.id === String(id));
  }

  function clearFilters() {
    $("recordingSearch").value = "";
    $("subjectFilter").value = "all";
    $("gradeFilter").value = "all";
    $("streamFilter").value = "all";
    $("statusFilter").value = "all";
    $("sortFilter").value = "newest";
    renderRecordings();
  }

  function bindEvents() {
    ["recordingSearch", "subjectFilter", "gradeFilter", "streamFilter", "statusFilter", "sortFilter"]
      .forEach((id) => $(id).addEventListener(
        id === "recordingSearch" ? "input" : "change",
        renderRecordings,
      ));
    $("clearFilters").addEventListener("click", clearFilters);
    $("refreshRecordings").addEventListener("click", () => void load());
    $("recordingGrid").addEventListener("click", (event) => {
      const retry = event.target.closest("#retryRecordings");
      if (retry) {
        void load();
        return;
      }
      const clearButton = event.target.closest('[data-action="clear"]');
      if (clearButton) {
        clearFilters();
        return;
      }
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const recording = findRecording(action.dataset.recordingId);
      if (recording) renderLectureDetails(recording);
    });
    $("lectureDialog").addEventListener("click", (event) => {
      const retry = event.target.closest('[data-action="retry-playback"]');
      if (retry) {
        const recording = findRecording($("lectureDialog").dataset.recordingId);
        if (recording) void renderLectureDetails(recording);
        return;
      }
      if (event.target === $("lectureDialog")) $("lectureDialog").close();
    });
    $("lectureDialog").addEventListener("close", () => {
      state.playbackRequest += 1;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    void load();
  }, { once: true });
})();
