(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    selectedGrade: "",
    selectedStream: "",
    channel: null,
    authSubscription: null,
    loading: false,
    error: "",
  };

  const $ = (id) => document.getElementById(id);
  const rules = window.TeacherQuizSubjectRules;
  const streamLabels = { ...rules.streamLabels, "": "No stream" };
  const normalizedStream = (value) => rules.normalizeStream(value);
  const groupKey = (grade, stream) => `${Number(grade)}|${normalizedStream(stream)}`;
  const classLabel = (grade) => `Class ${grade}`;

  function setMessage(message, isError = false) {
    const body = $("studentTableBody");
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-table-state";
    cell.textContent = message;
    row.appendChild(cell);
    body.replaceChildren(row);
    $("paginationInfo").textContent = message;
    $("paginationControls").replaceChildren();
    $("statTotal").textContent = "0";
    $("studentCountPill").textContent = "0 Students";
    if (isError) console.error(message);
  }

  function subjectsFor(group) {
    return [...new Set(group?.subjects || [])].sort((left, right) => left.localeCompare(right));
  }

  function selectedGroup() {
    return state.groups.find((group) =>
      group.grade === Number(state.selectedGrade) &&
      normalizedStream(group.stream) === normalizedStream(state.selectedStream),
    ) || null;
  }

  function groupsForSelectedGrade() {
    return state.groups.filter((group) => group.grade === Number(state.selectedGrade));
  }

  function renderClassOptions() {
    const select = $("classFilter");
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
    select.replaceChildren(...(grades.length
      ? grades.map((grade) => new Option(classLabel(grade), String(grade)))
      : [new Option(state.loading ? "Loading classes..." : "No registered classes", "")]));
    if (grades.includes(Number(state.selectedGrade))) select.value = state.selectedGrade;
    else {
      state.selectedGrade = grades.length ? String(grades[0]) : "";
      select.value = state.selectedGrade;
    }
  }

  function renderStreamOptions() {
    const select = $("streamFilter");
    const gradeGroups = groupsForSelectedGrade();
    const streams = [...new Set(gradeGroups.map((group) => normalizedStream(group.stream)))];
    const streamGroups = streams.filter(Boolean);
    if (!gradeGroups.length) {
      select.replaceChildren(new Option(state.loading ? "Loading streams..." : "No registered streams", ""));
      select.disabled = true;
      state.selectedStream = "";
      return;
    }
    if (!streamGroups.length) {
      select.replaceChildren(new Option("Not applicable", ""));
      select.disabled = true;
      state.selectedStream = "";
      return;
    }

    select.replaceChildren(new Option("Select a stream", ""), ...streamGroups.map((stream) =>
      new Option(streamLabels[stream] || stream, stream),
    ));
    if (streamGroups.includes(state.selectedStream)) select.value = state.selectedStream;
    else {
      state.selectedStream = "";
      select.value = "";
    }
    select.disabled = false;
  }

  function renderSubjectOptions() {
    const select = $("subjectFilter");
    const current = select.value;
    const group = selectedGroup();
    if (!group) {
      select.replaceChildren(new Option(state.selectedGrade ? "Select a stream first" : "Select a class first", ""));
      select.disabled = true;
      return;
    }
    const subjects = subjectsFor(group);
    select.replaceChildren(
      new Option(`All Subjects${subjects.length ? ` (${subjects.length})` : ""}`, ""),
      ...subjects.map((subject) => new Option(subject, subject)),
    );
    select.disabled = !subjects.length;
    select.value = subjects.includes(current) ? current : "";
  }

  function renderRegisteredClasses() {
    const root = $("registeredClassSummary");
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
    root.replaceChildren();
    if (!grades.length) {
      const empty = document.createElement("div");
      empty.className = "registered-class-subjects";
      empty.textContent = state.loading ? "Loading teaching scope..." : "No registered classes found.";
      root.appendChild(empty);
      return;
    }
    grades.forEach((grade) => {
      const groups = state.groups.filter((group) => group.grade === grade);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `registered-class-card${String(grade) === state.selectedGrade ? " active" : ""}`;
      card.dataset.grade = String(grade);
      const title = document.createElement("strong");
      title.textContent = classLabel(grade);
      const detail = document.createElement("span");
      detail.className = "registered-class-subjects";
      detail.textContent = groups.map((group) => {
        const subjects = subjectsFor(group);
        const streamLabel = group.stream ? (streamLabels[normalizedStream(group.stream)] || group.stream) : "";
        const subjectLabel = subjects.length ? subjects.join(" · ") : "No subjects assigned";
        return [streamLabel, subjectLabel].filter(Boolean).join(": ");
      }).join(" | ");
      card.append(title, detail);
      root.appendChild(card);
    });
  }

  function renderScope() {
    const group = selectedGroup();
    const streamName = group?.stream ? streamLabels[normalizedStream(group.stream)] || group.stream : "";
    $("selectedClassContext").textContent = group
      ? `${classLabel(group.grade)}${streamName ? ` · ${streamName}` : ""}`
      : state.selectedGrade ? `${classLabel(state.selectedGrade)} · Select a stream` : "No registered classes";
  }

  function renderFilters() {
    renderClassOptions();
    renderStreamOptions();
    renderSubjectOptions();
    renderRegisteredClasses();
    renderScope();
    $("statClasses").textContent = String(new Set(state.groups.map((group) => group.grade)).size);
  }

  function renderStudentsState() {
    if (state.loading) {
      setMessage("Loading students...");
      return;
    }
    if (state.error) {
      setMessage(`Error loading data. ${state.error}`, true);
      return;
    }
    if (!state.groups.length) {
      setMessage("No registered classes found.");
      return;
    }
    if (!selectedGroup()) {
      setMessage(state.selectedGrade ? "Select a registered stream to view this class." : "Select a class to view students.");
      return;
    }
    setMessage("Student registration is not connected yet. Registered students will appear here when student records are available.");
  }

  function render() {
    renderFilters();
    renderStudentsState();
  }

  function subjectRowsByGroup(rows) {
    const result = new Map();
    rows.forEach((row) => {
      const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
      const name = String(subject?.name || "").trim();
      if (!name) return;
      const key = groupKey(row.grade, row.stream);
      const names = result.get(key) || [];
      if (!names.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
      result.set(key, names);
    });
    return result;
  }

  async function loadScope() {
    if (!state.client || !state.teacher) return;
    state.loading = true;
    state.error = "";
    render();
    try {
      const [groupsResult, assignmentsResult] = await Promise.all([
        state.client.from("teacher_grade_groups")
          .select("grade, stream, teach_all_subjects")
          .eq("teacher_id", state.teacher.id)
          .order("grade", { ascending: true })
          .order("stream", { ascending: true }),
        state.client.from("teacher_subject_assignments")
          .select("grade, stream, subject_id, subjects(name)")
          .eq("teacher_id", state.teacher.id)
          .order("grade", { ascending: true })
          .order("stream", { ascending: true }),
      ]);
      if (groupsResult.error) throw new Error(`Could not load registered classes. ${groupsResult.error.message}`);
      if (assignmentsResult.error) throw new Error(`Could not load registered subjects. ${assignmentsResult.error.message}`);

      const groupRows = (groupsResult.data || []).map((row) => ({
        grade: Number(row.grade),
        stream: normalizedStream(row.stream),
        teachAllSubjects: Boolean(row.teach_all_subjects),
        subjects: [],
      })).filter((group) => Number.isInteger(group.grade) && group.grade > 0);
      const assignedSubjects = subjectRowsByGroup(assignmentsResult.data || []);
      groupRows.forEach((group) => {
        const key = groupKey(group.grade, group.stream);
        const validSubjects = rules.subjectsFor(group.grade, group.stream);
        group.subjects = group.teachAllSubjects
          ? validSubjects
          : assignedSubjects.get(key) || [];
      });
      state.groups = groupRows;
    } catch (error) {
      console.error("Students teaching scope error:", error);
      state.groups = [];
      state.error = error.message || "Please try again.";
    } finally {
      state.loading = false;
      render();
    }
  }

  async function initialize() {
    const client = window.TeacherData?.getSupabaseClient?.();
    if (!client) {
      state.error = "Supabase is not configured.";
      render();
      return;
    }
    state.client = client;
    $("selectedClassContext").textContent = "Loading teacher...";
    $("classFilter").replaceChildren(new Option("Loading classes...", ""));
    $("streamFilter").replaceChildren(new Option("Loading streams...", ""));
    $("subjectFilter").replaceChildren(new Option("Loading subjects...", ""));
    setMessage("Loading teaching scope...");
    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw new Error(`Could not verify your sign-in. ${error.message}`);
      if (!data?.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      state.user = data.user;
      const { data: teacher, error: teacherError } = await client.from("teachers")
        .select("id, user_id")
        .eq("user_id", state.user.id)
        .single();
      if (teacherError) throw new Error(`Could not load teacher profile. ${teacherError.message}`);
      if (!teacher || teacher.user_id !== state.user.id) throw new Error("No teacher profile is linked to this account.");
      state.teacher = teacher;
      await loadScope();
      subscribeToChanges();
      const { data: authListener } = client.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" || event === "USER_DELETED") {
          if (state.channel) void client.removeChannel(state.channel);
          window.location.assign("../teacher_registration/login.html");
        }
      });
      state.authSubscription = authListener.subscription;
    } catch (error) {
      console.error("Students page initialization error:", error);
      state.error = error.message || "Could not initialize the Students page.";
      state.loading = false;
      render();
    }
  }

  function subscribeToChanges() {
    state.channel = state.client.channel(`teacher-student-scope-${state.teacher.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "teacher_grade_groups",
        filter: `teacher_id=eq.${state.teacher.id}`,
      }, () => { void loadScope(); })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "teacher_subject_assignments",
        filter: `teacher_id=eq.${state.teacher.id}`,
      }, () => { void loadScope(); })
      .subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.error("Students scope realtime subscription is unavailable.", status);
        }
      });
  }

  function selectGrade(grade) {
    state.selectedGrade = grade;
    state.selectedStream = "";
    render();
  }

  function selectStream(stream) {
    state.selectedStream = stream;
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("classFilter").addEventListener("change", (event) => selectGrade(event.target.value));
    $("streamFilter").addEventListener("change", (event) => selectStream(event.target.value));
    $("subjectFilter").addEventListener("change", renderStudentsState);
    $("studentSearchInput").addEventListener("input", renderStudentsState);
    $("registeredClassSummary").addEventListener("click", (event) => {
      const card = event.target.closest("[data-grade]");
      if (card) selectGrade(card.dataset.grade);
    });
    window.addEventListener("beforeunload", () => {
      if (state.channel) void state.client.removeChannel(state.channel);
      state.authSubscription?.unsubscribe();
    }, { once: true });
    void initialize();
  });
})();
