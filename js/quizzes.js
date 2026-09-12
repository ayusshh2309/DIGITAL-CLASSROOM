(() => {
  const state = { quizzes: [], user: null, status: "all", query: "", classFilter: "", subjectFilter: "", page: 1, pageSize: 6 };
  const localQuizKey = "smartLearningDC_published_quizzes";
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const valueOf = (item, names, fallback = "") => names.map((name) => item[name]).find((value) => value !== undefined && value !== null && value !== "") ?? fallback;
  const statusOf = (quiz) => String(valueOf(quiz, ["status"], "draft")).toLowerCase();
  const supabase = () => window.TeacherData?.getSupabaseClient?.();
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

  function mergeQuizzes(remote, local) {
    const merged = new Map(remote.map((quiz) => [String(quiz.id), quiz]));
    local.forEach((quiz) => merged.set(String(quiz.id), quiz));
    return Array.from(merged.values());
  }

  function filtered() {
    const query = state.query.toLowerCase(); const rows = state.quizzes.filter((quiz) => { const classValue = String(valueOf(quiz, ["class_grade", "grade", "class"], "")); const subjectValue = String(valueOf(quiz, ["subject"], "")); const text = [valueOf(quiz, ["title", "name"]), classValue, subjectValue, valueOf(quiz, ["topic", "chapter"])].join(" ").toLowerCase(); return (state.status === "all" || statusOf(quiz) === state.status) && (!state.classFilter || classValue === state.classFilter) && (!state.subjectFilter || subjectValue === state.subjectFilter) && (!query || text.includes(query)); });
    const sort = $("quizSort").value; return rows.sort((a, b) => { if (sort === "az") return valueOf(a, ["title", "name"]).localeCompare(valueOf(b, ["title", "name"])); if (sort === "za") return valueOf(b, ["title", "name"]).localeCompare(valueOf(a, ["title", "name"])); const left = new Date(valueOf(a, ["updated_at", "created_at"])).getTime() || 0; const right = new Date(valueOf(b, ["updated_at", "created_at"])).getTime() || 0; return sort === "oldest" ? left - right : right - left; });
  }

  function render() {
    const classes = [...new Set(state.quizzes.map((quiz) => valueOf(quiz, ["class_grade", "grade", "class"], "")).filter(Boolean))].sort();
    const subjects = [...new Set(state.quizzes.map((quiz) => valueOf(quiz, ["subject"], "")).filter(Boolean))].sort();
    const classFilter = $("quizClassFilter"); const subjectFilter = $("quizSubjectFilter");
    if (classFilter) { const current = classFilter.value; classFilter.innerHTML = '<option value="">All Classes</option>' + classes.map((value) => `<option value="${escapeHtml(value)}">Class ${escapeHtml(String(value).replace(/^class\s/i, ""))}</option>`).join(""); classFilter.value = classes.includes(current) ? current : state.classFilter; }
    if (subjectFilter) { const current = subjectFilter.value; subjectFilter.innerHTML = '<option value="">All Subjects</option>' + subjects.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(""); subjectFilter.value = subjects.includes(current) ? current : state.subjectFilter; }
    const rows = filtered(); const start = (state.page - 1) * state.pageSize; const visible = rows.slice(start, start + state.pageSize); const body = $("quizTableBody");
    body.innerHTML = visible.length ? visible.map((quiz) => { const status = statusOf(quiz); const title = valueOf(quiz, ["title", "name"], "Untitled quiz"); const topic = valueOf(quiz, ["topic", "chapter"], "No topic"); const questions = valueOf(quiz, ["question_count"], quiz.questions?.length || 0); const marks = valueOf(quiz, ["total_marks", "totalMarks"], quiz.questions?.reduce((sum, question) => sum + Number(question.marks || 0), 0) || 0); const duration = valueOf(quiz, ["duration", "quizDuration"], "-"); const classValue = valueOf(quiz, ["class_grade", "grade", "class"], "-"); const classLabel = /^class\s/i.test(String(classValue)) ? classValue : `Class ${classValue}`; const id = escapeHtml(quiz.id); return `<tr data-quiz-id="${id}"><td><div class="item-title"><div class="item-icon quiz-row-icon"><i class="fa-solid fa-clipboard-question"></i></div><div><div class="quiz-title-text">${escapeHtml(title)}</div><div class="quiz-subtitle-text">${escapeHtml(topic)}</div></div></div></td><td>${escapeHtml(classLabel)}</td><td>${escapeHtml(valueOf(quiz, ["subject"], "-"))}</td><td>${escapeHtml(marks)}</td><td>${escapeHtml(duration)} min</td><td>${escapeHtml(questions)}</td><td>${formatDate(valueOf(quiz, ["created_at", "updated_at"]))}</td><td><span class="badge-status status-${escapeHtml(status)}">${escapeHtml(status[0].toUpperCase() + status.slice(1))}</span></td><td><div class="action-icons"><a href="create_quiz.html?id=${id}" title="Edit"><i class="fa-solid fa-pen"></i></a><button data-delete="${id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button></div></td></tr>`; }).join("") : '<tr><td class="quiz-empty-state" colspan="9"><strong>No quizzes found</strong>Create a quiz or adjust your search and filters.</td></tr>';
    $("quizPaginationSummary").textContent = rows.length ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, rows.length)} of ${rows.length} quizzes` : "No quizzes found"; const pages = Math.ceil(rows.length / state.pageSize); $("quizPaginationControls").innerHTML = Array.from({ length: pages }, (_, index) => `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`).join("");
    $("quizTotal").textContent = state.quizzes.length; $("quizPublished").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "published").length; $("quizDrafts").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "draft").length; $("quizResponses").textContent = state.quizzes.reduce((sum, quiz) => sum + Number(valueOf(quiz, ["response_count", "responses"], 0) || 0), 0); const scored = state.quizzes.filter((quiz) => Number(valueOf(quiz, ["average_score", "avg_score"], 0)) > 0); $("quizAverage").textContent = `${scored.length ? Math.round(scored.reduce((sum, quiz) => sum + Number(valueOf(quiz, ["average_score", "avg_score"], 0)), 0) / scored.length) : 0}%`; $("allQuizCount").textContent = state.quizzes.length; $("publishedQuizCount").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "published").length; $("archivedQuizCount").textContent = state.quizzes.filter((quiz) => statusOf(quiz) === "archived").length;
  }

  async function load() { const client = supabase(); const local = localQuizzes(); if (!client || !state.user) { state.quizzes = local; render(); return; } const result = await client.from("quizzes").select("*").eq("teacher_id", state.user.id).order("updated_at", { ascending: false }); if (result.error) throw result.error; state.quizzes = mergeQuizzes(result.data || [], local); render(); }
  async function remove(id) { if (!confirm("Delete this quiz and its questions?")) return; const local = localQuizzes(); if (local.some((quiz) => String(quiz.id) === String(id))) { localStorage.setItem(localQuizKey, JSON.stringify(local.filter((quiz) => String(quiz.id) !== String(id)))); } else { const result = await supabase().from("quizzes").delete().eq("id", id).eq("teacher_id", state.user.id); if (result.error) return toast(result.error.message, "error"); } state.quizzes = state.quizzes.filter((quiz) => String(quiz.id) !== String(id)); render(); toast("Quiz deleted.", "success"); }

  document.addEventListener("DOMContentLoaded", async () => { $("createQuizBtn")?.addEventListener("click", () => { window.location.href = "create_quiz.html"; }); $("questionBankBtn")?.addEventListener("click", () => toast("Question Bank is available inside the Create Quiz workflow.")); $("quizSearch").addEventListener("input", () => { state.query = $("quizSearch").value.trim(); state.page = 1; render(); }); $("quizClassFilter")?.addEventListener("change", (event) => { state.classFilter = event.target.value; state.page = 1; render(); }); $("quizSubjectFilter")?.addEventListener("change", (event) => { state.subjectFilter = event.target.value; state.page = 1; render(); }); $("quizSort").addEventListener("change", () => { state.page = 1; render(); }); document.querySelectorAll(".tab[data-status]").forEach((tab) => tab.addEventListener("click", () => { document.querySelectorAll(".tab[data-status]").forEach((item) => item.classList.remove("active")); tab.classList.add("active"); state.status = tab.dataset.status; state.page = 1; render(); })); $("quizTableBody").addEventListener("click", (event) => { const button = event.target.closest("[data-delete]"); if (button) remove(button.dataset.delete); }); $("quizPaginationControls").addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button) { state.page = Number(button.dataset.page); render(); } }); window.addEventListener("storage", (event) => { if (event.key === localQuizKey) { state.quizzes = mergeQuizzes(state.quizzes.filter((quiz) => !String(quiz.id).startsWith("local-")), localQuizzes()); state.page = 1; render(); } }); window.addEventListener("focus", () => load().catch(() => {})); const client = supabase(); if (!client) { await load(); return; } const auth = await client.auth.getUser(); state.user = auth.data.user; try { await load(); if (state.user) client.channel("teacher-quizzes").on("postgres_changes", { event: "*", schema: "public", table: "quizzes", filter: `teacher_id=eq.${state.user.id}` }, load).subscribe(); } catch (error) { state.quizzes = localQuizzes(); render(); toast(error.message || "Could not load quizzes.", "error"); } });
})();
