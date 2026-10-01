(() => {
  const mount = document.getElementById("quizBuilderMount");
  if (!mount) return;

  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    assignments: new Map(),
    subjects: new Map(),
    quiz: { title: "", description: "", grade: "", stream: "", subject_id: "" },
    questions: [],
    draft: null,
    editingIndex: -1,
    step: 1,
    editId: new URLSearchParams(location.search).get("id"),
    error: "",
    detailErrors: {},
    saving: false,
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const groupKey = (grade, stream) => `${Number(grade)}|${stream || ""}`;
  const makeDraft = () => ({ type: "mcq", text: "", options: ["", "", "", ""], correct_answer: "", marks: 1 });
  const totalMarks = () => state.questions.reduce((total, question) => total + Number(question.marks), 0);

  function showError(message) {
    state.error = message;
    render();
  }

  function setStep(step) {
    if (step === 2 && !validateDetails()) return;
    if (step === 3 && !state.questions.length) {
      state.error = "Add at least one valid question before reviewing.";
      render();
      return;
    }
    state.step = step;
    state.error = "";
    render();
  }

  function gradeOptions() {
    return [...new Set(state.groups.map((group) => group.grade))].sort((a, b) => a - b);
  }

  function gradeHasStreams(grade) {
    return state.groups.some((group) => group.grade === Number(grade) && group.stream);
  }

  function streamsForGrade(grade) {
    return [...new Set(state.groups.filter((group) => group.grade === Number(grade) && group.stream).map((group) => group.stream))].sort((a, b) => a.localeCompare(b));
  }

  function assignmentsForSelection() {
    return state.assignments.get(groupKey(state.quiz.grade, state.quiz.stream)) || [];
  }

  function validateDetails() {
    const errors = {};
    if (!state.quiz.title.trim()) errors.title = "Enter a quiz title.";
    if (!state.groups.some((group) => group.grade === Number(state.quiz.grade))) errors.grade = "Choose a grade registered to your teacher profile.";
    const hasStreams = gradeHasStreams(state.quiz.grade);
    if (hasStreams && !streamsForGrade(state.quiz.grade).includes(state.quiz.stream)) errors.stream = "Choose a stream registered for this grade.";
    if (!assignmentsForSelection().some((assignment) => String(assignment.subject_id) === String(state.quiz.subject_id))) errors.subject_id = "Choose a subject assigned to this grade and stream.";
    if (Object.keys(errors).length) {
      state.detailErrors = errors;
      state.error = Object.values(errors)[0];
      render();
      document.querySelector(`[data-field="${Object.keys(errors)[0]}"]`)?.focus();
      return false;
    }
    state.detailErrors = {};
    state.error = "";
    return true;
  }

  function renderStepper() {
    const labels = [[1, "Quiz Details", "Class and subject"], [2, "Add Questions", "Build your question set"], [3, "Review & Publish", "Check answers and marks"]];
    return `<nav class="builder-stepper" aria-label="Quiz creation steps">${labels.map(([step, title, subtitle]) => `<div class="builder-step ${state.step === step ? "active" : ""} ${state.step > step ? "done" : ""}" aria-current="${state.step === step ? "step" : "false"}"><span class="step-index">${state.step > step ? "✓" : step}</span><span><strong>${title}</strong><span>${subtitle}</span></span></div>`).join("")}</nav>`;
  }

  function renderDetails() {
    const grades = gradeOptions();
    const streamsVisible = gradeHasStreams(state.quiz.grade);
    const assignments = assignmentsForSelection();
    return `<section class="builder-card" aria-labelledby="detailsHeading">
      <h2 id="detailsHeading">Quiz Details</h2><p>Choose a registered class and the subject assignment this quiz belongs to.</p>
      ${state.error ? `<div class="builder-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="builder-form-grid">
        <label class="builder-field full">Quiz Title<input data-field="title" maxlength="160" value="${escapeHtml(state.quiz.title)}" placeholder="e.g. Motion and Force" required><span class="field-error" data-error="title">${escapeHtml(state.detailErrors.title || "")}</span></label>
        <label class="builder-field full">Description <span>(optional)</span><textarea data-field="description" maxlength="1000" placeholder="Add context for students">${escapeHtml(state.quiz.description)}</textarea></label>
        <label class="builder-field">Grade / Class<select data-field="grade" required><option value="">${grades.length ? "Select registered grade" : "No registered grades"}</option>${grades.map((grade) => `<option value="${grade}" ${String(state.quiz.grade) === String(grade) ? "selected" : ""}>Grade ${grade}</option>`).join("")}</select><span class="field-error" data-error="grade">${escapeHtml(state.detailErrors.grade || "")}</span></label>
        <label class="builder-field" ${streamsVisible ? "" : "hidden"}>Stream<select data-field="stream" ${streamsVisible ? "required" : "disabled"}><option value="">Select stream</option>${streamsForGrade(state.quiz.grade).map((stream) => `<option value="${escapeHtml(stream)}" ${state.quiz.stream === stream ? "selected" : ""}>${escapeHtml(stream)}</option>`).join("")}</select><span class="field-error" data-error="stream">${escapeHtml(state.detailErrors.stream || "")}</span></label>
        <label class="builder-field">Subject<select data-field="subject_id" required ${assignments.length ? "" : "disabled"}><option value="">${assignments.length ? "Select assigned subject" : "Select grade and stream first"}</option>${assignments.map((assignment) => `<option value="${escapeHtml(assignment.subject_id)}" ${String(state.quiz.subject_id) === String(assignment.subject_id) ? "selected" : ""}>${escapeHtml(assignment.name)}</option>`).join("")}</select><span class="field-error" data-error="subject_id">${escapeHtml(state.detailErrors.subject_id || "")}</span></label>
      </div>
      <div class="builder-actions"><button class="builder-button" type="button" data-action="cancel">Cancel</button><div class="builder-actions-right"><button class="builder-button builder-primary" type="button" data-action="next-questions">Next: Add Questions <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div></div>
    </section>`;
  }

  function renderQuestionFields() {
    const draft = state.draft;
    const common = `<label class="builder-field full">Question<textarea data-qfield="text" maxlength="3000" placeholder="Write your question here" required>${escapeHtml(draft.text)}</textarea><span class="field-error" data-qerror="text"></span></label>`;
    if (draft.type === "mcq") {
      return `${common}<div class="builder-field full"><span>Options <small>Enter all four options</small></span><div class="option-grid">${draft.options.map((option, index) => `<label class="builder-field">Option ${String.fromCharCode(65 + index)}<input data-option="${index}" maxlength="500" value="${escapeHtml(option)}" placeholder="Enter option ${String.fromCharCode(65 + index)}"><span class="field-error" data-qerror="option-${index}"></span></label>`).join("")}</div></div><label class="builder-field">Correct Answer<select data-qfield="correct_answer"><option value="">Select the correct option</option>${["A", "B", "C", "D"].map((letter) => `<option value="${letter}" ${draft.correct_answer === letter ? "selected" : ""}>Option ${letter}</option>`).join("")}</select><span class="field-error" data-qerror="correct_answer"></span></label>`;
    }
    if (draft.type === "true_false") {
      return `${common}<fieldset class="builder-field full"><legend>Correct Answer</legend><div class="answer-choices">${["true", "false"].map((answer) => `<label><input type="radio" name="trueFalseAnswer" data-qfield="correct_answer" value="${answer}" ${draft.correct_answer === answer ? "checked" : ""}> ${answer === "true" ? "True" : "False"}</label>`).join("")}</div><span class="field-error" data-qerror="correct_answer"></span></fieldset>`;
    }
    return `${common}<label class="builder-field full">Correct Answer / Expected Answer<textarea data-qfield="correct_answer" maxlength="2000" placeholder="Enter the expected answer">${escapeHtml(draft.correct_answer)}</textarea><span class="field-error" data-qerror="correct_answer"></span></label>`;
  }

  function renderQuestionItem(question, index) {
    const typeLabel = { mcq: "MCQ", true_false: "True/False", short_answer: "Short Answer" }[question.question_type];
    const answer = question.question_type === "mcq"
      ? `${question.correct_answer}. ${question.options.find((option) => option.id === question.correct_answer)?.text || ""}`
      : question.correct_answer === "true" ? "True" : question.correct_answer === "false" ? "False" : question.correct_answer;
    return `<article class="question-item"><div class="question-item-head"><div><div class="question-item-title">Question ${index + 1} · ${typeLabel}</div><p>${escapeHtml(question.question_text)}</p></div><div class="question-tools"><button type="button" data-action="edit-question" data-index="${index}" title="Edit question" aria-label="Edit question ${index + 1}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button type="button" data-action="delete-question" data-index="${index}" title="Delete question" aria-label="Delete question ${index + 1}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></div></div><small>${question.options.length ? `${question.options.length} options · ` : ""}${Number(question.marks)} ${Number(question.marks) === 1 ? "mark" : "marks"}</small>${state.step === 3 ? `<div class="review-answer"><strong>Correct answer:</strong> ${escapeHtml(answer)}</div>` : ""}</article>`;
  }

  function renderQuestionStep() {
    state.draft ||= makeDraft();
    const draft = state.draft;
    return `<section class="builder-card" aria-labelledby="questionsHeading"><h2 id="questionsHeading">Add Questions</h2><p>Each question has its own type, answer key, and marks.</p>${state.error ? `<div class="builder-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="question-builder-layout"><div class="question-composer">
        <label class="builder-field">Question Type<select data-qtype><option value="mcq" ${draft.type === "mcq" ? "selected" : ""}>MCQ</option><option value="true_false" ${draft.type === "true_false" ? "selected" : ""}>True/False</option><option value="short_answer" ${draft.type === "short_answer" ? "selected" : ""}>Short Answer</option></select></label>
        <div class="builder-form-grid" style="margin-top:15px">${renderQuestionFields()}<label class="builder-field">Marks<input data-qfield="marks" type="number" min="0.1" step="0.1" value="${escapeHtml(draft.marks)}" required><span class="field-error" data-qerror="marks"></span></label></div>
        <div class="builder-actions"><button class="builder-button" type="button" data-action="back-details"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back</button><div class="builder-actions-right">${state.editingIndex >= 0 ? `<button class="builder-button" type="button" data-action="cancel-edit">Cancel Edit</button>` : ""}<button class="builder-button builder-primary" type="button" data-action="add-question">${state.editingIndex >= 0 ? "Save Changes" : "+ Add Question"}</button><button class="builder-button" type="button" data-action="review">Review Quiz <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div></div>
      </div><aside class="question-list-panel"><h3>Questions <span>${state.questions.length}</span></h3><div class="question-list">${state.questions.length ? state.questions.map(renderQuestionItem).join("") : `<div class="empty-questions">Your questions will appear here as you add them.</div>`}</div><div class="review-summary"><span>Total marks</span><strong>${totalMarks()}</strong></div></aside></div>
    </section>`;
  }

  function renderReview() {
    const grade = `Grade ${state.quiz.grade}`;
    const stream = state.quiz.stream ? ` · ${escapeHtml(state.quiz.stream)}` : "";
    const subject = state.subjects.get(String(state.quiz.subject_id)) || "";
    return `<section class="builder-card" aria-labelledby="reviewHeading"><h2 id="reviewHeading">Review &amp; Publish</h2><p>Correct answers are visible here only in this teacher interface.</p>${state.error ? `<div class="builder-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="review-summary"><strong>${escapeHtml(state.quiz.title)}</strong><span>${grade}${stream}</span><span>${escapeHtml(subject)}</span><span>${state.questions.length} questions</span><span>${totalMarks()} total marks</span></div>
      ${state.quiz.description ? `<p>${escapeHtml(state.quiz.description)}</p>` : ""}<div class="question-list">${state.questions.map(renderQuestionItem).join("")}</div>
      <div class="builder-actions"><button class="builder-button" type="button" data-action="back-questions"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Questions</button><div class="builder-actions-right"><button class="builder-button builder-primary" type="button" data-action="publish" ${state.saving ? "disabled" : ""}>${state.saving ? "Publishing…" : "Publish Quiz"}</button></div></div>
    </section>`;
  }

  function render() {
    const stepContent = state.step === 1 ? renderDetails() : state.step === 2 ? renderQuestionStep() : renderReview();
    mount.innerHTML = `<div class="builder-shell"><header class="builder-heading"><div><span class="builder-eyebrow">Teacher workspace / quizzes</span><h1>${state.editId ? "Edit Quiz" : "Create Quiz"}</h1><p>Build a classroom quiz one question at a time.</p></div><a class="builder-back" href="quizzes.html"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Quiz Management</a></header>${renderStepper()}${stepContent}</div>`;
  }

  function updateQuizField(field, value) {
    state.quiz[field] = value;
    state.detailErrors = {};
    state.error = "";
    if (field === "grade") {
      state.quiz.stream = "";
      state.quiz.subject_id = "";
    } else if (field === "stream") {
      state.quiz.subject_id = "";
    }
    render();
  }

  function updateDraftFromForm() {
    if (!state.draft) state.draft = makeDraft();
    mount.querySelectorAll("[data-qfield]").forEach((field) => {
      if (field.type === "radio") {
        if (field.checked) state.draft[field.dataset.qfield] = field.value;
      } else {
        state.draft[field.dataset.qfield] = field.dataset.qfield === "marks" ? Number(field.value) : field.value;
      }
    });
    mount.querySelectorAll("[data-option]").forEach((field) => { state.draft.options[Number(field.dataset.option)] = field.value; });
  }

  function validateDraft() {
    updateDraftFromForm();
    const draft = state.draft;
    const errors = {};
    if (!draft.text.trim()) errors.text = "Enter the question text.";
    if (draft.type === "mcq") {
      draft.options.forEach((option, index) => { if (!option.trim()) errors[`option-${index}`] = `Enter option ${String.fromCharCode(65 + index)}.`; });
      if (!["A", "B", "C", "D"].includes(draft.correct_answer)) errors.correct_answer = "Select the correct option.";
    } else if (!String(draft.correct_answer || "").trim() || (draft.type === "true_false" && !["true", "false"].includes(draft.correct_answer))) {
      errors.correct_answer = "Enter or select the correct answer.";
    }
    if (!Number.isFinite(Number(draft.marks)) || Number(draft.marks) <= 0) errors.marks = "Marks must be greater than 0.";
    if (Object.keys(errors).length) {
      state.error = "Complete the highlighted question fields.";
      render();
      Object.entries(errors).forEach(([name, message]) => {
        const target = mount.querySelector(`[data-qerror="${name}"]`);
        if (target) target.textContent = message;
      });
      mount.querySelector("[data-qerror]:not(:empty)")?.closest("label,fieldset")?.querySelector("input,textarea,select")?.focus();
      return false;
    }
    return true;
  }

  function commitQuestion() {
    if (!validateDraft()) return;
    const question = {
      question_type: state.draft.type,
      question_text: state.draft.text.trim(),
      options: state.draft.type === "mcq" ? state.draft.options.map((text, index) => ({ id: String.fromCharCode(65 + index), text: text.trim() })) : null,
      correct_answer: String(state.draft.correct_answer).trim(),
      marks: Number(state.draft.marks),
    };
    if (state.editingIndex >= 0) state.questions[state.editingIndex] = question;
    else state.questions.push(question);
    state.questions = state.questions.map((item, index) => ({ ...item, question_number: index + 1 }));
    state.editingIndex = -1;
    state.draft = makeDraft();
    state.error = "";
    render();
  }

  function editQuestion(index) {
    const question = state.questions[index];
    if (!question) return;
    state.editingIndex = index;
    state.draft = {
      type: question.question_type,
      text: question.question_text,
      options: question.question_type === "mcq" ? ["A", "B", "C", "D"].map((id) => question.options.find((option) => option.id === id)?.text || "") : ["", "", "", ""],
      correct_answer: question.correct_answer,
      marks: question.marks,
    };
    state.error = "";
    render();
  }

  async function loadAssignments() {
    const [groupsResult, assignmentsResult] = await Promise.all([
      state.client.from("teacher_grade_groups").select("grade, stream").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
      state.client.from("teacher_subject_assignments").select("grade, stream, subject_id").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
    ]);
    if (groupsResult.error) throw new Error(`Could not load registered grades: ${groupsResult.error.message}`);
    if (assignmentsResult.error) throw new Error(`Could not load assigned subjects: ${assignmentsResult.error.message}`);
    state.groups = (groupsResult.data || []).map((row) => ({ grade: Number(row.grade), stream: String(row.stream || "").trim() })).filter((row) => Number.isInteger(row.grade));
    const validGroups = new Set(state.groups.map((group) => groupKey(group.grade, group.stream)));
    const assignmentRows = (assignmentsResult.data || []).filter((row) => row.subject_id && validGroups.has(groupKey(row.grade, row.stream)));
    const subjectIds = [...new Set(assignmentRows.map((row) => String(row.subject_id)))];
    if (subjectIds.length) {
      const { data, error } = await state.client.from("subjects").select("id, name").in("id", subjectIds);
      if (error) throw new Error(`Could not resolve assigned subject names: ${error.message}`);
      (data || []).forEach((subject) => state.subjects.set(String(subject.id), subject.name));
    }
    assignmentRows.forEach((row) => {
      const name = state.subjects.get(String(row.subject_id));
      if (!name) return;
      const key = groupKey(row.grade, row.stream);
      if (!state.assignments.has(key)) state.assignments.set(key, []);
      state.assignments.get(key).push({ subject_id: String(row.subject_id), name });
    });
  }

  function normalizeQuestion(row) {
    const legacyTypes = { "Multiple Choice": "mcq", "True/False": "true_false", "Short Answer": "short_answer" };
    const type = row.question_type || legacyTypes[row.type] || "short_answer";
    let options = row.options;
    if (typeof options === "string") { try { options = JSON.parse(options); } catch { options = []; } }
    if (!Array.isArray(options)) options = [];
    if (options.length && typeof options[0] === "string") options = options.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));
    let answer = row.correct_answer;
    if (typeof answer === "string") { try { answer = JSON.parse(answer); } catch {} }
    if (typeof answer === "number" && type === "mcq") answer = String.fromCharCode(65 + answer);
    return { question_number: Number(row.question_number || row.position || 0), question_type: type, question_text: row.question_text || row.text || "", options, correct_answer: answer == null ? "" : String(answer), marks: Number(row.marks || 1) };
  }

  async function loadExistingQuiz() {
    const { data: quiz, error } = await state.client.from("quizzes").select("id, teacher_id, title, grade, stream, subject_id, description, status").eq("id", state.editId).eq("teacher_id", state.teacher.id).maybeSingle();
    if (error) throw new Error(`Could not load this quiz: ${error.message}`);
    if (!quiz) throw new Error("This quiz was not found in your teacher account.");
    state.quiz = { title: quiz.title || "", description: quiz.description || "", grade: String(quiz.grade || ""), stream: quiz.stream || "", subject_id: String(quiz.subject_id || "") };
    const { data: rows, error: questionsError } = await state.client.from("quiz_questions").select("question_number, question_type, question_text, options, correct_answer, marks, position, type, text").eq("quiz_id", state.editId).order("question_number", { ascending: true });
    if (questionsError) throw new Error(`Could not load quiz questions: ${questionsError.message}`);
    state.questions = (rows || []).map(normalizeQuestion).map((question, index) => ({ ...question, question_number: index + 1 }));
  }

  async function publishQuiz() {
    if (!validateDetails()) {
      state.step = 1;
      render();
      return;
    }
    if (!state.questions.length) {
      state.step = 2;
      state.error = "Add at least one question before publishing.";
      render();
      return;
    }
    if (state.questions.some((question) => !question.question_text.trim() || !question.correct_answer || !(Number(question.marks) > 0))) {
      showError("Every question needs text, a correct answer, and marks greater than 0.");
      return;
    }
    state.saving = true;
    state.error = "";
    render();
    try {
      const quizRecord = {
        ...(state.editId ? { id: state.editId } : {}),
        title: state.quiz.title.trim(),
        description: state.quiz.description.trim() || null,
        grade: Number(state.quiz.grade),
        stream: state.quiz.stream || null,
        subject_id: state.quiz.subject_id,
        status: "published",
      };
      const questions = state.questions.map((question, index) => ({
        question_number: index + 1,
        question_type: question.question_type,
        question_text: question.question_text,
        options: question.question_type === "mcq" ? question.options : null,
        correct_answer: question.correct_answer,
        marks: Number(question.marks),
      }));
      const { data, error } = await state.client.rpc("save_teacher_question_quiz", { p_quiz: quizRecord, p_questions: questions });
      if (error) throw error;
      const quizId = typeof data === "string" ? data : data?.id || state.editId;
      location.assign(`quizzes.html?published=${encodeURIComponent(quizId || "")}`);
    } catch (error) {
      state.saving = false;
      showError(`Could not publish quiz. ${error.message || "Please try again."}`);
    }
  }

  function onInput(event) {
    const field = event.target.dataset.field;
    if (field) {
      state.quiz[field] = event.target.value;
      delete state.detailErrors[field];
      const error = mount.querySelector(`[data-error="${field}"]`);
      if (error) error.textContent = "";
    }
    const qfield = event.target.dataset.qfield;
    if (qfield) state.draft[qfield] = qfield === "marks" ? Number(event.target.value) : event.target.value;
    if (event.target.dataset.option !== undefined) state.draft.options[Number(event.target.dataset.option)] = event.target.value;
  }

  function handleClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "cancel") location.assign("quizzes.html");
    if (action === "next-questions") setStep(2);
    if (action === "back-details") {
      updateDraftFromForm();
      setStep(1);
    }
    if (action === "review") {
      if (!state.questions.length) return showError("Add at least one question before reviewing.");
      updateDraftFromForm();
      const hasUnfinishedQuestion = state.draft.text.trim() || state.draft.correct_answer || state.draft.options.some((option) => option.trim());
      if (hasUnfinishedQuestion) {
        state.error = "Add or clear the question you started before opening the review.";
        render();
        return;
      }
      state.step = 3;
      state.error = "";
      render();
    }
    if (action === "back-questions") setStep(2);
    if (action === "add-question") commitQuestion();
    if (action === "edit-question") editQuestion(Number(button.dataset.index));
    if (action === "delete-question") {
      state.questions.splice(Number(button.dataset.index), 1);
      state.questions = state.questions.map((question, index) => ({ ...question, question_number: index + 1 }));
      render();
    }
    if (action === "cancel-edit") { state.editingIndex = -1; state.draft = makeDraft(); state.error = ""; render(); }
    if (action === "publish") void publishQuiz();
  }

  async function initialize() {
    mount.innerHTML = '<div class="builder-loading" role="status">Loading your teacher profile and registered classes…</div>';
    try {
      state.client = window.TeacherData?.getSupabaseClient?.();
      if (!state.client) throw new Error("Supabase is not configured.");
      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError || !authData?.user) {
        location.assign("../teacher_registration/login.html");
        return;
      }
      state.user = authData.user;
      const { data: teacher, error: teacherError } = await state.client.from("teachers").select("id, user_id, full_name").eq("user_id", state.user.id).maybeSingle();
      if (teacherError) throw new Error(`Could not load teacher profile: ${teacherError.message}`);
      if (!teacher) throw new Error("Teacher profile was not found for this account.");
      state.teacher = teacher;
      await loadAssignments();
      if (state.editId) await loadExistingQuiz();
      if (!state.groups.length) throw new Error("No registered grades were found for this teacher.");
      if (!state.assignments.size) throw new Error("No assigned subjects were found for the registered grades.");
      render();
    } catch (error) {
      mount.innerHTML = `<div class="builder-shell"><div class="builder-alert" role="alert">${escapeHtml(error.message || "The quiz builder could not be loaded.")}</div><a class="builder-back" href="quizzes.html">Return to Quiz Management</a></div>`;
    }
  }

  mount.addEventListener("input", onInput);
  mount.addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    if (field) updateQuizField(field, event.target.value);
    if (event.target.matches("[data-qtype]")) {
      updateDraftFromForm();
      state.draft.type = event.target.value;
      state.draft.options = ["", "", "", ""];
      state.draft.correct_answer = "";
      state.error = "";
      render();
    }
  });
  mount.addEventListener("click", handleClick);
  void initialize();
})();
