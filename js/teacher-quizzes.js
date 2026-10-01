(() => {
  const state = { client: null, user: null, teacher: null, groups: [], quizzes: [], subjects: new Map(), status: "all", query: "", grade: "", subject: "", page: 1, pageSize: 8, channel: null, loading: false, refreshQueued: false, scopeLoaded: false, scopeError: "" };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const subjectName = (quiz) => state.subjects.get(String(quiz.subject_id)) || quiz.subject_name || "Unknown subject";

  function toast(message, isError = false) {
    const region = $("quizToastRegion");
    if (!region) return;
    const node = document.createElement("div");
    node.className = `quiz-toast${isError ? " error" : ""}`;
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(() => node.remove(), 4500);
  }

  function notify(message, isError = false) {
    const element = $("quizPageMessage");
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle("is-error", isError);
    element.setAttribute("role", isError ? "alert" : "status");
  }

  function renderScope() {
    if (!state.scopeLoaded) return;
    if (state.scopeError) {
      $("classScopeValue").textContent = `Could not load registered scope: ${state.scopeError}`;
      return;
    }
    const values = state.groups.map((group) => {
      const header = `Grade ${group.grade}${group.stream ? ` · ${group.stream}` : ""}`;
      return `${header} · ${group.subjects.length ? group.subjects.join(", ") : "No subjects assigned"}`;
    });
    $("classScopeValue").textContent = values.length && values.some((value) => !value.endsWith("No subjects assigned"))
      ? values.join("  |  ")
      : "No registered classes or subjects found.";
  }

  function renderFilters() {
    const gradeSelect = $("quizClassFilter");
    const subjectSelect = $("quizSubjectFilter");
    const grades = [...new Set(state.quizzes.map((quiz) => String(quiz.grade || "")).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    const subjects = [...new Set(state.quizzes.map(subjectName))].sort((a, b) => a.localeCompare(b));
    gradeSelect.replaceChildren(new Option("All Grades", ""), ...grades.map((grade) => new Option(`Grade ${grade}`, grade)));
    subjectSelect.replaceChildren(new Option("All Subjects", ""), ...subjects.map((subject) => new Option(subject, subject)));
    gradeSelect.value = state.grade;
    subjectSelect.value = state.subject;
  }

  function renderTable() {
    const publishedCount = state.quizzes.filter((quiz) => String(quiz.status).toLowerCase() === "published").length;
    const draftCount = state.quizzes.filter((quiz) => String(quiz.status).toLowerCase() === "draft").length;
    [["allQuizCount", state.quizzes.length], ["publishedQuizCount", publishedCount], ["draftQuizCount", draftCount], ["quizTotal", state.quizzes.length], ["quizPublished", publishedCount], ["quizDrafts", draftCount]].forEach(([id, count]) => {
      const element = $(id);
      if (element) element.textContent = String(count);
    });
    const filtered = state.quizzes.filter((quiz) => {
      const status = String(quiz.status || "draft").toLowerCase();
      const values = `${quiz.title || ""} ${quiz.grade || ""} ${quiz.stream || ""} ${subjectName(quiz)}`.toLowerCase();
      return (state.status === "all" || status === state.status) && (!state.grade || String(quiz.grade) === state.grade) && (!state.subject || subjectName(quiz) === state.subject) && (!state.query || values.includes(state.query));
    }).sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
    const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    const rows = filtered.slice(start, start + state.pageSize);
    $("quizTableBody").innerHTML = rows.length ? rows.map((quiz) => {
      const id = escapeHtml(quiz.id);
      const status = String(quiz.status || "draft").toLowerCase();
      const created = quiz.created_at ? new Date(quiz.created_at).toLocaleDateString() : "—";
      return `<tr><td><div class="item-title"><div class="item-icon" aria-hidden="true"><i class="fa-solid fa-list-check"></i></div><div><div class="quiz-title-text">${escapeHtml(quiz.title || "Untitled quiz")}</div><div class="quiz-subtitle-text">${escapeHtml(quiz.description || "Question-based quiz")}</div></div></div></td><td>Grade ${escapeHtml(quiz.grade)}</td><td>${escapeHtml(subjectName(quiz))}</td><td>${escapeHtml(quiz.stream || "—")}</td><td>${Number(quiz.question_count || 0)}</td><td>${Number(quiz.total_marks || 0)}</td><td>${Number(quiz.duration_minutes || 0)} min</td><td><span class="badge-status status-${escapeHtml(status)}">${escapeHtml(status)}</span></td><td>${escapeHtml(created)}</td><td><span class="quiz-file-actions"><button type="button" data-action="view" data-id="${id}" title="View quiz" aria-label="View ${escapeHtml(quiz.title)}"><i class="fa-regular fa-eye"></i></button><button type="button" data-action="edit" data-id="${id}" title="Edit quiz" aria-label="Edit ${escapeHtml(quiz.title)}"><i class="fa-solid fa-pen"></i></button><button type="button" data-action="toggle" data-id="${id}" title="${status === "published" ? "Unpublish" : "Publish"}" aria-label="${status === "published" ? "Unpublish" : "Publish"} ${escapeHtml(quiz.title)}"><i class="fa-solid ${status === "published" ? "fa-eye-slash" : "fa-paper-plane"}"></i></button><button type="button" data-action="delete" data-id="${id}" title="Delete quiz" aria-label="Delete ${escapeHtml(quiz.title)}"><i class="fa-solid fa-trash-can"></i></button></span></td></tr>`;
    }).join("") : `<tr><td colspan="10" class="quiz-empty-state">${state.loading ? "Loading quizzes…" : "No quizzes found. Create your first question-based quiz."}</td></tr>`;
    $("quizPaginationSummary").textContent = filtered.length ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, filtered.length)} of ${filtered.length} quizzes` : "No quizzes to show";
    $("quizPaginationControls").innerHTML = filtered.length ? [`<button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`, ...Array.from({ length: pages }, (_, index) => `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`), `<button class="page-btn" data-page="${state.page + 1}" ${state.page === pages ? "disabled" : ""} aria-label="Next page">›</button>`].join("") : "";
    document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.classList.toggle("active", tab.dataset.status === state.status));
  }

  function render() {
    renderScope();
    renderFilters();
    renderTable();
  }

  async function loadRegisteredScope() {
    const scopeElement = $("classScopeValue");
    state.scopeLoaded = false;
    state.scopeError = "";
    scopeElement.textContent = "Loading registered classes...";
    try {
      const [groupResult, assignmentResult] = await Promise.all([
        state.client.from("teacher_grade_groups").select("grade, stream, teach_all_subjects").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
        state.client.from("teacher_subject_assignments").select("subject_id, grade, stream").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
      ]);
      if (groupResult.error) throw groupResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const gradeGroups = (groupResult.data || []).map((row) => ({
        grade: Number(row.grade),
        stream: row.stream || "",
        teach_all_subjects: Boolean(row.teach_all_subjects),
        subjects: [],
      }));
      const validKeys = new Set(gradeGroups.map((group) => `${group.grade}|${group.stream}`));
      const assignments = (assignmentResult.data || []).filter((row) => row.subject_id && validKeys.has(`${Number(row.grade)}|${row.stream || ""}`));
      const subjectIds = [...new Set(assignments.map((row) => String(row.subject_id)))];
      const hasTeachAll = gradeGroups.some((group) => group.teach_all_subjects);
      let subjectRows = [];
      if (subjectIds.length || hasTeachAll) {
        let subjectQuery = state.client.from("subjects").select("id, name");
        if (subjectIds.length && !hasTeachAll) subjectQuery = subjectQuery.in("id", subjectIds);
        const { data, error: subjectError } = await subjectQuery;
        if (subjectError) throw subjectError;
        subjectRows = data || [];
      }
      const subjectMap = new Map((subjectRows || []).map((subject) => [String(subject.id), subject.name]));

      gradeGroups.forEach((group) => {
        const groupAssignments = assignments.filter((row) => Number(row.grade) === group.grade && (row.stream || "") === group.stream);
        const names = group.teach_all_subjects
          ? [...subjectMap.values()]
          : groupAssignments.map((row) => subjectMap.get(String(row.subject_id))).filter(Boolean);
        group.subjects = [...new Set(names)].sort((left, right) => left.localeCompare(right));
      });
      state.groups = gradeGroups;
      state.scopeLoaded = true;
      renderScope();
    } catch (error) {
      console.error("Registered scope loading error:", error);
      state.groups = [];
      state.scopeLoaded = true;
      state.scopeError = error.message || "Please try again.";
      renderScope();
    }
  }

  async function loadQuizzes() {
    try {
      const { data: quizzes, error } = await state.client.from("quizzes")
        .select("id, teacher_id, title, grade, stream, subject_id, description, instructions, duration_minutes, status, total_marks, created_at, updated_at")
        .eq("teacher_id", state.teacher.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const quizRows = quizzes || [];
      const subjectIds = [...new Set(quizRows.map((quiz) => quiz.subject_id).filter(Boolean).map(String))];
      const quizIds = quizRows.map((quiz) => quiz.id);
      if (quizIds.length) {
        const [subjectResult, questionResults] = await Promise.all([
          subjectIds.length ? state.client.from("subjects").select("id, name").in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
          Promise.all(quizRows.map((quiz) => state.client.from("quiz_questions").select("id", { count: "exact", head: true }).eq("quiz_id", quiz.id))),
        ]);
        if (subjectResult.error) throw subjectResult.error;
        const questionCounts = new Map();
        questionResults.forEach((result, index) => {
          if (result.error) throw result.error;
          questionCounts.set(quizIds[index], result.count || 0);
        });
        (subjectResult.data || []).forEach((subject) => state.subjects.set(String(subject.id), subject.name));
        state.quizzes = quizRows.map((quiz) => ({ ...quiz, question_count: questionCounts.get(quiz.id) || 0 }));
      } else {
        state.quizzes = [];
      }
      render();
    } catch (error) {
      console.error("Quiz loading error:", error);
      throw new Error(`Could not load quizzes: ${error.message || "Please try again."}`);
    }
  }

  async function reload() {
    if (state.loading) {
      state.refreshQueued = true;
      return;
    }
    state.loading = true;
    try { await loadQuizzes(); }
    catch (error) { notify(error.message, true); }
    finally {
      state.loading = false;
      renderTable();
      if (state.refreshQueued) {
        state.refreshQueued = false;
        void reload();
      }
    }
  }

  async function showQuiz(id) {
    const quiz = state.quizzes.find((item) => String(item.id) === String(id));
    if (!quiz) return;
    const { data: questions, error } = await state.client.from("quiz_questions").select("question_number, question_type, question_text, options, correct_answer, marks").eq("quiz_id", quiz.id).order("question_number", { ascending: true });
    if (error) return toast(`Could not load quiz questions: ${error.message}`, true);
    const typeName = { mcq: "MCQ", true_false: "True/False", short_answer: "Short Answer" };
    let dialog = document.getElementById("quizViewDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "quizViewDialog";
      dialog.className = "quiz-view-dialog";
      document.body.appendChild(dialog);
    }
    dialog.innerHTML = `<form method="dialog"><button class="quiz-dialog-close" aria-label="Close">×</button></form><h2>${escapeHtml(quiz.title)}</h2><p>Grade ${escapeHtml(quiz.grade)}${quiz.stream ? ` · ${escapeHtml(quiz.stream)}` : ""} · ${escapeHtml(subjectName(quiz))}</p><p>${Number(quiz.question_count || 0)} questions · ${Number(quiz.total_marks || 0)} marks · ${Number(quiz.duration_minutes || 0)} minutes</p>${(questions || []).map((question, index) => `<article><h3>Question ${index + 1} · ${escapeHtml(typeName[question.question_type] || question.question_type)}</h3><p>${escapeHtml(question.question_text)}</p>${Array.isArray(question.options) ? `<ol type="A">${question.options.map((option) => `<li>${escapeHtml(option.text)}</li>`).join("")}</ol>` : ""}<p class="quiz-review-answer"><strong>Correct answer:</strong> ${escapeHtml(question.correct_answer)}</p><small>${Number(question.marks)} marks</small></article>`).join("")}`;
    dialog.showModal();
  }

  async function setStatus(quiz) {
    if (String(quiz.status).toLowerCase() !== "published") {
      location.assign(`create_quiz.html?id=${encodeURIComponent(quiz.id)}`);
      return;
    }
    const nextStatus = "draft";
    const { error } = await state.client.from("quizzes").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", quiz.id).eq("teacher_id", state.teacher.id);
    if (error) return toast(`Could not update quiz status: ${error.message}`, true);
    toast(`Quiz ${nextStatus === "published" ? "published" : "unpublished"}.`);
    await reload();
  }

  async function deleteQuiz(quiz) {
    if (!window.confirm(`Delete “${quiz.title}” and its questions?`)) return;
    const { error } = await state.client.from("quizzes").delete().eq("id", quiz.id).eq("teacher_id", state.teacher.id);
    if (error) return toast(`Could not delete quiz: ${error.message}`, true);
    toast("Quiz deleted.");
    await reload();
  }

  async function initialize() {
    notify("Loading your quizzes…");
    try {
      state.client = window.TeacherData?.getSupabaseClient?.();
      if (!state.client) throw new Error("Supabase client is unavailable.");
      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError) throw authError;
      if (!authData?.user) {
        notify("Sign in with a teacher account to view quizzes.", true);
        return location.assign("../teacher_registration/login.html");
      }
      state.user = authData.user;
      const { data: teacher, error: teacherError } = await state.client.from("teachers").select("id, user_id").eq("user_id", state.user.id).single();
      if (teacherError) throw teacherError;
      if (!teacher) throw new Error("Teacher profile was not found for this account.");
      state.teacher = teacher;
      await loadRegisteredScope();
      await loadQuizzes();
      notify("");
      state.channel = state.client.channel(`teacher-quizzes-${teacher.id}`).on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${teacher.id}` }, () => { void reload(); }).subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) console.warn("Quiz realtime subscription is unavailable.", status);
      });
      window.addEventListener("beforeunload", () => {
        if (state.channel) void state.client.removeChannel(state.channel);
      }, { once: true });
    } catch (error) {
      console.error("Teacher loading error:", error);
      if (!state.scopeLoaded) {
        state.scopeLoaded = true;
        state.scopeError = error.message || "Could not load teacher profile.";
        renderScope();
      }
      notify(error.message || "Could not load quiz management.", true);
      $("quizTableBody").innerHTML = `<tr><td colspan="10" class="quiz-empty-state">${escapeHtml(error.message || "Quiz data could not be loaded.")}</td></tr>`;
    }
  }

  $("quizSearch").addEventListener("input", (event) => { state.query = event.target.value.trim().toLowerCase(); state.page = 1; renderTable(); });
  $("quizClassFilter").addEventListener("change", (event) => { state.grade = event.target.value; state.page = 1; renderTable(); });
  $("quizSubjectFilter").addEventListener("change", (event) => { state.subject = event.target.value; state.page = 1; renderTable(); });
  $("quizPaginationControls").addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button && !button.disabled) { state.page = Number(button.dataset.page); renderTable(); } });
  $("quizTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const quiz = state.quizzes.find((item) => String(item.id) === button.dataset.id);
    if (!quiz) return;
    if (button.dataset.action === "view") void showQuiz(quiz.id);
    if (button.dataset.action === "edit") location.assign(`create_quiz.html?id=${encodeURIComponent(quiz.id)}`);
    if (button.dataset.action === "toggle") void setStatus(quiz);
    if (button.dataset.action === "delete") void deleteQuiz(quiz);
  });
  document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.addEventListener("click", () => { state.status = tab.dataset.status; state.page = 1; renderTable(); }));
  void initialize();
})();
