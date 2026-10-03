(() => {
  const STREAM_LABELS = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };

  const state = {
    context: null,
    groups: [],
    busy: false,
  };

  const $ = (id) => document.getElementById(id);

  function setFieldError(inputId, errorId, message) {
    const input = $(inputId);
    const error = $(errorId);
    if (input) input.setAttribute("aria-invalid", String(Boolean(message)));
    if (error) error.textContent = message || "";
  }

  function clearErrors() {
    [
      ["announcementTitle", "titleError"],
      ["announcementMessage", "messageError"],
      ["announcementType", "typeError"],
      ["announcementGrade", "gradeError"],
      ["announcementStream", "streamError"],
      ["announcementSubject", "subjectError"],
      ["scheduleDate", "scheduleDateError"],
      ["scheduleTime", "scheduleTimeError"],
    ].forEach(([inputId, errorId]) => setFieldError(inputId, errorId, ""));
    $("createAnnouncementError").hidden = true;
    $("createAnnouncementError").textContent = "";
  }

  function showPageError(message) {
    const error = $("createAnnouncementError");
    error.textContent = message;
    error.hidden = false;
  }

  function selectedGroup() {
    const grade = Number($("announcementGrade").value);
    if (!Number.isInteger(grade)) return null;
    const stream = grade >= 11 ? $("announcementStream").value : null;
    return state.groups.find((group) => group.grade === grade && group.stream === stream) || null;
  }

  function loadSubjectOptions() {
    const group = selectedGroup();
    const subject = $("announcementSubject");
    const options = group?.subjects || [];
    subject.innerHTML = `<option value="__all_subjects__">All subjects</option>${
      options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")
    }`;
    subject.disabled = !group;
    setFieldError("announcementSubject", "subjectError", "");
    renderAudiencePreview();
  }

  function loadStreams() {
    const grade = Number($("announcementGrade").value);
    const streamField = $("streamField");
    const streamSelect = $("announcementStream");
    const isSenior = grade >= 11;
    streamField.hidden = !isSenior;
    streamSelect.required = isSenior;
    streamSelect.disabled = !isSenior;
    if (!isSenior) {
      streamSelect.value = "";
      loadSubjectOptions();
      return;
    }

    const streams = [...new Set(state.groups
      .filter((group) => group.grade === grade && Object.hasOwn(STREAM_LABELS, group.stream))
      .map((group) => group.stream))];
    streamSelect.innerHTML = `<option value="">Choose a registered stream</option>${streams
      .map((stream) => `<option value="${stream}">${STREAM_LABELS[stream]}</option>`).join("")}`;
    streamSelect.disabled = streams.length === 0;
    if (streams.length === 1) streamSelect.value = streams[0];
    setFieldError("announcementStream", "streamError", "");
    loadSubjectOptions();
  }

  function renderAudiencePreview() {
    const group = selectedGroup();
    const selectedSubject = $("announcementSubject");
    const subjectName = selectedSubject.selectedOptions[0]?.textContent;
    const parts = [];
    if (group) {
      parts.push(`Grade ${group.grade}`);
      if (group.grade >= 11) parts.push(STREAM_LABELS[group.stream] || group.stream);
      if (selectedSubject.value === "__all_subjects__") parts.push("All subjects");
      else if (selectedSubject.value && subjectName) parts.push(subjectName);
    }
    $("audiencePreviewText").textContent = parts.length
      ? parts.join(" · ")
      : "Select a class, stream, and subject.";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char]);
  }

  async function loadTeachingScope() {
    const context = await AnnouncementService.getTeacherContext();
    const [groupsResult, assignmentsResult] = await Promise.all([
      context.client
        .from("teacher_grade_groups")
        .select("grade, stream")
        .eq("teacher_id", context.teacher.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true }),
      context.client
        .from("teacher_subject_assignments")
        .select("grade, stream, subject_id")
        .eq("teacher_id", context.teacher.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true }),
    ]);
    if (groupsResult.error) throw groupsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const groups = (groupsResult.data || [])
      .map((item) => ({
        grade: Number(item.grade),
        stream: Number(item.grade) >= 11 ? String(item.stream || "").trim().toLowerCase() : null,
        subjects: [],
      }))
      .filter((item) => item.grade >= 5 && item.grade <= 12)
      .filter((item, index, all) => all.findIndex((candidate) =>
        candidate.grade === item.grade && candidate.stream === item.stream) === index);

    const assignments = (assignmentsResult.data || []).filter((assignment) => groups.some((group) =>
      group.grade === Number(assignment.grade)
      && group.stream === (group.grade >= 11 ? String(assignment.stream || "").trim().toLowerCase() : null),
    ));
    const subjectIds = [...new Set(assignments.map((assignment) => String(assignment.subject_id)).filter(Boolean))];
    let subjectsById = new Map();
    if (subjectIds.length) {
      const { data, error } = await context.client
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);
      if (error) throw error;
      subjectsById = new Map((data || []).map((subject) => [String(subject.id), subject]));
    }

    assignments.forEach((assignment) => {
      const grade = Number(assignment.grade);
      const stream = grade >= 11 ? String(assignment.stream || "").trim().toLowerCase() : null;
      const group = groups.find((item) => item.grade === grade && item.stream === stream);
      const subject = subjectsById.get(String(assignment.subject_id));
      if (!group || !subject?.name) return;
      if (!group.subjects.some((item) => String(item.id) === String(subject.id))) {
        group.subjects.push({ id: subject.id, name: subject.name });
      }
    });

    state.context = context;
    state.groups = groups;
    const gradeSelect = $("announcementGrade");
    const grades = [...new Set(groups.map((group) => group.grade))];
    gradeSelect.innerHTML = `<option value="">Choose a registered class</option>${grades
      .map((grade) => `<option value="${grade}">Grade ${grade}</option>`).join("")}`;
    gradeSelect.disabled = grades.length === 0;
    if (grades.length) {
      gradeSelect.value = String(grades[0]);
      loadStreams();
    } else {
      $("announcementSubject").innerHTML = '<option value="">No registered classes available</option>';
      showPageError("No registered classes between grades 5 and 12 are available for this account.");
    }
  }

  function validate(status) {
    clearErrors();
    let valid = true;
    const title = $("announcementTitle").value.trim();
    const message = $("announcementMessage").value.trim();
    if (!title) {
      setFieldError("announcementTitle", "titleError", "Enter an announcement title.");
      valid = false;
    } else if (title.length > 160) {
      setFieldError("announcementTitle", "titleError", "Title must be 160 characters or fewer.");
      valid = false;
    }
    if (!message) {
      setFieldError("announcementMessage", "messageError", "Enter the announcement message.");
      valid = false;
    } else if (message.length > 5000) {
      setFieldError("announcementMessage", "messageError", "Message must be 5,000 characters or fewer.");
      valid = false;
    }
    if (!AnnouncementService.TYPES.includes($("announcementType").value)) {
      setFieldError("announcementType", "typeError", "Choose an announcement type.");
      valid = false;
    }
    const grade = Number($("announcementGrade").value);
    const group = selectedGroup();
    if (!Number.isInteger(grade) || !group) {
      setFieldError("announcementGrade", "gradeError", "Choose one of your registered classes.");
      valid = false;
    }
    if (grade >= 11 && (!group || !Object.hasOwn(STREAM_LABELS, group.stream))) {
      setFieldError("announcementStream", "streamError", "Choose one of your registered streams.");
      valid = false;
    }
    if (grade >= 11 && !$("announcementStream").value) {
      setFieldError("announcementStream", "streamError", "Choose a registered stream.");
      valid = false;
    }
    const selectedSubject = $("announcementSubject").value;
    if (!group || (selectedSubject !== "__all_subjects__"
      && !group.subjects.some((subject) => String(subject.id) === selectedSubject))) {
      setFieldError("announcementSubject", "subjectError", "Choose a registered subject or All subjects.");
      valid = false;
    }
    if (status === "scheduled") {
      const dateValue = $("scheduleDate").value;
      const timeValue = $("scheduleTime").value;
      if (!dateValue) {
        setFieldError("scheduleDate", "scheduleDateError", "Choose a schedule date.");
        valid = false;
      }
      if (!timeValue) {
        setFieldError("scheduleTime", "scheduleTimeError", "Choose a schedule time.");
        valid = false;
      }
      if (dateValue && timeValue && new Date(`${dateValue}T${timeValue}`) <= new Date()) {
        setFieldError("scheduleTime", "scheduleTimeError", "Choose a future date and time.");
        valid = false;
      }
    }
    return valid;
  }

  function setBusy(busy, status) {
    state.busy = busy;
    $("submitAnnouncement").disabled = busy;
    $("saveAnnouncementDraft").disabled = busy;
    $("cancelCreateAnnouncement").disabled = busy;
    if (busy) {
      const label = status === "draft" ? "Saving draft…" : status === "scheduled" ? "Scheduling…" : "Publishing…";
      $("submitAnnouncement").querySelector("span").textContent = label;
    } else {
      updatePublishButton();
    }
  }

  function updatePublishButton() {
    const mode = document.querySelector('input[name="publishingMode"]:checked')?.value;
    const scheduled = mode === "scheduled";
    const draft = mode === "draft";
    $("scheduleFields").hidden = !scheduled;
    $("scheduleDate").required = scheduled;
    $("scheduleTime").required = scheduled;
    $("submitAnnouncement").querySelector("span").textContent = scheduled
      ? "Schedule Announcement"
      : draft ? "Save as Draft" : "Publish Now";
    $("submitAnnouncement").querySelector("i").className = scheduled
      ? "fa-regular fa-calendar-check"
      : draft ? "fa-regular fa-floppy-disk" : "fa-solid fa-paper-plane";
  }

  function returnToAnnouncements(status) {
    const destination = new URL("announcements.html", window.location.href);
    destination.searchParams.set("created", status);
    window.location.assign(destination.href);
  }

  async function submit(status) {
    if (state.busy || !validate(status)) return;
    const group = selectedGroup();
    const publishAt = status === "scheduled"
      ? new Date(`${$("scheduleDate").value}T${$("scheduleTime").value}`).toISOString()
      : null;
    setBusy(true, status);
    try {
      await AnnouncementService.createAnnouncement({
        groups: state.groups,
        title: $("announcementTitle").value,
        message: $("announcementMessage").value,
        type: $("announcementType").value,
        grade: group.grade,
        stream: group.stream,
        subject_id: $("announcementSubject").value === "__all_subjects__"
          ? null
          : $("announcementSubject").value,
        status,
        publish_at: publishAt,
      });
      returnToAnnouncements(status);
    } catch (error) {
      console.error("Announcement creation error:", error);
      const message = status === "draft"
        ? "Unable to save the draft. Check your connection and try again."
        : status === "scheduled"
          ? "Unable to schedule the announcement. Check your class, subject, and schedule time."
          : "Unable to publish the announcement. Check your class and subject, then try again.";
      const details = error?.message ? ` Details: ${error.message}` : "";
      showPageError(`${message}${details}`);
      setBusy(false, status);
    }
  }

  function cancel() {
    window.location.assign("announcements.html");
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("backToAnnouncements").addEventListener("click", cancel);
    $("cancelCreateAnnouncement").addEventListener("click", cancel);
    $("announcementGrade").addEventListener("change", loadStreams);
    $("announcementStream").addEventListener("change", loadSubjectOptions);
    $("announcementSubject").addEventListener("change", renderAudiencePreview);
    document.querySelectorAll('input[name="publishingMode"]').forEach((input) => {
      input.addEventListener("change", updatePublishButton);
    });
    $("announcementTitle").addEventListener("input", (event) => {
      $("titleCount").textContent = `${event.currentTarget.value.length}/160`;
    });
    $("announcementMessage").addEventListener("input", (event) => {
      $("messageCount").textContent = `${event.currentTarget.value.length}/5000`;
    });
    $("createAnnouncementForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const status = document.querySelector('input[name="publishingMode"]:checked')?.value;
      void submit(status);
    });
    $("saveAnnouncementDraft").addEventListener("click", () => void submit("draft"));
    updatePublishButton();
    loadTeachingScope().catch((error) => {
      console.error("Unable to load announcement teaching scope.", error);
      showPageError("Unable to load your registered classes and subjects. Refresh the page or try again.");
    });
  });
})();
