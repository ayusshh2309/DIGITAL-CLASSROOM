(() => {
  const VIDEO_BUCKET = "videos";
  const SIGNED_URL_EXPIRY_SECONDS = 3600;
  const REFRESH_DELAY_MS = 250;
  const VIDEO_DIAGNOSTICS = true;
  const VIDEO_HEARTBEAT_INTERVAL_MS = 15_000;
  const state = {
    client: null,
    user: null,
    student: null,
    subjects: [],
    subjectsById: new Map(),
    curriculumSubjectIds: new Set(),
    videos: [],
    channel: null,
    activeVideo: null,
    playbackRequest: 0,
    videoTracking: null,
    videoTrackingQueue: Promise.resolve(),
    videoPlaybackReady: false,
    loading: false,
    loadFailed: false,
    reloadQueued: false,
    refreshTimer: null,
    deepLinkHandled: false,
  };
  const $ = (id) => document.getElementById(id);

  async function evaluateAchievementsAfterStudySession(sessionId) {
    try {
      const { data, error } = await state.client.rpc("evaluate_student_achievements_v1");
      if (error) throw error;
      console.info("Student achievements evaluated after study session.", {
        sessionId,
        result: data,
      });
    } catch (error) {
      console.error("Could not evaluate achievements after stopping a study session.", {
        sessionId,
        error,
      });
    }
  }

  function escape(value) {
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

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(String(value || ""));
  }

  function sessionIdFromRpcResult(data) {
    const result = Array.isArray(data) ? data[0] : data;
    const sessionId = typeof result === "string"
      ? result
      : result?.session_id ?? result?.id;
    if (!isUuid(sessionId)) {
      throw new Error("The video study-time RPC did not return a valid session ID.");
    }
    return String(sessionId);
  }

  function canTrackVideoPlayback() {
    const player = $("videoPlayer");
    return Boolean(
      state.activeVideo &&
      state.videoPlaybackReady &&
      !document.hidden &&
      !player.paused &&
      !player.ended &&
      !player.seeking,
    );
  }

  function queueVideoTrackingOperation(operation) {
    const queued = state.videoTrackingQueue.then(operation, operation);
    state.videoTrackingQueue = queued.catch(() => {});
    return queued;
  }

  async function stopVideoTracking() {
    const tracking = state.videoTracking;
    if (!tracking) return true;
    tracking.stopRequested = true;
    window.clearInterval(tracking.heartbeatTimer);
    window.clearTimeout(tracking.stopRetryTimer);
    tracking.heartbeatTimer = null;
    tracking.stopRetryTimer = null;
    if (tracking.stopPromise) return tracking.stopPromise;

    tracking.stopPromise = (async () => {
      if (tracking.heartbeatInFlight) await tracking.heartbeatInFlight;
      const { error } = await state.client.rpc(
        "study_time_stop_activity_v1",
        { p_session_id: tracking.sessionId },
      );
      if (error) throw error;
      if (state.videoTracking === tracking) state.videoTracking = null;
      void evaluateAchievementsAfterStudySession(tracking.sessionId);
      return true;
    })().catch((error) => {
      console.error("Could not stop the video study-time session.", error);
      tracking.stopPromise = null;
      if (state.videoTracking === tracking) {
        tracking.stopRetryTimer = window.setTimeout(() => {
          tracking.stopRetryTimer = null;
          void queueVideoTrackingOperation(stopVideoTracking);
        }, VIDEO_HEARTBEAT_INTERVAL_MS);
      }
      return false;
    });
    return tracking.stopPromise;
  }

  async function sendVideoHeartbeat(tracking) {
    if (
      state.videoTracking !== tracking ||
      tracking.stopRequested ||
      tracking.heartbeatInFlight
    ) {
      return;
    }
    if (!canTrackVideoPlayback()) {
      void queueVideoTrackingOperation(stopVideoTracking);
      return;
    }

    tracking.heartbeatInFlight = (async () => {
      const { error } = await state.client.rpc(
        "study_time_heartbeat_activity_v1",
        { p_session_id: tracking.sessionId },
      );
      if (error) throw error;
    })();
    try {
      await tracking.heartbeatInFlight;
    } catch (error) {
      console.error("The video study-time heartbeat failed.", error);
      tracking.heartbeatFailed = true;
    } finally {
      tracking.heartbeatInFlight = null;
    }
    if (tracking.heartbeatFailed) {
      void queueVideoTrackingOperation(stopVideoTracking);
    }
  }

  async function startVideoTracking(video) {
    if (!isUuid(video?.id)) {
      console.error("Video study-time tracking was not started because its material ID is invalid.");
      return false;
    }
    try {
      const previousStopped = await stopVideoTracking();
      if (!previousStopped || !canTrackVideoPlayback() ||
        String(state.activeVideo.id) !== String(video.id)) {
        return false;
      }
      const { data, error } = await state.client.rpc(
        "study_time_start_activity_v1",
        {
          p_activity_type: "material",
          p_resource_id: video.id,
        },
      );
      if (error) throw error;

      const tracking = {
        sessionId: sessionIdFromRpcResult(data),
        materialId: String(video.id),
        heartbeatTimer: null,
        stopRetryTimer: null,
        heartbeatInFlight: null,
        heartbeatFailed: false,
        stopRequested: false,
        stopPromise: null,
      };
      state.videoTracking = tracking;
      if (!canTrackVideoPlayback() ||
        String(state.activeVideo.id) !== tracking.materialId) {
        await stopVideoTracking();
        return false;
      }
      tracking.heartbeatTimer = window.setInterval(() => {
        void sendVideoHeartbeat(tracking);
      }, VIDEO_HEARTBEAT_INTERVAL_MS);
      return true;
    } catch (error) {
      console.error("Could not start the video study-time session.", error);
      return false;
    }
  }

  function startVideoTrackingWhenPlaying() {
    state.videoPlaybackReady = true;
    const video = state.activeVideo;
    if (video) {
      void queueVideoTrackingOperation(() => startVideoTracking(video));
    }
  }

  function pauseVideoTracking() {
    state.videoPlaybackReady = false;
    void queueVideoTrackingOperation(stopVideoTracking);
  }

  function logVideoDiagnostic(step, details) {
    if (VIDEO_DIAGNOSTICS) {
      console.debug(`[Student Videos] ${step}`, details);
    }
  }

  function renderRegistrationContext() {
    if (!state.student) return;
    const grade = Number(state.student.grade);
    const stream = normalize(state.student.stream);
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
      arts_humanities: "Arts / Humanities",
    };
    const streamText = grade >= 11
      ? ` - ${streamLabels[stream] || stream}`
      : "";
    $("registrationContextText").textContent =
      `Grade ${grade}${streamText}`;
    $("registrationContext").hidden = false;
  }

  function colorFor(subject) {
    const value = normalize(subject);
    if (value.includes("chem")) return "green";
    if (value.includes("math") || value.includes("account")) return "orange";
    if (value.includes("english")) return "blue";
    if (value.includes("physical")) return "pink";
    if (value.includes("social") || value.includes("geography")) return "teal";
    if (value.includes("computer")) return "purple";
    if (value.includes("sanskrit") || value.includes("art")) return "yellow";
    return "purple";
  }

  function subjectIcon(subject) {
    const value = normalize(subject);
    if (value.includes("physics")) return "fa-atom";
    if (value.includes("chem")) return "fa-flask";
    if (value.includes("math") || value.includes("account")) return "fa-calculator";
    if (value.includes("computer")) return "fa-code";
    if (value.includes("english") || value.includes("hindi")) return "fa-book-open";
    if (value.includes("history")) return "fa-landmark";
    if (value.includes("geography")) return "fa-earth-americas";
    return "fa-book";
  }

  function videoDate(video) {
    if (!video.created_at) return null;
    const date = new Date(video.created_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(date) {
    if (!date) return "";
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function availableSubjects() {
    return state.subjects
      .map((subject) => subject.name)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  function renderSubjectControls() {
    const subjects = availableSubjects();
    const filter = $("subjectFilter");
    const current = filter.value || "All";
    filter.innerHTML = `<option value="All">All Subjects</option>${subjects
      .map((subject) => `<option value="${escape(subject)}">${escape(subject)}</option>`)
      .join("")}`;
    filter.value = subjects.includes(current) ? current : "All";

    const tabs = $("subjectTabs");
    tabs.querySelectorAll('.subject-tab:not([data-subject="All"])')
      .forEach((tab) => tab.remove());
    subjects.forEach((subject) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `subject-tab${filter.value === subject ? " active" : ""}`;
      tab.dataset.subject = subject;
      tab.innerHTML =
        `<span class="tab-dot ${colorFor(subject)}"></span>${escape(subject)}`;
      tabs.appendChild(tab);
    });
    tabs.querySelector('[data-subject="All"]')
      ?.classList.toggle("active", filter.value === "All");
  }

  function filteredVideos() {
    const query = normalize($("searchInput").value);
    const selectedSubject = $("subjectFilter").value;
    const videos = state.videos.filter((video) => {
      const searchable = normalize(`${video.title} ${video.description}`);
      return (!query || searchable.includes(query)) &&
        (selectedSubject === "All" || video.subject === selectedSubject);
    });
    const sort = $("sortFilter").value;
    return videos.sort((left, right) => {
      const leftDate = videoDate(left)?.getTime() || 0;
      const rightDate = videoDate(right)?.getTime() || 0;
      if (sort === "oldest") return leftDate - rightDate;
      if (sort === "az") {
        return String(left.title || "").localeCompare(String(right.title || ""));
      }
      return rightDate - leftDate;
    });
  }

  function renderVideos() {
    renderSubjectControls();
    const grid = $("videoGrid");
    const empty = $("noResults");
    const videos = filteredVideos();
    grid.querySelectorAll(".video-card").forEach((card) => card.remove());
    $("totalVideos").textContent = String(state.videos.length);
    $("totalProgress").style.width = state.videos.length ? "100%" : "0%";

    if (state.loading || state.loadFailed) {
      empty.style.display = "none";
      return;
    }

    empty.innerHTML = `<i class="fa-solid fa-video-slash" aria-hidden="true"></i>
      <h3>No videos found</h3>
      <p>Try another search or subject.</p>`;
    empty.style.display = videos.length ? "none" : "block";
    videos.forEach((video) => {
      const id = escape(video.id);
      const color = colorFor(video.subject);
      const date = videoDate(video);
      const card = document.createElement("article");
      card.className = "video-card";
      card.dataset.watch = video.id;
      card.tabIndex = 0;
      card.setAttribute("aria-label", `Play ${video.title || "video"}`);
      card.innerHTML = `<div class="thumbnail">
          <i class="fa-solid fa-video" style="color:white;font-size:30px" aria-hidden="true"></i>
          <button class="play-button" type="button" data-watch="${id}" aria-label="Play video">
            <i class="fa-solid fa-play"></i>
          </button>
        </div>
        <span class="video-subject subject-${color}">
          <i class="fa-solid ${subjectIcon(video.subject)}" aria-hidden="true"></i>
          &nbsp; ${escape(video.subject)}
        </span>
        <h3 class="video-title" title="${escape(video.title)}">${escape(video.title || "Untitled Video")}</h3>
        <p class="video-description">${escape(video.description || "")}</p>
        <div class="video-footer">
          <div class="video-meta">
            <span class="meta-item"><i class="fa-solid fa-circle-play" aria-hidden="true"></i>${escape(video.subject)}</span>
            ${date ? `<span class="meta-item"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${escape(formatDate(date))}</span>` : ""}
          </div>
          <button class="watch-button watch-${color}" type="button" data-watch="${id}">
            <i class="fa-solid fa-play" aria-hidden="true"></i> Watch
          </button>
        </div>`;
      grid.insertBefore(card, empty);
    });
  }

  function setVideosStatus(message, kind = "info", retry = false) {
    const status = $("videosStatus");
    status.replaceChildren();
    status.dataset.state = kind;
    status.hidden = !message;
    if (!message) return;
    status.append(document.createTextNode(message));
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "retryVideos";
      button.textContent = "Try again";
      status.append(" ", button);
    }
  }

  function studentVideoQuery(student) {
    let query = state.client
      .from("materials")
      .select("id, grade, stream, subject_id, title, description, material_type, storage_bucket, file_path, file_name, mime_type, created_at")
      .eq("grade", student.grade)
      .eq("material_type", "video")
      .eq("storage_bucket", VIDEO_BUCKET);
    if (Number(student.grade) >= 11) {
      query = query.eq("stream", normalize(student.stream));
    }
    return query.order("created_at", { ascending: false });
  }

  function normalizeVideo(row, student) {
    const grade = Number(row.grade);
    const subject = state.subjectsById.get(String(row.subject_id));
    const eligibleGrade = Number.isInteger(grade) && grade === Number(student.grade);
    const eligibleStream = grade <= 10 ||
      normalize(row.stream) === normalize(student.stream);
    if (
      !eligibleGrade ||
      !eligibleStream ||
      row.material_type !== "video" ||
      row.storage_bucket !== VIDEO_BUCKET ||
      !subject ||
      !row.id ||
      !row.file_path ||
      row.file_path.startsWith("/") ||
      /^https?:\/\//i.test(row.file_path)
    ) {
      return null;
    }
    return {
      id: String(row.id),
      grade,
      stream: row.stream,
      subject_id: String(row.subject_id),
      subject: subject.name,
      title: String(row.title || "Untitled Video"),
      description: String(row.description || ""),
      material_type: row.material_type,
      storage_bucket: row.storage_bucket,
      file_path: row.file_path,
      file_name: row.file_name,
      mime_type: row.mime_type,
      created_at: row.created_at,
    };
  }

  async function loadCurrentCurriculum() {
    const curriculum = await window.StudentCurriculum.loadCurrentStudent(state.client);
    if (!curriculum?.user?.id) {
      throw Object.assign(new Error("Sign in to view your videos."), {
        code: "AUTH_REQUIRED",
      });
    }
    state.user = curriculum.user;
    state.student = {
      ...curriculum.student,
      grade: Number(curriculum.grade),
      stream: Number(curriculum.grade) >= 11
        ? normalize(curriculum.stream)
        : null,
    };
    state.subjects = curriculum.subjects || [];
    state.curriculumSubjectIds = new Set(
      state.subjects.map((subject) => String(subject.id)),
    );
    state.subjectsById = new Map(
      (curriculum.subjectCatalog || state.subjects)
        .map((subject) => [String(subject.id), subject]),
    );
    logVideoDiagnostic("Authenticated user", { userId: state.user.id });
    logVideoDiagnostic("Student profile", state.student);
    logVideoDiagnostic("Registered grade and stream", {
      grade: state.student.grade,
      stream: state.student.stream,
    });
    logVideoDiagnostic("Curriculum subjects", state.subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
    })));
    if (
      !Number.isInteger(state.student.grade) ||
      state.student.grade < 5 ||
      state.student.grade > 12
    ) {
      throw new Error("Your student profile does not have a valid registered grade.");
    }
    if (state.student.grade >= 11 && !state.student.stream) {
      throw new Error("Your registered Grade 11 or 12 profile is missing its stream.");
    }
    renderRegistrationContext();
  }

  function showLoadError(error) {
    console.error("Student Videos could not be loaded.", error);
    state.videos = [];
    state.loadFailed = true;
    renderVideos();
    if (error?.code === "AUTH_REQUIRED") {
      window.location.assign("../teacher_registration/login.html");
      return;
    }
    const message = /no student profile is linked/i.test(error?.message || "")
      ? "No student profile is linked to this account. Contact your school administrator."
      : error?.message || "The authorized videos could not be loaded.";
    setVideosStatus(`Videos could not be loaded. ${message}`, "error", true);
  }

  async function loadVideos() {
    if (state.loading) {
      state.reloadQueued = true;
      return;
    }
    state.loading = true;
    state.loadFailed = false;
    setVideosStatus("Loading your videos...");
    renderVideos();
    try {
      if (!state.client) throw new Error("Supabase is not configured for this page.");
      await loadCurrentCurriculum();
      const { data, error } = await studentVideoQuery(state.student);
      if (error) {
        console.error("[Student Videos] Materials query failed.", error);
        throw error;
      }
      const rawVideos = data ?? [];
      logVideoDiagnostic("Raw video records returned by materials", rawVideos);
      if (!rawVideos.length) {
        console.warn(
          "[Student Videos] No video rows were returned. If a matching record exists, verify the authenticated student's materials SELECT RLS policy.",
        );
      }
      const gradeVideos = rawVideos.filter((row) =>
        Number(row.grade) === state.student.grade
      );
      logVideoDiagnostic("Records after grade filtering", gradeVideos);
      const streamVideos = gradeVideos.filter((row) =>
        state.student.grade < 11 ||
        normalize(row.stream) === normalize(state.student.stream)
      );
      logVideoDiagnostic("Records after stream filtering", streamVideos);
      logVideoDiagnostic("Subject ID-to-name mapping", streamVideos.map((row) => ({
        materialId: row.id,
        subjectId: row.subject_id,
        catalogSubjectId: state.subjectsById.has(String(row.subject_id))
          ? state.subjectsById.get(String(row.subject_id)).id
          : null,
        subjectName: state.subjectsById.get(String(row.subject_id))?.name || null,
        isCurriculumSubject: state.curriculumSubjectIds.has(String(row.subject_id)),
      })));
      state.videos = streamVideos
        .map((row) => normalizeVideo(row, state.student))
        .filter(Boolean);
      logVideoDiagnostic("Final videos passed to renderer", state.videos);
      const requestedMaterialId = new URLSearchParams(window.location.search)
        .get("material_id");
      if (requestedMaterialId && !state.deepLinkHandled) {
        state.deepLinkHandled = true;
        if (state.videos.some((video) => video.id === requestedMaterialId)) {
          window.setTimeout(() => void openVideo(requestedMaterialId), 0);
        } else {
          setVideosStatus(
            "The selected video is not available to your registered class.",
            "error",
          );
        }
      }
      state.loadFailed = false;
      renderVideos();
      setVideosStatus("");
      subscribeToChanges();
    } catch (error) {
      showLoadError(error);
    } finally {
      state.loading = false;
      if (!state.loadFailed) renderVideos();
      if (state.reloadQueued) {
        state.reloadQueued = false;
        window.setTimeout(() => void loadVideos(), 0);
      }
    }
  }

  function scheduleReload() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => void loadVideos(), REFRESH_DELAY_MS);
  }

  function subscribeToChanges() {
    if (!state.client || !state.user || state.channel) return;
    const channel = state.client.channel(`student-videos-${state.user.id}`);
    channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "materials",
        filter: `grade=eq.${state.student.grade}`,
      }, scheduleReload)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
        filter: `user_id=eq.${state.user.id}`,
      }, scheduleReload)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "subjects",
      }, scheduleReload)
      .subscribe((status, error) => {
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          console.error("Student Videos Realtime subscription failed.", {
            status,
            error,
          });
        }
      });
    state.channel = channel;
  }

  async function fetchVideoForPlayback(video) {
    const subject = state.subjectsById.get(String(video.subject_id));
    if (!subject || !state.student || !state.user) {
      throw new Error("This video is no longer available to your registered curriculum.");
    }
    let query = state.client
      .from("materials")
      .select("id, grade, stream, subject_id, title, description, material_type, storage_bucket, file_path, file_name, mime_type, created_at")
      .eq("id", video.id)
      .eq("grade", state.student.grade)
      .eq("material_type", "video")
      .eq("storage_bucket", VIDEO_BUCKET)
      .eq("subject_id", video.subject_id);
    if (state.student.grade >= 11) {
      query = query.eq("stream", state.student.stream);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("This video is no longer available to your registered curriculum.");
    }
    const current = normalizeVideo(data, state.student);
    if (!current) {
      throw new Error("This video does not match your registered curriculum.");
    }
    return current;
  }

  async function videoUrl(video) {
    if (
      video.storage_bucket !== VIDEO_BUCKET ||
      !video.file_path ||
      video.file_path.startsWith("/") ||
      /^https?:\/\//i.test(video.file_path)
    ) {
      throw new Error("This video has invalid Storage bucket or file path metadata.");
    }
    const storage = state.client.storage.from(video.storage_bucket);
    try {
      const { data } = storage.getPublicUrl(video.file_path);
      if (data?.publicUrl) {
        const response = await window.fetch(data.publicUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        if (response.ok) return data.publicUrl;
      }
    } catch (error) {
      console.info("Public video URL is unavailable; trying a signed URL.", error);
    }
    const { data, error } = await storage.createSignedUrl(
      video.file_path,
      SIGNED_URL_EXPIRY_SECONDS,
    );
    if (error) throw error;
    if (!data?.signedUrl) {
      throw new Error("A secure video link could not be created.");
    }
    return data.signedUrl;
  }

  function playerErrorMessage() {
    const player = $("videoPlayer");
    if (player.error?.code === 4) {
      return "This video format cannot be played in this browser. Try a supported MP4 or WebM file.";
    }
    return "This video could not be played. Check your connection or ask your teacher to upload it again.";
  }

  function updatePlayerStatus(message, kind = "info") {
    const status = $("videoPlayerStatus");
    status.textContent = message;
    status.dataset.state = kind;
    status.hidden = !message;
  }

  async function openVideo(id) {
    const video = state.videos.find((item) => item.id === String(id));
    if (!video) return;
    const request = ++state.playbackRequest;
    state.videoPlaybackReady = false;
    $("videoPlayer").pause();
    state.activeVideo = video;
    $("modalTitle").textContent = video.title;
    $("modalDescription").textContent = video.description;
    $("modalPlay").hidden = true;
    $("videoPlayer").hidden = true;
    $("modalThumbnail").hidden = true;
    $("videoModal").classList.add("show");
    updatePlayerStatus("Loading video...", "info");
    try {
      const authorizedVideo = await fetchVideoForPlayback(video);
      const url = await videoUrl(authorizedVideo);
      if (request !== state.playbackRequest || state.activeVideo?.id !== video.id) return;
      const player = $("videoPlayer");
      player.removeAttribute("src");
      player.load();
      player.src = url;
      player.hidden = false;
      player.onloadedmetadata = () => {
        updatePlayerStatus("");
        $("modalPlay").hidden = false;
      };
      player.onerror = () => updatePlayerStatus(playerErrorMessage(), "error");
      player.onplay = () => {
        updatePlayerStatus("");
        $("modalPlay").hidden = true;
      };
      player.onpause = () => {
        if (!player.ended) $("modalPlay").hidden = false;
      };
      player.load();
      updatePlayerStatus("Video ready. Press play to start.", "info");
      $("modalPlay").hidden = false;
    } catch (error) {
      if (request !== state.playbackRequest) return;
      console.error("Unable to open the selected student video.", error);
      updatePlayerStatus(accessError(error), "error");
    }
  }

  function accessError(error) {
    const message = String(error?.message || "");
    if (/object not found|not found/i.test(message) || String(error?.statusCode) === "404") {
      return "The video file is missing from its stored location. Ask your teacher to upload it again.";
    }
    if (/permission|not authorized|unauthorized|row-level security/i.test(message)) {
      return "You do not have permission to access this video for your registered class.";
    }
    return message || "The video could not be accessed.";
  }

  function playActiveVideo() {
    const player = $("videoPlayer");
    if (!state.activeVideo || player.hidden || !player.src) return;
    player.play().catch((error) => {
      console.warn("Browser did not start video playback.", error);
      updatePlayerStatus("Press play on the video controls to begin.", "info");
    });
  }

  function closeVideoModal() {
    state.playbackRequest += 1;
    state.activeVideo = null;
    state.videoPlaybackReady = false;
    const player = $("videoPlayer");
    player.pause();
    void queueVideoTrackingOperation(stopVideoTracking);
    player.removeAttribute("src");
    player.load();
    player.hidden = true;
    player.onloadedmetadata = null;
    player.onerror = null;
    player.onplay = null;
    player.onpause = null;
    $("modalPlay").hidden = true;
    updatePlayerStatus("");
    $("videoModal").classList.remove("show");
  }

  function handleVideoGridClick(event) {
    const target = event.target.closest("[data-watch]");
    if (target) void openVideo(target.dataset.watch);
  }

  function setupEvents() {
    const player = $("videoPlayer");
    player.addEventListener("playing", startVideoTrackingWhenPlaying);
    player.addEventListener("pause", pauseVideoTracking);
    player.addEventListener("waiting", pauseVideoTracking);
    player.addEventListener("stalled", pauseVideoTracking);
    player.addEventListener("seeking", pauseVideoTracking);
    player.addEventListener("seeked", () => {
      if (!player.paused && !player.ended && player.readyState >= 3) {
        startVideoTrackingWhenPlaying();
      }
    });
    player.addEventListener("ended", pauseVideoTracking);
    player.addEventListener("error", pauseVideoTracking);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        pauseVideoTracking();
      } else if (!player.paused && !player.ended && !player.seeking &&
        player.readyState >= 3) {
        startVideoTrackingWhenPlaying();
      }
    });
    $("searchInput").addEventListener("input", renderVideos);
    $("subjectFilter").addEventListener("change", renderVideos);
    $("sortFilter").addEventListener("change", renderVideos);
    $("videoGrid").addEventListener("click", handleVideoGridClick);
    $("videoGrid").addEventListener("keydown", (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target.matches(".video-card")
      ) {
        event.preventDefault();
        void openVideo(event.target.dataset.watch);
      }
    });
    $("subjectTabs").addEventListener("click", (event) => {
      const tab = event.target.closest(".subject-tab[data-subject]");
      if (!tab) return;
      $("subjectFilter").value = tab.dataset.subject;
      renderVideos();
    });
    $("modalPlay").addEventListener("click", playActiveVideo);
    $("closeVideoModal").addEventListener("click", closeVideoModal);
    $("videoModal").addEventListener("click", (event) => {
      if (event.target === $("videoModal")) closeVideoModal();
    });
    $("videosStatus").addEventListener("click", (event) => {
      if (event.target.closest("#retryVideos")) void loadVideos();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeVideoModal();
    });
    window.addEventListener("pagehide", () => {
      window.clearTimeout(state.refreshTimer);
      if (state.channel) void state.client.removeChannel(state.channel);
      closeVideoModal();
    }, { once: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    state.client = window.SmartLearningSupabase?.getClient?.() || null;
    setupEvents();
    void loadVideos();
  });
})();
