(() => {
  const state = { client: null, user: null, teacher: null, groups: [], quizzes: [], subjects: new Map(), status: "all", query: "", grade: "", subject: "", page: 1, pageSize: 8, channel: null, loading: false, refreshQueued: false, scopeError: "" };
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

  function renderFilters() {
    const gradeSelect = $("quizClassFilter");
    const subjectSelect = $("quizSubjectFilter");
    const grades = [...new Set(state.quizzes.map((quiz) => String(quiz.grade || "")).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    const subjects = [...new Set(state.groups.flatMap((group) => group.subjects))]
      .sort((a, b) => a.localeCompare(b));
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
      return `<tr><td><div class="item-title"><div class="item-icon" aria-hidden="true"><i class="fa-solid fa-list-check"></i></div><div><div class="quiz-title-text">${escapeHtml(quiz.title || "Untitled quiz")}</div><div class="quiz-subtitle-text">${escapeHtml(quiz.description || "Question-based quiz")}</div></div></div></td><td>Grade ${escapeHtml(quiz.grade)}</td><td>${escapeHtml(subjectName(quiz))}</td><td>${escapeHtml(quiz.stream || "—")}</td><td>${Number(quiz.question_count || 0)}</td><td>${Number(quiz.total_marks || 0)}</td><td>${Number(quiz.duration_minutes || 0)} min</td><td><span class="badge-status status-${escapeHtml(status)}">${escapeHtml(status)}</span></td><td>${escapeHtml(created)}</td><td><span class="quiz-file-actions"><button type="button" data-action="view" data-id="${id}" title="View quiz" aria-label="View ${escapeHtml(quiz.title)}"><i class="fa-regular fa-eye"></i></button><button type="button" data-action="review" data-id="${id}" title="Review attempts and release results" aria-label="Review attempts for ${escapeHtml(quiz.title)}"><i class="fa-solid fa-clipboard-check"></i></button><button type="button" data-action="edit" data-id="${id}" title="Edit quiz" aria-label="Edit ${escapeHtml(quiz.title)}"><i class="fa-solid fa-pen"></i></button><button type="button" data-action="toggle" data-id="${id}" title="${status === "published" ? "Unpublish" : "Publish"}" aria-label="${status === "published" ? "Unpublish" : "Publish"} ${escapeHtml(quiz.title)}"><i class="fa-solid ${status === "published" ? "fa-eye-slash" : "fa-paper-plane"}"></i></button><button type="button" data-action="delete" data-id="${id}" title="Delete quiz" aria-label="Delete ${escapeHtml(quiz.title)}"><i class="fa-solid fa-trash-can"></i></button></span></td></tr>`;
    }).join("") : `<tr><td colspan="10" class="quiz-empty-state">${state.loading ? "Loading quizzes…" : "No quizzes found. Create your first question-based quiz."}</td></tr>`;
    $("quizPaginationSummary").textContent = filtered.length ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, filtered.length)} of ${filtered.length} quizzes` : "No quizzes to show";
    $("quizPaginationControls").innerHTML = filtered.length ? [`<button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`, ...Array.from({ length: pages }, (_, index) => `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`), `<button class="page-btn" data-page="${state.page + 1}" ${state.page === pages ? "disabled" : ""} aria-label="Next page">›</button>`].join("") : "";
    document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.classList.toggle("active", tab.dataset.status === state.status));
  }

  function render() {
    renderFilters();
    renderTable();
  }

  async function loadRegisteredScope() {
    state.scopeError = "";
    try {
      const gradeGroups = await window.TeacherData.loadRegisteredTeachingScope(state.client, state.teacher.id);
      state.groups = gradeGroups.map((group) => ({
        ...group,
        subjects: group.subjects.map((subject) => subject.name),
      }));
    } catch (error) {
      console.error("Registered scope loading error:", error);
      state.groups = [];
      state.scopeError = error.message || "Please try again.";
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
    const typeName = { mcq: "MCQ", true_false: "True/False" };
    let dialog = document.getElementById("quizViewDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "quizViewDialog";
      dialog.className = "quiz-view-dialog";
      document.body.appendChild(dialog);
    }
    dialog.innerHTML = `<form method="dialog"><button class="quiz-dialog-close" aria-label="Close">×</button></form><h2>${escapeHtml(quiz.title)}</h2><p>Grade ${escapeHtml(quiz.grade)}${quiz.stream ? ` · ${escapeHtml(quiz.stream)}` : ""} · ${escapeHtml(subjectName(quiz))}</p><p>${Number(quiz.question_count || 0)} questions · ${Number(quiz.total_marks || 0)} marks · ${Number(quiz.duration_minutes || 0)} minutes</p>${(questions || []).map((question, index) => `<article><h3>Question ${index + 1} · ${escapeHtml(typeName[question.question_type] || "Unsupported legacy question type")}</h3><p>${escapeHtml(question.question_text)}</p>${Array.isArray(question.options) ? `<ol type="A">${question.options.map((option) => `<li>${escapeHtml(option.text)}</li>`).join("")}</ol>` : ""}<p class="quiz-review-answer"><strong>Correct answer:</strong> ${escapeHtml(question.correct_answer)}</p><small>${Number(question.marks)} marks</small></article>`).join("")}`;
    dialog.showModal();
  }

  async function reviewQuiz(id) {
    const quiz = state.quizzes.find((item) => String(item.id) === String(id));
    if (!quiz) return;
    let data;
    try {
      const result = await state.client.rpc("get_teacher_quiz_review", {
        p_quiz_id: quiz.id,
      });
      if (result.error) throw result.error;
      data = result.data;
    } catch (error) {
      toast(`Could not load quiz attempts: ${error.message || "Please retry."}`, true);
      return;
    }

    let dialog = document.getElementById("quizReviewDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "quizReviewDialog";
      dialog.className = "quiz-view-dialog";
      document.body.appendChild(dialog);
    }
    dialog.dataset.quizId = String(quiz.id);
    const attempts = Array.isArray(data?.attempts) ? data.attempts : [];
    const attemptMarkup = attempts.map((attempt) => {
      const shortAnswers = (attempt.answers || []).filter(
        (answer) => answer.question_type === "short_answer" && answer.student_answer,
      );
      return `<article><h3>${escapeHtml(attempt.student_name || "Student")} · ${escapeHtml(attempt.student_id || "")}</h3><p>${escapeHtml(attempt.status)}${attempt.submitted_at ? ` · ${escapeHtml(new Date(attempt.submitted_at).toLocaleString())}` : ""}</p>${shortAnswers.length ? shortAnswers.map((answer) => `<form data-grade-answer class="quiz-grade-answer"><input type="hidden" name="attempt_id" value="${escapeHtml(attempt.attempt_id)}"><input type="hidden" name="question_id" value="${escapeHtml(answer.question_id)}"><h4>${escapeHtml(answer.question_text)}</h4><p><strong>Student response:</strong> ${escapeHtml(answer.student_answer)}</p><p>Maximum: ${Number(answer.marks)} marks${answer.graded_at ? ` · Previously awarded ${Number(answer.marks_awarded)} marks` : " · Needs grading"}</p><label>Marks awarded <input name="marks_awarded" type="number" min="0" max="${Number(answer.marks)}" step="0.01" value="${Number(answer.marks_awarded || 0)}" required></label> <label><input name="is_correct" type="checkbox" ${answer.is_correct ? "checked" : ""}> Mark correct</label> <button class="btn-primary" type="submit">Save grade</button></form>`).join("") : "<p>No short answers require manual grading.</p>"}</article>`;
    }).join("");
    const released = data?.results_released === true;
    dialog.innerHTML = `<form method="dialog"><button class="quiz-dialog-close" aria-label="Close">×</button></form><h2>Review results: ${escapeHtml(data?.title || quiz.title)}</h2><p>${attempts.length} recorded attempt(s). Results are ${released ? "published" : "not published"}.</p>${attemptMarkup || "<p>No attempts have been submitted yet.</p>"}<p id="quizReviewError" role="alert"></p>${released ? "" : `<button type="button" data-release-results class="btn-primary">Publish results to students</button>`}`;
    if (!dialog.open) dialog.showModal();
  }

  async function releaseQuizResults(id, dialog) {
    if (!window.confirm("Publish results for all submitted attempts?")) return;
    try {
      const { error } = await state.client.rpc("release_quiz_results", {
        p_quiz_id: id,
      });
      if (error) throw error;
      toast("Quiz results published to students.");
      await reviewQuiz(id);
    } catch (error) {
      const message = dialog.querySelector("#quizReviewError");
      if (message) message.textContent = error.message || "Results could not be published.";
    }
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
      notify(state.scopeError ? `Class and subject filters could not be loaded. ${state.scopeError}` : "");
      state.channel = state.client.channel(`teacher-quizzes-${teacher.id}`).on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${teacher.id}` }, () => { void reload(); }).subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) console.warn("Quiz realtime subscription is unavailable.", status);
      });
      window.addEventListener("beforeunload", () => {
        if (state.channel) void state.client.removeChannel(state.channel);
      }, { once: true });
    } catch (error) {
      console.error("Teacher loading error:", error);
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
    if (button.dataset.action === "review") void reviewQuiz(quiz.id);
    if (button.dataset.action === "edit") location.assign(`create_quiz.html?id=${encodeURIComponent(quiz.id)}`);
    if (button.dataset.action === "toggle") void setStatus(quiz);
    if (button.dataset.action === "delete") void deleteQuiz(quiz);
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-grade-answer]");
    if (!form) return;
    event.preventDefault();
    try {
      const formData = new FormData(form);
      const { error } = await state.client.rpc("grade_quiz_short_answer", {
        p_attempt_id: formData.get("attempt_id"),
        p_question_id: formData.get("question_id"),
        p_marks_awarded: Number(formData.get("marks_awarded")),
        p_is_correct: formData.get("is_correct") === "on",
      });
      if (error) throw error;
      const quizId = form.closest("dialog")?.dataset.quizId;
      if (quizId) void reviewQuiz(quizId);
    } catch (error) {
      const message = form.closest("dialog")?.querySelector("#quizReviewError");
      if (message) message.textContent = error.message || "The answer could not be graded.";
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-release-results]");
    if (!button) return;
    const dialog = button.closest("dialog");
    const quizId = dialog?.dataset.quizId;
    if (dialog && quizId) void releaseQuizResults(quizId, dialog);
  });
  document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.addEventListener("click", () => { state.status = tab.dataset.status; state.page = 1; renderTable(); }));
  void initialize();
})();
