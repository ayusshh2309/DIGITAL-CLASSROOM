(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    assignments: [],
    assignmentMap: new Map(),
    quizzes: [],
    status: "all",
    query: "",
    gradeFilter: "",
    subjectFilter: "",
    page: 1,
    pageSize: 8,
    loading: false,
    channel: null,
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

  const notify = (message, isError = false) => {
    const element = $("quizPageMessage");
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle("is-error", Boolean(isError));
    element.setAttribute("role", isError ? "alert" : "status");
  };

  const toast = (message, isError = false) => {
    const region = $("quizToastRegion");
    if (!region) return;
    const node = document.createElement("div");
    node.className = `quiz-toast${isError ? " error" : ""}`;
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(() => node.remove(), 5000);
  };

  const normalizedStream = (stream) => (stream == null ? "" : String(stream).trim());
  const assignmentKey = (grade, stream) => `${Number(grade)}|${normalizedStream(stream)}`;

  function parseQuizGrade(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const match = String(value).match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function subjectName(quiz) {
    if (!quiz) return "";
    if (Array.isArray(quiz.subjects)) {
      return quiz.subjects[0]?.name || quiz.subject_name || quiz.subject || "";
    }
    if (quiz.subjects && typeof quiz.subjects === "object") {
      return quiz.subjects.name || quiz.subject_name || quiz.subject || "";
    }
    return quiz.subject_name || quiz.subject || "";
  }

  function typeLabel(fileName = "") {
    const extension = String(fileName).split(".").pop().toUpperCase();
    return extension || "FILE";
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
  }

  function safeFileName(name) {
    const trimmed = String(name || "quiz-file").split(/[\\/]/).pop();
    return trimmed
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "quiz-file";
  }

  function validateFile(file) {
    if (!file || !file.name) throw new Error("Select a quiz file.");
    if (!file.size) throw new Error("The selected file is empty.");
    if (file.size > 25 * 1024 * 1024) throw new Error("Quiz files must be 25 MB or smaller.");

    const extension = String(file.name).split(".").pop().toLowerCase();
    const mime = String(file.type || "").toLowerCase();
    const allowedMime = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-word",
    ]);
    const allowedExt = new Set(["pdf", "doc", "docx"]);

    if (!allowedExt.has(extension) && !allowedMime.has(mime)) {
      throw new Error("Only PDF, DOC, and DOCX quiz files are supported.");
    }
  }

  function getGradeStreamOptions(grade) {
    const rows = state.groups.filter((row) => Number(row.grade) === Number(grade));
    return [...new Set(rows.map((row) => normalizedStream(row.stream)))].sort((left, right) => left.localeCompare(right));
  }

  function renderScope() {
    const scopeText = [...new Set(state.groups.map((row) => `Grade ${row.grade}${row.stream ? ` · ${row.stream}` : ""}`))]
      .sort((left, right) => left.localeCompare(right))
      .join(" • ");
    $("classScopeValue").textContent = scopeText || "No registered grades found.";
  }

  function renderGrades() {
    const select = $("quizUploadGrade");
    const grades = [...new Set(state.groups.map((row) => Number(row.grade)))].sort((left, right) => left - right);
    select.replaceChildren(new Option("Select registered grade", ""));
    grades.forEach((grade) => select.add(new Option(`Grade ${grade}`, String(grade))));
    select.disabled = !grades.length;
    if (grades.length && !select.value) select.value = String(grades[0]);
    renderStreams();
  }

  function renderStreams() {
    const grade = Number($("quizUploadGrade").value);
    const streamSelect = $("quizUploadStream");
    const streamWrap = $("quizUploadStreamWrap");
    const streams = getGradeStreamOptions(grade);
    streamSelect.replaceChildren(new Option("Select stream", ""));

    if (streams.length && streams.some(Boolean)) {
      streams.forEach((stream) => streamSelect.add(new Option(stream || "General / no stream", stream)));
      streamWrap.hidden = false;
      streamSelect.disabled = false;
      streamSelect.required = streams.length > 1;
      if (!streamSelect.value && streams.length === 1) streamSelect.value = streams[0];
    } else {
      streamSelect.add(new Option("General / no stream", ""));
      streamWrap.hidden = true;
      streamSelect.disabled = true;
      streamSelect.required = false;
      streamSelect.value = "";
    }

    renderSubjects();
  }

  function renderSubjects() {
    const grade = Number($("quizUploadGrade").value);
    const stream = $("quizUploadStream").value || "";
    const rows = state.assignmentMap.get(assignmentKey(grade, stream)) || [];
    const subjectSelect = $("quizUploadSubject");
    subjectSelect.replaceChildren(new Option(rows.length ? "Select assigned subject" : "No subjects registered for this class", ""));
    rows
      .slice()
      .sort((left, right) => left.subject.localeCompare(right.subject))
      .forEach((row) => {
        const value = row.subject_id ? String(row.subject_id) : String(row.subject);
        subjectSelect.add(new Option(row.subject, value));
      });
    subjectSelect.disabled = !rows.length;
  }

  function currentAssignment() {
    const grade = Number($("quizUploadGrade").value);
    const stream = $("quizUploadStream").value || "";
    const subjectValue = $("quizUploadSubject").value;
    const matchingGroups = state.groups.filter((row) => Number(row.grade) === grade);

    if (!matchingGroups.length) throw new Error("Select a registered grade.");
    if (matchingGroups.some((row) => row.stream) && !matchingGroups.some((row) => String(row.stream || "") === String(stream))) {
      throw new Error("The selected stream is not registered for this teacher.");
    }

    const matches = (state.assignmentMap.get(assignmentKey(grade, stream)) || []).filter((row) => {
      const subjectId = row.subject_id ? String(row.subject_id) : String(row.subject);
      return String(subjectId) === String(subjectValue);
    });

    if (!matches.length) {
      throw new Error("Select a subject assigned to your teacher profile for this grade and stream.");
    }

    return { grade, stream: stream || null, item: matches[0] };
  }

  async function resolveSignedUrl(quiz) {
    const path = quiz.file_path;
    if (!path) return "";
    try {
      const bucketName = quiz.storage_bucket || "quizzes";
      const { data, error } = await state.client.storage.from(bucketName).createSignedUrl(path, 3600);
      if (error) {
        console.warn("Unable to create a signed URL for a quiz file.", error);
        return "";
      }
      return data?.signedUrl || "";
    } catch (error) {
      console.warn("Unexpected signed URL error.", error);
      return "";
    }
  }

  async function loadScope() {
    const [gradeResult, assignmentResult] = await Promise.all([
      state.client
        .from("teacher_grade_groups")
        .select("grade, stream")
        .eq("teacher_id", state.teacher.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true }),
      state.client
        .from("teacher_subject_assignments")
        .select("grade, stream, subject_id, subject, subjects(id, name)")
        .eq("teacher_id", state.teacher.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true }),
    ]);

    if (gradeResult.error) throw new Error(`Could not load registered grades. ${gradeResult.error.message}`);
    if (assignmentResult.error) throw new Error(`Could not load registered subjects. ${assignmentResult.error.message}`);

    const gradeGroups = (gradeResult.data || []).filter((row) => row && Number.isFinite(Number(row.grade)));
    const assignmentRows = assignmentResult.data || [];
    const validKeys = new Set(gradeGroups.map((row) => assignmentKey(row.grade, row.stream)));
    const subjectIds = [...new Set(assignmentRows.map((row) => row.subject_id).filter(Boolean))];

    let subjectMap = new Map();
    if (subjectIds.length) {
      const { data: subjectsData, error: subjectError } = await state.client.from("subjects").select("id, name").in("id", subjectIds);
      if (subjectError) throw new Error(`Could not load the teacher's assigned subjects. ${subjectError.message}`);
      (subjectsData || []).forEach((subject) => { subjectMap.set(String(subject.id), subject.name); });
    }

    state.groups = gradeGroups.map((row) => ({ grade: Number(row.grade), stream: normalizedStream(row.stream) || null }));
    state.assignmentMap = new Map();
    state.assignments = [];

    assignmentRows.forEach((row) => {
      const grade = Number(row.grade);
      const stream = normalizedStream(row.stream);
      const key = assignmentKey(grade, stream);
      if (!validKeys.has(key)) return;

      const subjectId = row.subject_id ? String(row.subject_id) : null;
      const subjectNameValue = subjectId
        ? subjectMap.get(subjectId) || (Array.isArray(row.subjects) ? row.subjects[0]?.name : row.subjects?.name) || row.subject || "Unknown subject"
        : row.subject || (Array.isArray(row.subjects) ? row.subjects[0]?.name : row.subjects?.name) || "Unknown subject";

      if (!subjectNameValue) return;
      const item = { grade, stream: stream || null, subject_id: row.subject_id || null, subject: subjectNameValue };
      state.assignments.push(item);
      if (!state.assignmentMap.has(key)) state.assignmentMap.set(key, []);
      state.assignmentMap.get(key).push(item);
    });

    renderGrades();
    renderScope();
    if (!state.groups.length) {
      notify("No registered grades found for this teacher.", true);
      return;
    }
    if (!state.assignmentMap.size) {
      notify("No subjects registered for this teacher.", true);
      return;
    }
    notify("");
  }

  async function loadQuizzes() {
    let queryResult = await state.client
      .from("quizzes")
      .select("id, teacher_id, grade, stream, subject_id, subject, title, description, file_name, file_path, storage_bucket, file_size, mime_type, created_at, updated_at, subjects(name)")
      .eq("teacher_id", state.teacher.id)
      .order("created_at", { ascending: false });

    if (queryResult.error && /subject_id|subjects|file_path|storage_bucket|file_name/i.test(queryResult.error.message)) {
      queryResult = await state.client
        .from("quizzes")
        .select("id, teacher_id, grade, stream, subject, title, description, file_name, file_path, storage_bucket, file_size, mime_type, created_at, updated_at")
        .eq("teacher_id", state.teacher.id)
        .order("created_at", { ascending: false });
    }

    if (queryResult.error) throw new Error(`Could not load quizzes. ${queryResult.error.message}`);

    const items = await Promise.all((queryResult.data || []).map(async (quiz) => {
      const normalizedGrade = parseQuizGrade(quiz.grade ?? quiz.class_grade ?? "");
      const normalizedSubject = subjectName(quiz) || quiz.subject || "Unknown subject";
      return {
        ...quiz,
        grade: normalizedGrade,
        subject_name: normalizedSubject,
        status: String(quiz.status || "published").toLowerCase(),
        file_url: await resolveSignedUrl(quiz),
      };
    }));

    state.quizzes = items.filter((quiz) => String(quiz.teacher_id) === String(state.teacher.id));
    renderPage();
  }

  function renderFilterOptions() {
    const gradeFilter = $("quizClassFilter");
    const subjectFilter = $("quizSubjectFilter");
    const grades = [...new Set(state.quizzes.map((quiz) => String(quiz.grade ?? "")).filter(Boolean))].sort((left, right) => Number(left) - Number(right));
    const subjects = [...new Set(state.quizzes.map((quiz) => subjectName(quiz)).filter(Boolean))].sort((left, right) => left.localeCompare(right));

    gradeFilter.replaceChildren(new Option("All Grades", ""));
    grades.forEach((grade) => gradeFilter.add(new Option(`Grade ${grade}`, grade)));
    subjectFilter.replaceChildren(new Option("All Subjects", ""));
    subjects.forEach((subject) => subjectFilter.add(new Option(subject, subject)));

    if (state.gradeFilter && grades.includes(String(state.gradeFilter))) gradeFilter.value = String(state.gradeFilter);
    if (state.subjectFilter && subjects.includes(state.subjectFilter)) subjectFilter.value = state.subjectFilter;
  }

  function renderQuizzesTable() {
    const rows = [...state.quizzes].filter((quiz) => {
      const gradeText = String(quiz.grade ?? "");
      const subjectText = subjectName(quiz) || "";
      const status = String(quiz.status || "published").toLowerCase();
      const searchValue = `${quiz.title || ""} ${gradeText} ${quiz.stream || ""} ${subjectText} ${quiz.file_name || ""}`.toLowerCase();
      return (!state.status || state.status === "all" || status === state.status) &&
        (!state.gradeFilter || gradeText === String(state.gradeFilter)) &&
        (!state.subjectFilter || subjectText === state.subjectFilter) &&
        (!state.query || searchValue.includes(state.query.toLowerCase()));
    });

    const orderedRows = [...rows].sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
    const pages = Math.max(1, Math.ceil(orderedRows.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    const visibleRows = orderedRows.slice(start, start + state.pageSize);

    $("quizTableBody").innerHTML = visibleRows.length ? visibleRows.map((quiz) => {
      const fileUrl = quiz.file_url || "";
      const subject = subjectName(quiz) || "N/A";
      const title = quiz.title || "Untitled quiz";
      const description = quiz.description || "Uploaded quiz";
      const fileName = quiz.file_name || "Quiz file";
      const uploadedAt = quiz.created_at ? new Date(quiz.created_at).toLocaleString() : "N/A";
      const status = String(quiz.status || "published");
      const safeDownload = fileUrl ? `<a href="${fileUrl}" target="_blank" rel="noopener" title="Open quiz"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : "";
      const safeDownloadLink = fileUrl ? `<a href="${fileUrl}" download="${encodeURIComponent(fileName)}" title="Download quiz"><i class="fa-solid fa-download"></i></a>` : "";
      return `
        <tr>
          <td>
            <div class="item-title">
              <div class="item-icon" style="background: var(--primary-teal)"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></div>
              <div>
                <div class="quiz-title-text">${escapeHtml(title)}</div>
                <div class="quiz-subtitle-text">${escapeHtml(description)}</div>
              </div>
            </div>
          </td>
          <td>${quiz.grade != null ? `Grade ${escapeHtml(String(quiz.grade))}` : "N/A"}</td>
          <td>${escapeHtml(subject)}</td>
          <td>${escapeHtml(quiz.stream || "General")}</td>
          <td>${escapeHtml(fileName)}</td>
          <td>${escapeHtml(uploadedAt)}</td>
          <td><span class="metric-cell"><strong>${escapeHtml(typeLabel(fileName))}</strong><small>${escapeHtml(formatSize(quiz.file_size))}</small></span></td>
          <td><span class="badge-status status-${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span></td>
          <td>
            <span class="quiz-file-actions">
              ${safeDownload}
              ${safeDownloadLink}
              <button type="button" data-delete="${quiz.id}" title="Delete quiz" aria-label="Delete quiz"><i class="fa-solid fa-trash-can"></i></button>
            </span>
          </td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="9" class="quiz-empty-state">${state.loading ? "Loading quizzes..." : "No quizzes uploaded yet."}</td></tr>`;

    $("quizPaginationSummary").textContent = orderedRows.length ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, orderedRows.length)} of ${orderedRows.length} quizzes` : "No quizzes uploaded yet";
    $("quizPaginationControls").innerHTML = orderedRows.length ? [
      `<button class="page-btn" data-page="${state.page - 1}" aria-label="Previous page" ${state.page === 1 ? "disabled" : ""}>&lsaquo;</button>`,
      ...Array.from({ length: pages }, (_, index) => `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`),
      `<button class="page-btn" data-page="${state.page + 1}" aria-label="Next page" ${state.page === pages ? "disabled" : ""}>&rsaquo;</button>`,
    ].join("") : "";
  }

  function renderPage() {
    renderScope();
    renderFilterOptions();
    renderQuizzesTable();
    document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.classList.toggle("active", tab.dataset.status === state.status));
  }

  async function reloadQuizList() {
    if (state.loading) return;
    state.loading = true;
    try {
      await loadQuizzes();
    } catch (error) {
      console.error("Failed to refresh the quiz list.", error);
      notify(error.message || "Could not refresh quizzes.", true);
    } finally {
      state.loading = false;
      renderPage();
    }
  }

  async function uploadQuiz(event) {
    event.preventDefault();
    const fileInput = $("quizUploadFile");
    const title = $("quizUploadTitle").value.trim();
    const description = $("quizUploadDescription").value.trim();
    const button = $("quizUploadSubmit");
    const file = fileInput.files[0];

    try {
      if (!state.teacher?.id) throw new Error("Authentication required.");
      if (!title) throw new Error("Enter a quiz title before uploading.");
      const selection = currentAssignment();
      validateFile(file);

      button.disabled = true;
      button.textContent = "Uploading quiz...";
      notify("Uploading quiz to Supabase Storage...");

      const storagePath = `${state.teacher.id}/${selection.grade}/${selection.item.subject_id || selection.item.subject}/${window.crypto.randomUUID()}-${safeFileName(file.name)}`;
      const uploadResult = await state.client.storage.from("quizzes").upload(storagePath, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (uploadResult.error) throw new Error(`Storage upload failed: ${uploadResult.error.message}`);

      const metadataPayload = {
        teacher_id: state.teacher.id,
        grade: selection.grade,
        stream: selection.stream,
        subject_id: selection.item.subject_id || null,
        subject: selection.item.subject,
        title,
        description: description || null,
        file_name: file.name,
        file_path: storagePath,
        storage_bucket: "quizzes",
        file_size: file.size,
        mime_type: file.type || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      notify("Saving quiz metadata...");
      let insertResult = await state.client
        .from("quizzes")
        .insert(metadataPayload)
        .select("id, teacher_id, grade, stream, subject_id, subject, title, description, file_name, file_path, storage_bucket, file_size, mime_type, created_at, updated_at")
        .single();

      if (insertResult.error && /subject_id|teacher_id|file_path|file_name|storage_bucket|grade|stream/i.test(insertResult.error.message)) {
        const legacyPayload = {
          teacher_id: state.teacher.user_id || state.user.id,
          title,
          grade: String(selection.grade),
          class_grade: `Class ${selection.grade}`,
          stream: selection.stream,
          subject: selection.item.subject,
          topic: title,
          description: description || null,
          file_name: file.name,
          file_path: storagePath,
          storage_bucket: "quizzes",
          file_size: file.size,
          mime_type: file.type || null,
          status: "published",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        insertResult = await state.client
          .from("quizzes")
          .insert(legacyPayload)
          .select("id, teacher_id, grade, stream, subject, title, description, file_name, file_path, storage_bucket, file_size, mime_type, created_at, updated_at")
          .single();
      }

      if (insertResult.error) {
        const cleanupResult = await state.client.storage.from("quizzes").remove([storagePath]);
        if (cleanupResult.error) {
          console.error("Could not clean up uploaded file after database insert failure.", cleanupResult.error);
        }
        throw new Error(`Database save failed: ${insertResult.error.message}`);
      }

      $("quizUploadForm").reset();
      $("quizUploadGrade").value = "";
      $("quizUploadStream").value = "";
      $("quizUploadSubject").value = "";
      toast("Quiz uploaded successfully.", false);
      notify("");
      await reloadQuizList();
    } catch (error) {
      console.error("Quiz upload failed.", error);
      toast(error.message || "Upload failed.", true);
      notify(error.message || "Upload failed.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Upload quiz";
      if (fileInput) fileInput.value = "";
    }
  }

  async function deleteQuiz(quizId) {
    const quiz = state.quizzes.find((item) => String(item.id) === String(quizId));
    if (!quiz) return;

    const confirmed = window.confirm(`Delete "${quiz.title || "Quiz"}" and its uploaded file?`);
    if (!confirmed) return;

    try {
      const storageBucket = quiz.storage_bucket || "quizzes";
      const storagePath = quiz.file_path;
      if (storagePath) {
        const { error: storageError } = await state.client.storage.from(storageBucket).remove([storagePath]);
        if (storageError) throw new Error(`Storage deletion failed: ${storageError.message}`);
      }

      const { error: deleteError } = await state.client.from("quizzes").delete().eq("id", quiz.id).eq("teacher_id", state.teacher.id);
      if (deleteError) throw new Error(`Database delete failed: ${deleteError.message}`);

      state.quizzes = state.quizzes.filter((item) => String(item.id) !== String(quiz.id));
      renderPage();
      toast("Quiz deleted.", false);
    } catch (error) {
      console.error("Quiz deletion failed.", error);
      toast(error.message || "Delete failed.", true);
      notify(error.message || "Delete failed.", true);
    }
  }

  function setupRealtime() {
    if (state.channel) state.client.removeChannel(state.channel);
    state.channel = state.client.channel(`teacher-quizzes-${state.teacher.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${state.teacher.id}` }, () => {
        void reloadQuizList();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Realtime is not enabled for public.quizzes. Add it to the supabase_realtime publication.", status);
        }
      });
  }

  async function initialize() {
    notify("Loading teacher data...");
    try {
      state.client = window.TeacherData?.getSupabaseClient?.();
      if (!state.client) throw new Error("Supabase client is unavailable.");

      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError) {
        if (authError.name === "AuthSessionMissingError" || authError.code === "session_not_found") {
          window.location.assign("../teacher_registration/login.html");
          return;
        }
        throw authError;
      }
      if (!authData?.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      state.user = authData.user;

      const { data: teacherRecord, error: teacherError } = await state.client.from("teachers").select("id, user_id, full_name").eq("user_id", state.user.id).maybeSingle();
      if (teacherError) throw new Error(`Could not load teacher profile. ${teacherError.message}`);
      if (!teacherRecord) throw new Error("Teacher profile not found for the authenticated account.");
      state.teacher = teacherRecord;

      await loadScope();
      await loadQuizzes();
      renderPage();
      setupRealtime();
    } catch (error) {
      console.error("Quiz page initialization failed.", error);
      notify(error.message || "Could not load the quiz page.", true);
      $("quizUploadSubmit").disabled = true;
      $("quizTableBody").innerHTML = `<tr><td colspan="9" class="quiz-empty-state">${escapeHtml(error.message || "Quiz data could not be loaded.")}</td></tr>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("quizUploadGrade").addEventListener("change", renderStreams);
    $("quizUploadStream").addEventListener("change", renderSubjects);
    $("quizUploadForm").addEventListener("submit", uploadQuiz);
    $("quizSearch").addEventListener("input", (event) => {
      state.query = event.target.value.trim();
      state.page = 1;
      renderPage();
    });
    $("quizClassFilter").addEventListener("change", (event) => {
      state.gradeFilter = event.target.value;
      state.page = 1;
      renderPage();
    });
    $("quizSubjectFilter").addEventListener("change", (event) => {
      state.subjectFilter = event.target.value;
      state.page = 1;
      renderPage();
    });
    $("quizSort").addEventListener("change", () => {
      state.page = 1;
      renderPage();
    });
    document.querySelectorAll(".tab[data-status]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.status = tab.dataset.status;
        state.page = 1;
        renderPage();
      });
    });
    $("quizTableBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete]");
      if (button) void deleteQuiz(button.dataset.delete);
    });
    $("quizPaginationControls").addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (button && !button.disabled && button.dataset.page) {
        state.page = Number(button.dataset.page);
        renderPage();
      }
    });
    $("createQuizBtn").addEventListener("click", () => $("quizUploadForm").scrollIntoView({ behavior: "smooth", block: "center" }));
    $("questionBankBtn").addEventListener("click", () => toast("Question bank is available in a future update.", false));
    void initialize();
  });
})();
