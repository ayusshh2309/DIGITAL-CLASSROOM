(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    assignments: new Map(),
    subjects: new Map(),
    quizId: new URLSearchParams(location.search).get("id"),
    currentStep: 1,
    questions: [],
    draft: null,
    editingIndex: -1,
    saving: false,
    hasUnsavedChanges: false,
    settings: {},
  };

  const $ = (id) => document.getElementById(id);
  const subjectRules = window.TeacherQuizSubjectRules;
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
  const gradeNumber = (value) => {
    const match = String(value ?? "").match(/\d+/);
    return match ? Number(match[0]) : null;
  };
  const groupKey = (grade, stream) => `${Number(grade)}|${subjectRules.usesStream(grade) ? subjectRules.normalizeStream(stream) : ""}`;
  const totalMarks = () => state.questions.reduce((total, question) => total + Number(question.marks || 0), 0);
  const makeQuestion = () => ({ id: crypto.randomUUID(), type: "", text: "", options: ["", "", "", ""], correctAnswer: "", marks: 1, explanation: "" });

  function summaryTotalMarks() {
    let total = totalMarks();
    const draftHasContent = state.draft && (state.draft.type || state.draft.text.trim() || state.draft.options.some((option) => option.trim()));
    if (draftHasContent) {
      total += Number(state.draft.marks || 0);
      if (state.editingIndex >= 0) total -= Number(state.questions[state.editingIndex]?.marks || 0);
    }
    return total;
  }

  function showToast(message, isError = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function setSaving(saving, label = "") {
    state.saving = saving;
    document.querySelectorAll(".action-bar button").forEach((button) => { button.disabled = saving; });
    const publishButton = document.querySelector("#publishModal .btn-success");
    if (publishButton) {
      publishButton.disabled = saving;
      publishButton.textContent = saving ? label : "Publish Quiz";
    }
  }

  function selectedGrade() {
    return gradeNumber($("quizClass").value);
  }

  function gradeGroups(grade) {
    return state.groups.filter((group) => group.grade === Number(grade));
  }

  function gradeHasStreams(grade) {
    return subjectRules.usesStream(grade);
  }

  function streamValues(grade) {
    const valid = new Set(subjectRules.validStreams(grade));
    return [...new Set(gradeGroups(grade).map((group) => group.stream).filter((stream) => valid.has(stream)))].sort((a, b) => a.localeCompare(b));
  }

  function assignmentsFor(grade, stream = "") {
    return state.assignments.get(groupKey(grade, stream)) || [];
  }

  function fillSelect(select, placeholder, rows, valueOf, labelOf) {
    select.replaceChildren(new Option(placeholder, ""));
    rows.forEach((row) => select.add(new Option(labelOf(row), String(valueOf(row)))));
  }

  function populateGrades(selected = "") {
    const select = $("quizClass");
    select.replaceChildren(new Option(state.groups.length ? "Select class" : "No registered classes found", ""));
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((a, b) => a - b);
    grades.forEach((grade) => select.add(new Option(`Class ${grade}`, `Class ${grade}`)));
    if (selected && grades.includes(gradeNumber(selected))) select.value = `Class ${gradeNumber(selected)}`;
    updateQuizSubjects(false);
  }

  function updateQuizSubjects(updateSummary = true) {
    const grade = selectedGrade();
    const streamField = $("quizStreamField");
    const streamSelect = $("quizStream");
    const subjectSelect = $("quizSubject");
    const hasStreams = gradeHasStreams(grade);
    const currentStream = subjectRules.normalizeStream(streamSelect.value);
    streamField.hidden = !hasStreams;
    streamSelect.disabled = !hasStreams;
    fillSelect(streamSelect, hasStreams ? "Select stream" : "No stream required", hasStreams ? streamValues(grade) : [], (stream) => stream, (stream) => subjectRules.streamLabels[stream]);
    if (hasStreams && streamValues(grade).includes(currentStream)) streamSelect.value = currentStream;
    const stream = hasStreams ? subjectRules.normalizeStream(streamSelect.value) : "";
    const validNames = new Set(subjectRules.subjectsFor(grade, stream).map((name) => name.trim().toLocaleLowerCase()));
    const subjects = grade && (!hasStreams || stream)
      ? assignmentsFor(grade, stream).filter((item) => validNames.has(item.name.trim().toLocaleLowerCase()))
      : [];
    const subjectPlaceholder = !grade
      ? "Select a class first"
      : hasStreams && !stream
        ? "Select a stream first"
        : subjects.length ? "Select assigned subject" : "No standard subjects assigned";
    fillSelect(subjectSelect, subjectPlaceholder, subjects, (item) => item.subject_id, (item) => item.name);
    subjectSelect.disabled = !subjects.length;
    if (updateSummary) updateSummary();
  }

  function handleQuizGradeChange() {
    $("quizStream").value = "";
    $("quizSubject").value = "";
    updateQuizSubjects();
  }

  function handleQuizStreamChange() {
    $("quizSubject").value = "";
    updateQuizSubjects();
  }

  async function loadScope() {
    const [groupsResult, assignmentsResult] = await Promise.all([
      state.client.from("teacher_grade_groups").select("grade, stream, teach_all_subjects").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
      state.client.from("teacher_subject_assignments").select("grade, stream, subject_id").eq("teacher_id", state.teacher.id).order("grade", { ascending: true }).order("stream", { ascending: true }),
    ]);
    if (groupsResult.error) {
      console.error("Registered scope loading error:", groupsResult.error);
      throw new Error(`Could not load registered classes. ${groupsResult.error.message}`);
    }
    if (assignmentsResult.error) {
      console.error("Registered scope loading error:", assignmentsResult.error);
      throw new Error(`Could not load registered subjects. ${assignmentsResult.error.message}`);
    }

    state.groups = (groupsResult.data || []).map((row) => ({ grade: Number(row.grade), stream: String(row.stream || "").trim(), teach_all_subjects: Boolean(row.teach_all_subjects) })).filter((row) => Number.isInteger(row.grade));
    const groupKeys = new Set(state.groups.map((group) => groupKey(group.grade, group.stream)));
    const rows = (assignmentsResult.data || []).filter((row) => row.subject_id && groupKeys.has(groupKey(row.grade, row.stream)));
    const subjectIds = [...new Set(rows.map((row) => String(row.subject_id)))];
    const hasTeachAll = state.groups.some((group) => group.teach_all_subjects);
    if (subjectIds.length || hasTeachAll) {
      let subjectQuery = state.client.from("subjects").select("id, name");
      if (subjectIds.length && !hasTeachAll) subjectQuery = subjectQuery.in("id", subjectIds);
      const { data, error } = await subjectQuery;
      if (error) {
        console.error("Registered scope loading error:", error);
        throw new Error(`Could not resolve assigned subjects. ${error.message}`);
      }
      (data || []).forEach((subject) => state.subjects.set(String(subject.id), subject.name));
    }
    state.assignments = new Map();
    rows.forEach((row) => {
      const name = state.subjects.get(String(row.subject_id));
      if (!name) return;
      const key = groupKey(row.grade, row.stream);
      if (!state.assignments.has(key)) state.assignments.set(key, []);
      state.assignments.get(key).push({ subject_id: String(row.subject_id), name });
    });
    state.groups.filter((group) => group.teach_all_subjects).forEach((group) => {
      const key = groupKey(group.grade, group.stream);
      state.assignments.set(key, [...state.subjects].map(([subject_id, name]) => ({ subject_id, name })));
    });
    populateGrades();
  }

  function readForm() {
    return {
      title: $("quizTitle").value.trim(),
      description: $("quizDescription").value.trim(),
      instructions: $("quizInstructions").value.trim(),
      grade: selectedGrade(),
      classLabel: $("quizClass").value,
      stream: gradeHasStreams(selectedGrade()) ? $("quizStream").value : "",
      subjectId: /^\d+$/.test($("quizSubject").value) ? Number($("quizSubject").value) : $("quizSubject").value,
      subject: state.subjects.get(String($("quizSubject").value)) || "",
      duration: Number($("quizDuration").value),
    };
  }

  function renderSummary() {
    const info = readForm();
    $("summaryClass").textContent = info.classLabel || "—";
    $("summarySubject").textContent = info.subject || "—";
    $("summaryQuestions").textContent = String(state.questions.length);
    $("summaryMarks").textContent = String(summaryTotalMarks());
    $("summaryDuration").textContent = String(info.duration || 0);
    $("totalMarks").value = String(summaryTotalMarks());
  }

  function updateSummary() {
    renderSummary();
    $("titleCount").textContent = String($("quizTitle").value.length);
    $("descriptionCount").textContent = String($("quizDescription").value.length);
    $("instructionCount").textContent = String($("quizInstructions").value.length);
  }

  function clearStepOneErrors() {
    ["quizClassError", "quizStreamError", "quizSubjectError", "quizTitleError", "quizInstructionsError", "quizDurationError"].forEach((id) => { $(id).textContent = ""; });
  }

  function validateStep1() {
    clearStepOneErrors();
    const info = readForm();
    let firstInvalid = null;
    const fail = (id, message, elementId) => { $(id).textContent = message; firstInvalid ||= elementId; };
    if (!info.grade || !state.groups.some((group) => group.grade === info.grade)) fail("quizClassError", "Select a class registered to your teacher profile.", "quizClass");
    if (info.grade && gradeHasStreams(info.grade) && !streamValues(info.grade).includes(info.stream)) fail("quizStreamError", "Select a stream registered for this class.", "quizStream");
    if (!info.subjectId || !assignmentsFor(info.grade, info.stream).some((item) => String(item.subject_id) === String(info.subjectId))) fail("quizSubjectError", "Select a subject assigned to this class and stream.", "quizSubject");
    if (!info.title) fail("quizTitleError", "Enter a quiz title.", "quizTitle");
    if (info.title.length > 100) fail("quizTitleError", "Use 100 characters or fewer.", "quizTitle");
    if (!info.instructions) fail("quizInstructionsError", "Enter quiz instructions.", "quizInstructions");
    if (!Number.isFinite(info.duration) || info.duration < 1 || info.duration > 300) fail("quizDurationError", "Enter a duration from 1 to 300 minutes.", "quizDuration");
    if (firstInvalid) {
      $(firstInvalid).focus();
      showToast("Please correct the highlighted quiz information.", true);
      return false;
    }
    return true;
  }

  function collectSettings() {
    state.settings = {
      startDate: $("startDate").value,
      startTime: $("startTime").value,
      endDate: $("endDate").value,
      endTime: $("endTime").value,
      attemptsAllowed: $("attemptsAllowed").value,
      shuffleQuestions: $("shuffleQuestions").checked,
      shuffleOptions: $("shuffleOptions").checked,
      showQuestionNumbers: $("showQuestionNumbers").checked,
      showScore: $("showScore").checked,
      showAnswers: false,
      showExplanations: $("showExplanations").checked,
      studentAccess: $("studentAccess").value,
    };
    return state.settings;
  }

  function showQuestionMessage(message, isError = true) {
    const element = $("quizQuestionMessage");
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle("error", isError);
  }

  function questionAnswerLabel(question) {
    if (question.type === "multiple_choice") {
      const index = Number(question.correctAnswer);
      return `${String.fromCharCode(65 + index)} — ${question.options[index] || ""}`;
    }
    if (question.type === "true_false") return Number(question.correctAnswer) === 0 ? "True" : "False";
    return question.options[0] || "";
  }

  function renderSavedQuestion(question, index) {
    const typeLabel = { multiple_choice: "MCQ", true_false: "True / False", short_answer: "Short Answer" }[question.type] || "Choose a type";
    const options = question.type === "multiple_choice"
      ? `<div class="saved-options">${question.options.map((option, optionIndex) => `<div><strong>${String.fromCharCode(65 + optionIndex)}.</strong> ${escapeHTML(option)}</div>`).join("")}</div>`
      : "";
    return `<article class="saved-question"><div class="question-top"><div><div class="question-number">Question ${index + 1} · ${typeLabel}</div><div class="saved-question-text">${escapeHTML(question.text)}</div></div><div class="question-tools"><button type="button" class="icon-btn" title="Edit question" aria-label="Edit question ${index + 1}" onclick="editQuestion(${index})"><i class="fa-solid fa-pen"></i></button><button type="button" class="icon-btn" title="Delete question" aria-label="Delete question ${index + 1}" onclick="deleteQuestion(${index})"><i class="fa-solid fa-trash-can"></i></button></div></div>${options}<div class="saved-question-meta">Correct answer: <strong>${escapeHTML(questionAnswerLabel(question))}</strong> · ${Number(question.marks)} ${Number(question.marks) === 1 ? "mark" : "marks"}</div></article>`;
  }

  function renderQuestionEditor() {
    if (!state.draft) state.draft = makeQuestion();
    const question = state.draft;
    const questionNumber = state.editingIndex >= 0 ? state.editingIndex + 1 : state.questions.length + 1;
      const typeOptions = `<option value="">Select question type</option><option value="multiple_choice" ${question.type === "multiple_choice" ? "selected" : ""}>MCQ</option><option value="true_false" ${question.type === "true_false" ? "selected" : ""}>True / False</option><option value="short_answer" ${question.type === "short_answer" ? "selected" : ""}>Short Answer</option>`;
    let specificFields = "";
    if (question.type === "multiple_choice") {
      specificFields = `<label>Answer Options <span class="required">*</span></label><div class="option-grid">${question.options.map((option, index) => `<div class="option-item"><span class="option-letter">${String.fromCharCode(65 + index)}</span><input type="text" maxlength="500" value="${escapeHTML(option)}" placeholder="Option ${String.fromCharCode(65 + index)}" oninput="updateOption(${index}, this.value)"></div>`).join("")}</div><small class="quiz-field-error" data-question-error="options"></small><div class="form-group question-correct-answer"><label>Correct Answer <span class="required">*</span></label><select onchange="updateQuestion('correctAnswer', this.value)"><option value="">Select correct option</option>${[0, 1, 2, 3].map((index) => `<option value="${index}" ${String(question.correctAnswer) === String(index) ? "selected" : ""}>${String.fromCharCode(65 + index)} — ${escapeHTML(question.options[index] || `Option ${String.fromCharCode(65 + index)}`)}</option>`).join("")}</select><small class="quiz-field-error" data-question-error="answer"></small></div>`;
    } else if (question.type === "true_false") {
      specificFields = `<div class="form-group"><label>Correct Answer <span class="required">*</span></label><select onchange="updateQuestion('correctAnswer', this.value)"><option value="">Select correct answer</option><option value="0" ${String(question.correctAnswer) === "0" ? "selected" : ""}>True</option><option value="1" ${String(question.correctAnswer) === "1" ? "selected" : ""}>False</option></select><small class="quiz-field-error" data-question-error="answer"></small></div>`;
    } else if (question.type === "short_answer") {
      specificFields = `<div class="form-group"><label>Correct Answer / Expected Answer <span class="required">*</span></label><textarea maxlength="2000" placeholder="Enter the expected answer" oninput="updateShortAnswer(this.value)">${escapeHTML(question.options[0] || "")}</textarea><small class="quiz-field-error" data-question-error="answer"></small></div>`;
    }
    return `<article class="question-card editor-question"><div class="question-top"><div class="question-number">${state.editingIndex >= 0 ? "Edit Question" : `Question ${questionNumber}`}</div>${state.editingIndex >= 0 ? `<button type="button" class="btn btn-light" onclick="cancelEditQuestion()">Cancel Edit</button>` : ""}</div><div class="form-group"><label>Question <span class="required">*</span></label><textarea maxlength="3000" placeholder="Enter your question here..." oninput="updateQuestion('text', this.value)">${escapeHTML(question.text)}</textarea><small class="quiz-field-error" data-question-error="text"></small></div><div class="form-grid"><div class="form-group"><label>Question Type <span class="required">*</span></label><select onchange="changeQuestionType(this.value)">${typeOptions}</select><small class="quiz-field-error" data-question-error="type"></small></div><div class="form-group"><label>Marks <span class="required">*</span></label><input type="number" min="0.1" step="0.1" value="${escapeHTML(question.marks)}" oninput="updateQuestion('marks', this.value)"><small class="quiz-field-error" data-question-error="marks"></small></div></div>${specificFields}<div class="form-group"><label>Explanation <span>(optional)</span></label><textarea maxlength="2000" placeholder="Add a teacher explanation" oninput="updateQuestion('explanation', this.value)">${escapeHTML(question.explanation || "")}</textarea></div>${state.editingIndex >= 0 ? `<div class="question-editor-actions"><button type="button" class="btn btn-primary" onclick="commitQuestion()">Save Changes</button></div>` : ""}</article>`;
  }

  function renderQuestions() {
    const container = $("questionList");
    container.innerHTML = `${state.questions.map(renderSavedQuestion).join("")}${renderQuestionEditor()}`;
    $("addQuestionButton").hidden = state.editingIndex >= 0;
    renderSummary();
  }

  function updateQuestion(property, value) {
    if (!state.draft) state.draft = makeQuestion();
    state.draft[property] = property === "marks" ? value : value;
    state.hasUnsavedChanges = true;
    if (property === "marks") renderSummary();
    showQuestionMessage("");
  }

  function updateOption(index, value) {
    state.draft.options[index] = value;
    state.hasUnsavedChanges = true;
    const select = $("questionList").querySelector(".question-correct-answer select");
    if (select) {
      const current = state.draft.correctAnswer;
      fillSelect(select, "Select correct option", [0, 1, 2, 3], (optionIndex) => optionIndex, (optionIndex) => `${String.fromCharCode(65 + optionIndex)} — ${state.draft.options[optionIndex] || `Option ${String.fromCharCode(65 + optionIndex)}`}`);
      select.value = String(current ?? "");
    }
  }

  function updateShortAnswer(value) {
    state.draft.options[0] = value;
    state.hasUnsavedChanges = true;
  }

  function changeQuestionType(type) {
    if (!state.draft) state.draft = makeQuestion();
    state.draft.type = type;
    state.draft.options = ["", "", "", ""];
    state.draft.correctAnswer = "";
    state.hasUnsavedChanges = true;
    renderQuestions();
  }

  function validateQuestion(question, index = 0, showErrors = true) {
    const errors = {};
    if (!question.type) errors.type = "Select a question type.";
    if (!question.text.trim()) errors.text = "Enter the question text.";
    if (!Number.isFinite(Number(question.marks)) || Number(question.marks) <= 0) errors.marks = "Marks must be greater than zero.";
    if (question.type === "multiple_choice") {
      if (question.options.slice(0, 4).some((option) => !String(option).trim())) errors.options = "Enter all four option values.";
      if (![0, 1, 2, 3].includes(Number(question.correctAnswer)) || question.correctAnswer === "") errors.answer = "Choose one correct option.";
    } else if (question.type === "true_false") {
      if (!["0", "1", 0, 1].includes(question.correctAnswer)) errors.answer = "Choose True or False.";
    } else if (question.type === "short_answer" && !String(question.options[0] || "").trim()) {
      errors.answer = "Enter the expected answer.";
    }
    if (showErrors) {
      const card = $("questionList").querySelector(".editor-question");
      card?.querySelectorAll("[data-question-error]").forEach((element) => { element.textContent = errors[element.dataset.questionError] || ""; });
      if (Object.keys(errors).length) showToast(`Complete the highlighted fields for Question ${index + 1}.`, true);
    }
    return Object.keys(errors).length === 0;
  }

  function commitQuestion() {
    if (!state.draft || !validateQuestion(state.draft, state.editingIndex >= 0 ? state.editingIndex : state.questions.length)) return;
    const question = { ...state.draft, marks: Number(state.draft.marks), options: [...state.draft.options] };
    if (state.editingIndex >= 0) state.questions[state.editingIndex] = question;
    else state.questions.push(question);
    state.hasUnsavedChanges = true;
    state.editingIndex = -1;
    state.draft = makeQuestion();
    showQuestionMessage("");
    renderQuestions();
  }

  function editQuestion(index) {
    if (state.draft && (state.draft.text.trim() || state.draft.type)) {
      showToast("Add or cancel the question currently being edited first.", true);
      return;
    }
    state.editingIndex = index;
    state.draft = { ...state.questions[index], options: [...state.questions[index].options] };
    renderQuestions();
    $("questionList").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditQuestion() {
    state.editingIndex = -1;
    state.draft = makeQuestion();
    renderQuestions();
  }

  function deleteQuestion(index) {
    if (!window.confirm(`Delete Question ${index + 1}?`)) return;
    state.questions.splice(index, 1);
    state.hasUnsavedChanges = true;
    if (state.editingIndex === index) cancelEditQuestion();
    else if (state.editingIndex > index) state.editingIndex -= 1;
    renderQuestions();
    showToast("Question deleted.");
  }

  function duplicateQuestion(index) {
    state.questions.splice(index + 1, 0, { ...state.questions[index], id: crypto.randomUUID(), options: [...state.questions[index].options] });
    state.hasUnsavedChanges = true;
    renderQuestions();
    showToast("Question duplicated. Review its answer before continuing.");
  }

  function validateQuestions() {
    if (state.draft && (state.draft.type || state.draft.text.trim() || state.draft.options.some((option) => option.trim()))) {
      if (!validateQuestion(state.draft, state.questions.length)) return false;
      commitQuestion();
    }
    if (!state.questions.length) {
      showQuestionMessage("Add at least one question before continuing.");
      return false;
    }
    for (let index = 0; index < state.questions.length; index += 1) {
      if (!validateQuestion(state.questions[index], index, false)) {
        showQuestionMessage(`Question ${index + 1} is incomplete. Edit it and complete all required fields.`);
        return false;
      }
    }
    showQuestionMessage("");
    return true;
  }

  function collectQuizInformation() {
    const info = readForm();
    return { ...info, settings: collectSettings() };
  }

  function nextFromStep1() {
    if (!validateStep1()) return;
    if (!state.draft) state.draft = makeQuestion();
    goToStep(2);
  }

  function nextFromStep2() {
    if (!validateQuestions()) return;
    goToStep(3);
  }

  function goToStep(step) {
    if (step < 1 || step > 4) return;
    if (step > 1 && !validateStep1()) return;
    if (step > 2 && !validateQuestions()) return;
    if (step > 3 && !validateSettings()) return;
    state.currentStep = step;
    for (let index = 1; index <= 4; index += 1) $("step" + index).classList.toggle("hidden", index !== step);
    updateStepper(step);
    renderSummary();
    if (step === 2) renderQuestions();
    if (step === 4) renderPreview();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStepper(step) {
    for (let index = 1; index <= 4; index += 1) {
      const indicator = $("stepIndicator" + index);
      indicator.classList.remove("active", "completed");
      if (index < step) indicator.classList.add("completed");
      else if (index === step) indicator.classList.add("active");
    }
    for (let index = 1; index <= 3; index += 1) $("line" + index).classList.toggle("completed", index < step);
  }

  function renderPreview() {
    const info = readForm();
    collectSettings();
    $("previewTitle").textContent = info.title || "Untitled Quiz";
    $("previewDescription").textContent = info.description;
    $("previewClass").textContent = info.classLabel || "—";
    $("previewSubject").textContent = info.subject || "—";
    $("previewDuration").textContent = `${info.duration || 0} min`;
    $("previewMarks").textContent = String(totalMarks());
    $("previewQuestionCount").textContent = String(state.questions.length);
    $("previewInstructions").textContent = info.instructions ? `Instructions: ${info.instructions}` : "";
    $("previewStreamMeta").hidden = !info.stream;
    $("previewStream").textContent = info.stream || "—";
    const container = $("previewQuestions");
    container.innerHTML = state.questions.map((question, index) => {
      const type = { multiple_choice: "MCQ", true_false: "True / False", short_answer: "Short Answer" }[question.type];
      const options = question.type === "multiple_choice"
        ? question.options.map((option, optionIndex) => `<div class="preview-option"><strong>${String.fromCharCode(65 + optionIndex)}.</strong> ${escapeHTML(option)}</div>`).join("")
        : question.type === "true_false" ? `<div class="preview-option">True / False</div>` : `<div class="preview-option">Short answer</div>`;
      return `<article class="preview-question"><div class="preview-question-title">Question ${index + 1} · ${type}: ${escapeHTML(question.text)}</div>${options}<div class="preview-answer"><strong>Correct answer:</strong> ${escapeHTML(questionAnswerLabel(question))}</div><div class="preview-marks">${Number(question.marks)} ${Number(question.marks) === 1 ? "mark" : "marks"}</div><button type="button" class="btn btn-light" onclick="editQuestion(${index}); goToStep(2);">Edit</button></article>`;
    }).join("");
  }

  function toRpcQuestion(question) {
    const questionType = { multiple_choice: "mcq", true_false: "true_false", short_answer: "short_answer" }[question.type];
    const options = question.type === "multiple_choice" ? question.options.map((text, index) => ({ id: String.fromCharCode(65 + index), text: text.trim() })) : null;
    const answer = question.type === "multiple_choice" ? String.fromCharCode(65 + Number(question.correctAnswer)) : question.type === "true_false" ? (Number(question.correctAnswer) === 0 ? "true" : "false") : question.options[0].trim();
    return { question_type: questionType, question_text: question.text.trim(), options, correct_answer: answer, marks: Number(question.marks), explanation: question.explanation || null };
  }

  function quizPayload(status) {
    const info = collectQuizInformation();
    const settings = info.settings;
    const startAt = settings.startDate && settings.startTime ? new Date(`${settings.startDate}T${settings.startTime}`).toISOString() : null;
    const endAt = settings.endDate && settings.endTime ? new Date(`${settings.endDate}T${settings.endTime}`).toISOString() : null;
    return {
      ...(state.quizId ? { id: state.quizId } : {}),
      title: info.title,
      description: info.description,
      instructions: info.instructions,
      grade: info.grade,
      stream: info.stream || null,
      subject_id: info.subjectId,
      duration_minutes: info.duration,
      total_marks: totalMarks(),
      attempts_allowed: settings.attemptsAllowed === "unlimited" ? 2147483647 : Number(settings.attemptsAllowed),
      shuffle_questions: settings.shuffleQuestions,
      shuffle_options: settings.shuffleOptions,
      show_question_numbers: settings.showQuestionNumbers,
      show_score: settings.showScore,
      show_answers: settings.showAnswers,
      show_explanations: settings.showExplanations,
      student_access: settings.studentAccess,
      start_at: startAt,
      end_at: endAt,
      builder_draft: status === "draft" && (state.editingIndex >= 0 || state.draft?.type || state.draft?.text.trim() || state.draft?.options.some((option) => option.trim()))
        ? { question: state.draft, editing_index: state.editingIndex }
        : null,
      status,
    };
  }

  function validateSettings() {
    collectSettings();
    const settings = state.settings;
    const start = settings.startDate && settings.startTime ? new Date(`${settings.startDate}T${settings.startTime}`) : null;
    const end = settings.endDate && settings.endTime ? new Date(`${settings.endDate}T${settings.endTime}`) : null;
    if (Boolean(settings.startDate) !== Boolean(settings.startTime)) { showToast("Select both a start date and time, or leave both empty.", true); return false; }
    if (Boolean(settings.endDate) !== Boolean(settings.endTime)) { showToast("Select both an end date and time, or leave both empty.", true); return false; }
    if (start && end && end <= start) { showToast("The end time must be after the start time.", true); return false; }
    return true;
  }

  async function saveQuiz(status) {
    if (state.saving) return;
    if (!validateStep1()) return;
    if (status === "published" && !validateQuestions()) return;
    if (status === "published" && state.draft && (state.draft.type || state.draft.text.trim() || state.draft.options.some((option) => option.trim()))) {
      showToast("Complete or clear the current question before saving.", true);
      return;
    }
    if (!validateSettings()) return;
    const publishButton = $("publishModal").querySelector(".btn-success");
    setSaving(true, status === "published" ? "Publishing quiz..." : "Saving...");
    if (publishButton) publishButton.textContent = status === "published" ? "Publishing quiz..." : "Saving...";
    try {
      const { data, error } = await state.client.rpc("save_teacher_question_quiz", {
        p_quiz: quizPayload(status),
        p_questions: state.questions.map(toRpcQuestion),
      });
      if (error) throw error;
      const returnedId = typeof data === "string" ? data : data?.id;
      if (returnedId) state.quizId = returnedId;
      state.hasUnsavedChanges = false;
      if (status === "draft") {
        showToast("Draft saved to your teacher account.");
        return;
      }
      $("publishModal").classList.remove("show");
      showToast("Quiz published successfully.");
      window.setTimeout(() => location.assign("quizzes.html"), 700);
    } catch (error) {
      showToast(`Could not ${status === "published" ? "publish" : "save"} quiz. ${error.message || "Please try again."}`, true);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    await saveQuiz("draft");
  }

  function openPublishModal() {
    if (!validateStep1()) return;
    if (!validateQuestions()) return;
    if (!validateSettings()) return;
    $("publishModal").classList.add("show");
  }

  function closePublishModal() {
    $("publishModal").classList.remove("show");
  }

  async function publishQuiz() {
    await saveQuiz("published");
  }

  function goBack() {
    if (state.currentStep > 1) {
      goToStep(state.currentStep - 1);
      return;
    }
    if (state.quizId) {
      location.assign("quizzes.html");
      return;
    }
    if (window.confirm("Leave quiz creation? Unsaved changes will be lost.")) location.assign("quizzes.html");
  }

  async function loadExistingQuiz() {
    const { data: quiz, error } = await state.client.from("quizzes").select("id, teacher_id, title, grade, stream, subject_id, description, instructions, duration_minutes, status").eq("id", state.quizId).eq("teacher_id", state.teacher.id).maybeSingle();
    if (error) throw new Error(`Could not load quiz draft. ${error.message}`);
    if (!quiz) throw new Error("This quiz could not be found under your teacher account.");
    $("quizTitle").value = quiz.title || "";
    $("quizDescription").value = quiz.description || "";
    $("quizInstructions").value = quiz.instructions || "";
    $("quizDuration").value = String(quiz.duration_minutes || 30);
    populateGrades(quiz.grade ?? quiz.class_grade);
    const stream = quiz.stream || "";
    if (gradeHasStreams(selectedGrade())) $("quizStream").value = stream;
    updateQuizSubjects(false);
    $("quizSubject").value = String(quiz.subject_id || "");
    const { data: rows, error: questionsError } = await state.client.from("quiz_questions").select("question_number, question_type, question_text, options, correct_answer, marks").eq("quiz_id", quiz.id).order("question_number", { ascending: true });
    if (questionsError) throw new Error(`Could not load quiz questions. ${questionsError.message}`);
    state.questions = (rows || []).map((row) => {
      const type = row.question_type === "mcq" ? "multiple_choice" : row.question_type === "true_false" ? "true_false" : "short_answer";
      let options = row.options;
      if (typeof options === "string") { try { options = JSON.parse(options); } catch { options = []; } }
      if (!Array.isArray(options)) options = [];
      if (options.length && typeof options[0] === "object") options = ["A", "B", "C", "D"].map((letter) => options.find((option) => option.id === letter)?.text || "");
      let answer = row.correct_answer;
      if (typeof answer === "string") { try { answer = JSON.parse(answer); } catch {} }
      return { id: crypto.randomUUID(), type, text: row.question_text || "", options: type === "true_false" ? ["", "", "", ""] : type === "short_answer" ? [String(answer ?? ""), "", "", ""] : options.concat(["", "", "", ""]).slice(0, 4), correctAnswer: type === "mcq" ? (typeof answer === "number" ? answer : Math.max(0, ["A", "B", "C", "D"].indexOf(String(answer)))) : type === "true_false" ? (String(answer).toLowerCase() === "false" || String(answer) === "1" ? "1" : "0") : "", marks: Number(row.marks || 1), explanation: "" };
    });
    state.draft = makeQuestion();
    state.editingIndex = -1;
    updateSummary();
    renderQuestions();
  }

  async function initialize() {
    try {
      const formRoot = document.querySelector(".main-content");
      ["input", "change"].forEach((eventName) => formRoot.addEventListener(eventName, (event) => {
        if (event.target.matches("input, textarea, select")) state.hasUnsavedChanges = true;
      }));
      state.client = window.TeacherData?.getSupabaseClient?.();
      if (!state.client) throw new Error("Supabase is not configured. Check the existing Supabase setup.");
      const { data: authData, error: authError } = await state.client.auth.getUser();
      if (authError || !authData?.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      state.user = authData.user;
      const { data: teacher, error: teacherError } = await state.client.from("teachers").select("id, user_id").eq("user_id", state.user.id).single();
      if (teacherError) throw new Error(`Could not load teacher profile. ${teacherError.message}`);
      if (!teacher || teacher.user_id !== state.user.id) throw new Error("No teacher profile is linked to the authenticated account.");
      state.teacher = teacher;
      $("quizClass").replaceChildren(new Option("Loading classes...", ""));
      $("quizSubject").replaceChildren(new Option("Loading assigned subjects...", ""));
      await loadScope();
      if (!state.groups.length) throw new Error("No classes are registered to this teacher account.");
      if (!state.assignments.size) throw new Error("No assigned subjects were found for the registered classes.");
      if (state.quizId) await loadExistingQuiz();
      else state.draft = makeQuestion();
      updateSummary();
      updateStepper(1);
      window.addEventListener("beforeunload", warnBeforeLeaving);
    } catch (error) {
      console.error("Teacher loading error:", error);
      showToast(error.message || "Could not initialize quiz creation.", true);
    }
  }

  function warnBeforeLeaving(event) {
    if (state.hasUnsavedChanges) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  window.goBack = goBack;
  window.updateSummary = updateSummary;
  window.updateQuizSubjects = updateQuizSubjects;
  window.handleQuizGradeChange = handleQuizGradeChange;
  window.handleQuizStreamChange = handleQuizStreamChange;
  window.nextFromStep1 = nextFromStep1;
  window.nextFromStep2 = nextFromStep2;
  window.goToStep = goToStep;
  window.addQuestion = commitQuestion;
  window.updateQuestion = updateQuestion;
  window.updateOption = updateOption;
  window.updateShortAnswer = updateShortAnswer;
  window.changeQuestionType = changeQuestionType;
  window.editQuestion = editQuestion;
  window.cancelEditQuestion = cancelEditQuestion;
  window.deleteQuestion = deleteQuestion;
  window.duplicateQuestion = duplicateQuestion;
  window.saveDraft = saveDraft;
  window.openPublishModal = openPublishModal;
  window.closePublishModal = closePublishModal;
  window.publishQuiz = publishQuiz;

  document.addEventListener("DOMContentLoaded", () => { void initialize(); });
})();
