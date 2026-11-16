(() => {
  "use strict";

  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const FILE_TYPES = new Map([
    [".mp4", "video/mp4"],
    [".webm", "video/webm"],
    [".mov", "video/quicktime"],
  ]);
  const elements = {
    dialog: document.getElementById("recordingUploadDialog"),
    form: document.getElementById("recordingUploadForm"),
    classInfo: document.getElementById("recordingUploadClass"),
    dialogTitle: document.getElementById("recordingUploadTitle"),
    description: document.getElementById("recordingDescriptionInput"),
    file: document.getElementById("recordingFileInput"),
    status: document.getElementById("recordingUploadStatus"),
    progress: document.getElementById("recordingUploadProgress"),
    progressBar: document.getElementById("recordingUploadProgressBar"),
    progressText: document.getElementById("recordingUploadProgressText"),
    submit: document.getElementById("submitRecordingUpload"),
    cancel: document.getElementById("cancelRecordingUpload"),
    close: document.getElementById("closeRecordingUpload"),
  };
  let selectedLiveClass = null;
  let replacementRecording = null;
  let currentSession = null;
  let activeRequest = null;
  let operationSequence = 0;
  let finalizing = false;

  function setStatus(message, state = "") {
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state;
    else delete elements.status.dataset.state;
  }

  function setBusy(busy) {
    elements.submit.disabled = busy;
    elements.cancel.disabled = busy;
    elements.description.disabled = busy;
    elements.file.disabled = busy;
  }

  function resetForm() {
    currentSession = null;
    activeRequest = null;
    elements.form.reset();
    elements.progress.hidden = true;
    elements.progressBar.value = 0;
    elements.progressText.textContent = "0%";
    elements.submit.disabled = false;
    elements.submit.textContent = "Upload recording";
    elements.cancel.disabled = false;
    elements.cancel.textContent = "Cancel";
    setStatus("");
  }

  function displayClassDetails(liveClass) {
    const relation = Array.isArray(liveClass.subjects) ? liveClass.subjects[0] : liveClass.subjects;
    const subjectName = relation?.name || liveClass.subject_name || liveClass.subject || "Subject not provided";
    const grade = liveClass.grade ?? liveClass.class_grade ?? "Not provided";
    const scheduledStart = liveClass.start_at ? new Date(liveClass.start_at) : null;
    const classDate = scheduledStart && Number.isFinite(scheduledStart.getTime())
      ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(scheduledStart)
      : liveClass.class_date || "Date not provided";
    const startTime = scheduledStart && Number.isFinite(scheduledStart.getTime())
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(scheduledStart)
      : liveClass.start_time || "Time not provided";
    const details = [
      liveClass.title || "Live class",
      `Grade ${grade}${liveClass.stream ? ` · ${String(liveClass.stream).replaceAll("_", " ")}` : ""} · ${subjectName}`,
      liveClass.chapter ? `Chapter: ${liveClass.chapter}` : "",
      liveClass.topic ? `Topic: ${liveClass.topic}` : "",
      `Date: ${classDate}`,
      `Start time: ${startTime}`,
      `Duration: ${Number(liveClass.duration_minutes) || 60} minutes`,
      liveClass.meeting_platform ? `Platform: ${liveClass.meeting_platform}` : "",
    ].filter(Boolean);
    elements.classInfo.replaceChildren();
    details.forEach((value, index) => {
      const line = document.createElement(index === 0 ? "strong" : "span");
      line.textContent = value;
      elements.classInfo.appendChild(line);
    });
  }

  function open(liveClass, recordingToReplace = null) {
    if (!liveClass || typeof liveClass.id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(liveClass.id)) return;
    if (recordingToReplace && (String(recordingToReplace.live_class_id) !== liveClass.id ||
      typeof recordingToReplace.id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(recordingToReplace.id))) return;
    selectedLiveClass = liveClass;
    replacementRecording = recordingToReplace;
    currentSession = null;
    displayClassDetails(liveClass);
    elements.description.value = recordingToReplace?.description || "";
    elements.file.value = "";
    elements.progress.hidden = true;
    elements.progressBar.value = 0;
    elements.progressText.textContent = "0%";
    elements.dialogTitle.textContent = recordingToReplace ? "Replace class recording" : "Upload a recording";
    elements.submit.textContent = recordingToReplace ? "Replace recording" : "Upload recording";
    elements.cancel.textContent = "Cancel";
    setStatus("");
    elements.submit.disabled = false;
    if (!elements.dialog.open) elements.dialog.showModal();
  }

  function validateFile(file) {
    if (!file) throw new Error("Choose a video file to upload.");
    const extension = `.${file.name.split(".").pop().toLowerCase()}`;
    const expectedType = FILE_TYPES.get(extension);
    if (!expectedType || file.type !== expectedType) {
      throw new Error("Choose an MP4, WebM, or MOV file with a matching video file type.");
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error("The selected video file is empty or could not be read.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("The video exceeds the project's 50 MiB upload limit.");
    }
    return { extension, contentType: expectedType };
  }

  function readVideoDuration(file) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    return new Promise((resolve) => {
      let timeout;
      let completed = false;
      const finish = (duration) => {
        if (completed) return;
        completed = true;
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
        resolve(Number.isFinite(duration) && duration > 0 && duration <= 86_400
          ? Math.max(1, Math.round(duration))
          : null);
      };
      video.addEventListener("loadedmetadata", () => finish(video.duration), { once: true });
      video.addEventListener("error", () => finish(null), { once: true });
      timeout = window.setTimeout(() => finish(null), 10_000);
      video.src = objectUrl;
    });
  }

  async function invokeFunction(name, body) {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      let detail = error.message || "The recording service returned an error.";
      try {
        const response = await error.context?.json?.();
        if (response?.error) detail = response.error;
      } catch {
        // The edge response may already have been consumed by the Supabase client.
      }
      throw new Error(detail);
    }
    if (data === null || data === undefined) {
      throw new Error("The recording service returned an empty response.");
    }
    if (data.success === false) {
      const detail = typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : "The recording service reported that the operation failed.";
      throw new Error(detail);
    }
    return data;
  }

  function uploadWithProgress(uploadUrl, file, contentType, maxFileSize) {
    if (file.size > maxFileSize) {
      return Promise.reject(new Error("This file exceeds the configured storage limit."));
    }
    const client = window.SmartLearningSupabase?.getClient?.();
    const sessionPromise = client?.auth.getSession();
    if (!sessionPromise) return Promise.reject(new Error("Sign in again before uploading."));
    return sessionPromise.then(({ data, error }) => {
      if (error) throw error;
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("Your session has expired. Sign in again.");
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeRequest = xhr;
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("apikey", window.SmartLearningSupabase.SUPABASE_ANON_KEY);
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
          elements.progressBar.value = percent;
          elements.progressText.textContent = `${percent}%`;
        });
        xhr.addEventListener("load", () => {
          activeRequest = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          let message = `Storage rejected the upload (HTTP ${xhr.status}).`;
          try {
            const response = JSON.parse(xhr.responseText);
            message = response.message || response.error || message;
          } catch {
            // Keep the useful HTTP status when Storage returns a non-JSON response.
          }
          reject(new Error(message));
        }, { once: true });
        xhr.addEventListener("error", () => {
          activeRequest = null;
          reject(new Error("The video could not be uploaded because of a network error."));
        }, { once: true });
        xhr.addEventListener("abort", () => {
          activeRequest = null;
          reject(new Error("Upload cancelled."));
        }, { once: true });
        xhr.send(file);
      });
    });
  }

  function lectureTitleFor(liveClass) {
    const titleValue = Object.prototype.hasOwnProperty.call(liveClass || {}, "recording_title")
      ? liveClass.recording_title
      : liveClass?.title;
    const title = typeof titleValue === "string" ? titleValue.trim() : "";
    if (!title) throw new Error("The selected live class does not have a lecture title.");
    if (title.length > 180) throw new Error("The lecture title must be 180 characters or fewer.");
    return title;
  }

  function payloadFor(file, contentType, durationSeconds) {
    if (!selectedLiveClass || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(selectedLiveClass.id)) {
      throw new Error("Choose a valid live class.");
    }
    const chapter = typeof selectedLiveClass.chapter === "string" ? selectedLiveClass.chapter.trim() : "";
    const topic = typeof selectedLiveClass.topic === "string" ? selectedLiveClass.topic.trim() : "";
    return {
      recording_mode: "live_class",
      live_class_id: selectedLiveClass.id,
      recording_id: currentSession.recording_id,
      title: lectureTitleFor(selectedLiveClass),
      ...(chapter ? { chapter } : {}),
      ...(topic ? { topic } : {}),
      content_type: contentType,
      file_size: file.size,
      duration_seconds: durationSeconds,
      description: elements.description.value.trim(),
      ...(replacementRecording ? { replace_recording_id: replacementRecording.id } : {}),
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedLiveClass || elements.submit.disabled) return;
    const operationId = ++operationSequence;
    let file;
    let type;
    try {
      lectureTitleFor(selectedLiveClass);
      file = elements.file.files[0];
      type = validateFile(file);
      setBusy(true);
      elements.cancel.disabled = false;
      if (currentSession?.file !== file) setStatus("Checking video duration…");
      const durationSeconds = currentSession?.file === file
        ? currentSession.duration_seconds
        : await readVideoDuration(file);
      if (operationId !== operationSequence) return;
      if (!currentSession || currentSession.file !== file || !currentSession.uploaded) {
        setStatus("Preparing a secure upload…");
        const data = await invokeFunction("create-recorded-upload", {
          recording_mode: "live_class",
          live_class_id: selectedLiveClass.id,
          ...(replacementRecording ? { replace_recording_id: replacementRecording.id } : {}),
          content_type: type.contentType,
          file_size: file.size,
          file_extension: type.extension,
        });
        if (operationId !== operationSequence) return;
        if (!data.upload_url || !data.recording_id || !Number.isFinite(Number(data.max_file_size_bytes))) {
          throw new Error("The upload service returned incomplete upload information.");
        }
        if (data.recording_mode !== "live_class" || data.live_class_id !== selectedLiveClass.id) {
          throw new Error("The upload service did not confirm the selected live class. Refresh the page and retry.");
        }
        if ((data.replace_recording_id || null) !== (replacementRecording?.id || null)) {
          throw new Error("The upload service did not confirm the recording being replaced. Refresh and retry.");
        }
        currentSession = {
          recording_id: data.recording_id,
          upload_url: data.upload_url,
          max_file_size_bytes: Number(data.max_file_size_bytes),
          file,
          duration_seconds: durationSeconds,
          uploaded: false,
        };
      }

      elements.progress.hidden = false;
      if (!currentSession.uploaded) {
        setStatus("Uploading video…");
        await uploadWithProgress(
          currentSession.upload_url,
          file,
          type.contentType,
          currentSession.max_file_size_bytes,
        );
        if (operationId !== operationSequence) return;
        currentSession.uploaded = true;
      }
      setStatus("Verifying upload and publishing the recording…");
      finalizing = true;
      elements.cancel.disabled = true;
      elements.cancel.textContent = "Finalizing…";
      elements.close.disabled = true;
      const finalized = await invokeFunction(
        "finalize-recorded-upload",
        payloadFor(file, type.contentType, currentSession.duration_seconds),
      );
      if (operationId !== operationSequence) return;
      if (finalized.live_class_id !== selectedLiveClass.id) {
        throw new Error("The recording service did not confirm the selected live class during finalization.");
      }
      const successMessage = replacementRecording
        ? "Recording replaced and verified."
        : "Recording uploaded and verified.";
      setStatus(
        `${finalized.cleanup_warning ? `${successMessage} ${finalized.cleanup_warning}` : successMessage} Opening Recorded Classes…`,
        "success",
      );
      elements.submit.disabled = true;
      elements.submit.textContent = "Uploaded";
      elements.cancel.disabled = false;
      elements.cancel.textContent = "Close";
      window.dispatchEvent(new CustomEvent("smart-learning-live-classes-updated"));
      window.setTimeout(() => window.location.assign("teacher_recorded_classes.html"), 1000);
    } catch (error) {
      if (error?.message === "Upload cancelled.") return;
      console.error("Live-class recording upload failed.", error);
      setStatus(
        `${error?.message || "The recording could not be uploaded."} ${
          replacementRecording
            ? "The existing recording remains unchanged until verification succeeds."
            : "No new recording is visible until verification succeeds."
        }`,
        "error",
      );
      if (!currentSession?.uploaded) currentSession = null;
    } finally {
      finalizing = false;
      elements.close.disabled = false;
      setBusy(false);
      if (elements.submit.textContent === "Uploaded") elements.submit.disabled = true;
      else {
        elements.cancel.disabled = false;
        elements.cancel.textContent = "Cancel";
      }
    }
  }

  function close() {
    if (finalizing) return;
    operationSequence += 1;
    if (activeRequest) activeRequest.abort();
    selectedLiveClass = null;
    replacementRecording = null;
    resetForm();
    if (elements.dialog.open) elements.dialog.close();
  }

  elements.form.addEventListener("submit", (event) => void submit(event));
  elements.cancel.addEventListener("click", close);
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) close();
  });

  window.TeacherRecordingUpload = { open };
})();
