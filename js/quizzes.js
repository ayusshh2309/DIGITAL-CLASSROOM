(() => {
  const publishedQuizId = new URLSearchParams(location.search).get("published");
  const state = { quizzes: [], attempts: null, user: null, status: publishedQuizId ? "published" : "all", query: "", classFilter: "", subjectFilter: "", page: 1, pageSize: 6, publishedQuizId, focusPublishedQuiz: Boolean(publishedQuizId), attemptChannel: null };
  const localQuizKey = "smartLearningDC_published_quizzes";
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const valueOf = (item, names, fallback = "") => names.map((name) => item[name]).find((value) => value !== undefined && value !== null && value !== "") ?? fallback;
  const statusOf = (quiz) => String(valueOf(quiz, ["status"], "draft")).toLowerCase();
  const supabase = () => window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.();
  const toast = (message, kind = "") => { const node = document.createElement("div"); node.className = `quiz-toast ${kind}`; node.textContent = message; $("quizToastRegion").appendChild(node); setTimeout(() => node.remove(), 4000); };
  const formatDate = (value) => value ? new Date(value).toLocaleString() : "-";

  function localQuizzes() {
    try {
      const records = JSON.parse(localStorage.getItem(localQuizKey) || "[]");
      return Array.isArray(records) ? records.map((quiz) => ({
        ...quiz,
        id: quiz.id || `local-${quiz.createdAt || Date.now()}`,
        created_at: quiz.created_at || quiz.createdAt,
        updated_at: quiz.updated_at || quiz.updatedAt || quiz.createdAt,
        class_grade: quiz.class_grade || quiz.class || "-",
        question_count: quiz.question_count ?? quiz.questions?.length ?? 0,
        topic: quiz.topic || quiz.chapter || quiz.description || "General quiz",
      })) : [];
    } catch (error) {
      return [];
    }
  }

  function renderRegisteredClassScope() {
    const scopeValue = $("classScopeValue");
    if (!scopeValue) return;
    const professional = window.TeacherData?.getTeacherData?.()?.professional || {};
    const assignments = professional.specialistAssignments || professional.specialist_assignments || [];
    const groupGrades = { grades_5_6: [5, 6], grades_7_8: [7, 8], grades_9_10: [9, 10], grades_11_12: [11, 12] };
    const savedGroups = Array.isArray(professional.selected_grade_groups)
      ? professional.selected_grade_groups.flatMap((group) => groupGrades[group] || [])
      : [];
    const savedGrades = Array.isArray(professional.grades)
      ? professional.grades
      : Array.isArray(professional.selected_grades) ? professional.selected_grades : [];
    const grades = [...new Set((savedGroups.length ? savedGroups : savedGrades).map(Number).filter(Boolean))].sort((a, b) => a - b);
    const streamSubjects = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts_humanities: ["History", "Geography", "Political Science", "Psychology"],
    };
    const selectedStreams = professional.streams || professional.selected_streams || [];
    const seniorSubjects = [...new Set([...selectedStreams.flatMap((stream) => streamSubjects[stream] || []), "English", "Physical Education", "Computer Science"])];
    const standardSubjects = {
      5: ["English", "Mathematics", "EVS", "Hindi"],
      6: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      7: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      8: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      9: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      10: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    const classes = new Map();
    const addSubject = (grade, subject) => {
      const number = Number(grade);
      if (!number || !subject) return;
      if (!classes.has(number)) classes.set(number, new Set());
      classes.get(number).add(subject);
    };
    if (assignments.length) {
      assignments.forEach((assignment) => (assignment.grades || []).forEach((grade) => addSubject(grade, assignment.subject)));
    } else {
      grades.forEach((grade) => (grade >= 11 ? seniorSubjects : standardSubjects[grade] || []).forEach((subject) => addSubject(grade, subject)));
    }
    const selectedClasses = [...classes.entries()].sort(([first], [second]) => first - second);
    scopeValue.textContent = selectedClasses.length
      ? selectedClasses.map(([grade, subjects]) => `Class ${grade} · ${subjects.size} ${subjects.size === 1 ? "subject" : "subjects"}`).join("  •  ")
      : "No registered classes found";
  }

  function mergeQuizzes(remote, local) {
    const merged = new Map(remote.map((quiz) => [String(quiz.id), quiz]));
    local.forEach((quiz) => { if (!merged.has(String(quiz.id))) merged.set(String(quiz.id), quiz); });
    return Array.from(merged.values());
  }

  function filtered() {
    const query = state.query.toLowerCase(); const rows = state.quizzes.filter((quiz) => { const classValue = String(valueOf(quiz, ["class_grade", "grade", "class"], "")); const subjectValue = String(valueOf(quiz, ["subject"], "")); const text = [valueOf(quiz, ["title", "name"]), classValue, subjectValue, valueOf(quiz, ["topic", "chapter"])].join(" ").toLowerCase(); return (state.status === "all" || statusOf(quiz) === state.status) && (!state.classFilter || classValue === state.classFilter) && (!state.subjectFilter || subjectValue === state.subjectFilter) && (!query || text.includes(query)); });
    const sort = $("quizSort").value; return rows.sort((a, b) => { if (sort === "az") return valueOf(a, ["title", "name"]).localeCompare(valueOf(b, ["title", "name"])); if (sort === "za") return valueOf(b, ["title", "name"]).localeCompare(valueOf(a, ["title", "name"])); const left = new Date(valueOf(a, ["updated_at", "created_at"])).getTime() || 0; const right = new Date(valueOf(b, ["updated_at", "created_at"])).getTime() || 0; return sort === "oldest" ? left - right : right - left; });
  }

  function withAttemptAnalytics(quizzes) {
    if (!Array.isArray(state.attempts)) return quizzes;
    const grouped = new Map();
    state.attempts.forEach((attempt) => {
      const quizId = String(attempt.quiz_id || "");
      const total = Number(attempt.total_marks ?? attempt.max_score ?? attempt.points_possible ?? 0);
      const score = Number(attempt.score ?? attempt.marks_obtained ?? attempt.obtained_marks ?? 0);
      const percentage = Number(attempt.percentage ?? attempt.percent ?? (total > 0 ? score / total * 100 : NaN));
      if (!quizId) return;
      if (!grouped.has(quizId)) grouped.set(quizId, []);
      grouped.get(quizId).push(Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : null);
    });
    return quizzes.map((quiz) => {
      const scores = (grouped.get(String(quiz.id)) || []).filter(Number.isFinite);
      return {
        ...quiz,
        response_count: (grouped.get(String(quiz.id)) || []).length,
        average_score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
      };
    });
  }

  function render() {
    const classes = [...new Set(state.quizzes.map((quiz) => valueOf(quiz, ["class_grade", "grade", "class"], "")).filter(Boolean))].sort();
    const subjects = [...new Set(state.quizzes.map((quiz) => valueOf(quiz, ["subject"], "")).filter(Boolean))].sort();
    const classFilter = $("quizClassFilter"); const subjectFilter = $("quizSubjectFilter");
    if (classFilter) { const current = classFilter.value; classFilter.innerHTML = '<option value="">All Classes</option>' + classes.map((value) => `<option value="${escapeHtml(value)}">Class ${escapeHtml(String(value).replace(/^class\s/i, ""))}</option>`).join(""); classFilter.value = classes.includes(current) ? current : state.classFilter; }
    if (subjectFilter) { const current = subjectFilter.value; subjectFilter.innerHTML = '<option value="">All Subjects</option>' + subjects.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(""); subjectFilter.value = subjects.includes(current) ? current : state.subjectFilter; }
    const rows = filtered();
    if (state.focusPublishedQuiz) {
      const selectedIndex = rows.findIndex((quiz) => String(quiz.id) === state.publishedQuizId);
      if (selectedIndex >= 0) {
        state.page = Math.floor(selectedIndex / state.pageSize) + 1;
        state.focusPublishedQuiz = false;
      }
    }
    document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.classList.toggle("active", tab.dataset.status === state.status));
    const pages = Math.ceil(rows.length / state.pageSize);
    state.page = Math.min(state.page, Math.max(pages, 1));
    const start = (state.page - 1) * state.pageSize; const visible = rows.slice(start, start + state.pageSize); const body = $("quizTableBody");
    body.innerHTML = visible.length ? visible.map((quiz) => { const status = statusOf(quiz); const statusIcon = status === "published" ? "fa-circle-check" : status === "archived" ? "fa-box-archive" : "fa-pen-to-square"; const title = valueOf(quiz, ["title", "name"], "Untitled quiz"); const topic = valueOf(quiz, ["topic", "chapter"], "No topic"); const questions = valueOf(quiz, ["question_count"], quiz.questions?.length || 0); const marks = valueOf(quiz, ["total_marks", "totalMarks"], quiz.questions?.reduce((sum, question) => sum + Number(question.marks || 0), 0) || 0); const duration = valueOf(quiz, ["duration", "quizDuration"], "-"); const classValue = valueOf(quiz, ["class_grade", "grade", "class"], "-"); const classLabel = /^class\s/i.test(String(classValue)) ? classValue : `Class ${classValue}`; const created = valueOf(quiz, ["created_at", "updated_at"]); const id = escapeHtml(quiz.id); return `<tr data-quiz-id="${id}"><td><div class="item-title"><span class="item-grip" aria-hidden="true"><i class="fa-solid fa-ellipsis-vertical"></i></span><div class="item-icon quiz-row-icon"><i class="fa-solid fa-file-lines"></i></div><div><div class="quiz-title-text">${escapeHtml(title)}</div><div class="quiz-subtitle-text">${escapeHtml(topic)}</div></div></div></td><td><span class="table-pill class-pill"><i class="fa-solid fa-graduation-cap"></i>${escapeHtml(classLabel)}</span></td><td><span class="table-pill subject-pill"><i class="fa-solid fa-book-open"></i>${escapeHtml(valueOf(quiz, ["subject"], "-"))}</span></td><td><span class="metric-cell"><strong>${escapeHtml(marks)}</strong><small>Marks</small></span></td><td><span class="metric-cell duration-cell"><i class="fa-regular fa-clock"></i><strong>${escapeHtml(duration)} min</strong><small>Duration</small></span></td><td><span class="metric-cell"><strong>${escapeHtml(questions)}</strong><small>Question${Number(questions) === 1 ? "" : "s"}</small></span></td><td><span class="date-cell"><i class="fa-regular fa-calendar-days"></i><span>${formatDate(created)}</span></span></td><td><span class="badge-status status-${escapeHtml(status)}"><i class="fa-solid ${statusIcon}"></i>${escapeHtml(status[0].toUpperCase() + status.slice(1))}</span></td><td><div class="action-icons"><a class="view-action" href="create_quiz.html?id=${id}" title="View quiz" aria-label="View quiz"><i class="fa-regular fa-eye"></i></a><a class="edit-action" href="create_quiz.html?id=${id}" title="Edit quiz" aria-label="Edit quiz"><i class="fa-solid fa-pen"></i></a><button class="delete-action" data-delete="${id}" title="Delete quiz" aria-label="Delete quiz"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`; }).join("") : '<tr><td class="quiz-empty-state" colspan="9"><strong>No quizzes found</strong>Create a quiz or adjust your search and filters.</td></tr>';
    updatePublishedAnalysis();
    body.querySelectorAll("tr[data-quiz-id]").forEach((row) => row.classList.toggle("just-published", row.dataset.quizId === state.publishedQuizId));
    $("quizPaginationSummary").textContent = rows.length ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, rows.length)} of ${rows.length} quizzes` : "No quizzes found";
    const pageButtons = pages ? [
      `<button class="page-btn" data-page="${state.page - 1}" aria-label="Previous page" ${state.page === 1 ? "disabled" : ""}>&lsaquo;</button>`,
      ...Array.from({ length: pages }, (_, index) => `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}" ${index + 1 === state.page ? 'aria-current="page"' : ""}>${index + 1}</button>`),
      `<button class="page-btn" data-page="${state.page + 1}" aria-label="Next page" ${state.page === pages ? "disabled" : ""}>&rsaquo;</button>`,
    ].join("") : "";
    $("quizPaginationControls").innerHTML = pageButtons;
    $("quizTotal").textContent = state.quizzes.length; $("quizPublished").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "published").length; $("quizDrafts").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "draft").length; $("quizResponses").textContent = state.quizzes.reduce((sum, quiz) => sum + Number(valueOf(quiz, ["response_count", "responses"], 0) || 0), 0); const scored = state.quizzes.filter((quiz) => Number(valueOf(quiz, ["average_score", "avg_score"], 0)) > 0); $("quizAverage").textContent = `${scored.length ? Math.round(scored.reduce((sum, quiz) => sum + Number(valueOf(quiz, ["average_score", "avg_score"], 0)), 0) / scored.length) : 0}%`; $("allQuizCount").textContent = state.quizzes.length; $("publishedQuizCount").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "published").length; $("archivedQuizCount").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "archived").length;
  }

  function updatePublishedAnalysis() {
    const panel = $("publishedQuizAnalysis");
    const quiz = state.publishedQuizId && state.quizzes.find((item) => String(item.id) === state.publishedQuizId);
    if (!panel || !quiz) { if (panel) panel.hidden = true; return; }
    panel.hidden = false;
    $("publishedQuizTitle").textContent = valueOf(quiz, ["title", "name"], "Untitled quiz");
    const classValue = valueOf(quiz, ["class_grade", "grade", "class"], "-");
    $("publishedQuizMeta").textContent = `${/^class\s/i.test(String(classValue)) ? classValue : `Class ${classValue}`} · ${valueOf(quiz, ["subject"], "No subject")} · ${valueOf(quiz, ["question_count"], quiz.questions?.length || 0)} questions`;
    $("publishedQuizResponses").textContent = String(Number(valueOf(quiz, ["response_count", "responses"], 0)) || 0);
    $("publishedQuizAverage").textContent = `${Math.round(Number(valueOf(quiz, ["average_score", "avg_score"], 0)) || 0)}%`;
  }

  async function load() {
    const client = supabase();
    const local = localQuizzes();
    if (!client || !state.user) { state.attempts = null; state.quizzes = local; render(); return; }
    const result = await client.from("quizzes").select("*").eq("teacher_id", state.user.id).order("updated_at", { ascending: false });
    if (result.error) throw result.error;
    try {
      const attemptResult = await client.from("quiz_attempts").select("*").eq("teacher_id", state.user.id);
      state.attempts = attemptResult.error ? null : attemptResult.data || [];
    } catch { state.attempts = null; }
    state.quizzes = withAttemptAnalytics(mergeQuizzes(result.data || [], local));
    render();
    if (!state.attemptChannel) {
      state.attemptChannel = client.channel("teacher-quiz-attempt-analysis").on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts", filter: `teacher_id=eq.${state.user.id}` }, load).subscribe();
    }
  }
  async function remove(id) { if (!confirm("Delete this quiz and its questions?")) return; const local = localQuizzes(); if (local.some((quiz) => String(quiz.id) === String(id))) { localStorage.setItem(localQuizKey, JSON.stringify(local.filter((quiz) => String(quiz.id) !== String(id)))); } else { const result = await supabase().from("quizzes").delete().eq("id", id).eq("teacher_id", state.user.id); if (result.error) return toast(result.error.message, "error"); } state.quizzes = state.quizzes.filter((quiz) => String(quiz.id) !== String(id)); render(); toast("Quiz deleted.", "success"); }

  document.addEventListener("DOMContentLoaded", async () => { renderRegisteredClassScope(); $("createQuizBtn")?.addEventListener("click", () => { window.location.href = "create_quiz.html"; }); $("questionBankBtn")?.addEventListener("click", () => toast("Question Bank is available inside the Create Quiz workflow.")); $("quizSearch").addEventListener("input", () => { state.query = $("quizSearch").value.trim(); state.page = 1; render(); }); $("quizClassFilter")?.addEventListener("change", (event) => { state.classFilter = event.target.value; state.page = 1; render(); }); $("quizSubjectFilter")?.addEventListener("change", (event) => { state.subjectFilter = event.target.value; state.page = 1; render(); }); $("quizSort").addEventListener("change", () => { state.page = 1; render(); }); document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll(".tab[data-status]").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); state.status = tab.dataset.status; state.page = 1; render(); })); $("quizTableBody").addEventListener("click", (event) => { const button = event.target.closest("[data-delete]"); if (button) remove(button.dataset.delete); }); $("quizPaginationControls").addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) { state.page = Number(button.dataset.page); render(); } }); window.addEventListener("storage", (event) => { if (event.key === localQuizKey) { state.quizzes = mergeQuizzes(state.quizzes.filter((quiz) => !String(quiz.id).startsWith("local-")), localQuizzes()); state.page = 1; render(); } }); window.addEventListener("focus", () => load().catch(() => {})); const client = supabase(); if (!client) { await load(); return; } const auth = await client.auth.getUser(); state.user = auth.data.user; try { await load(); if (state.user) client.channel("teacher-quizzes").on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${state.user.id}` }, load).subscribe(); } catch (error) { state.quizzes = localQuizzes(); render(); toast(error.message || "Could not load quizzes.", "error"); } });
})();
