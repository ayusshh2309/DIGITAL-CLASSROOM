(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    students: [],
    selectedGrade: "",
    selectedStream: "",
    selectedSubject: "",
    searchTerm: "",
    channel: null,
    authSubscription: null,
    loadingScope: false,
    loadingStudents: false,
    error: "",
  };

  const $ = (id) => document.getElementById(id);
  const rules = window.TeacherQuizSubjectRules || {
    streamLabels: {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    },
    normalizeStream: (value) => String(value ?? "").trim().toLowerCase(),
    subjectsFor: () => [],
  };
  const streamLabels = { ...rules.streamLabels, "": "No stream" };
  const normalizedStream = (value) => {
    const stream = String(value ?? "").trim().toLowerCase();
    return Object.hasOwn(streamLabels, stream) ? stream : "";
  };
  const groupKey = (grade, stream) => `${Number(grade)}|${normalizedStream(stream)}`;
  const classLabel = (grade) => `Class ${grade}`;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function selectedGroup() {
    const grade = Number(state.selectedGrade);
    const stream = normalizedStream(state.selectedStream);
    return state.groups.find((group) => group.grade === grade && normalizedStream(group.stream) === stream) || null;
  }

  function groupsForSelectedGrade() {
    const grade = Number(state.selectedGrade);
    return state.groups.filter((group) => group.grade === grade);
  }

  function subjectsFor(group) {
    if (!group) return [];
    const collected = [...new Set(group.subjects || [])].filter(Boolean);
    return collected.sort((left, right) => left.localeCompare(right));
  }

  function updateSummaryStats(totalCount) {
    $("statTotal").textContent = String(totalCount);
    $("studentCountPill").textContent = `${totalCount} Student${totalCount === 1 ? "" : "s"}`;
    $("statClasses").textContent = String(new Set(state.groups.map((group) => group.grade)).size);
  }

  function setTableMessage(message, isError = false) {
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
    updateSummaryStats(0);
    if (isError) console.error(message);
  }

  function renderClassOptions() {
    const select = $("classFilter");
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
    select.replaceChildren(
      ...(grades.length
        ? grades.map((grade) => new Option(classLabel(grade), String(grade)))
        : [new Option(state.loadingScope ? "Loading classes..." : "No registered classes", "")]),
    );
    if (grades.includes(Number(state.selectedGrade))) {
      select.value = state.selectedGrade;
    } else {
      state.selectedGrade = grades.length ? String(grades[0]) : "";
      select.value = state.selectedGrade;
    }
  }

  function renderStreamOptions() {
    const select = $("streamFilter");
    const gradeGroups = groupsForSelectedGrade();
    const streams = [...new Set(gradeGroups.map((group) => normalizedStream(group.stream)).filter(Boolean))];

    if (!gradeGroups.length) {
      select.replaceChildren(new Option(state.loadingScope ? "Loading streams..." : "No registered streams", ""));
      select.disabled = true;
      state.selectedStream = "";
      return;
    }

    if (!streams.length) {
      select.replaceChildren(new Option("Not applicable", ""));
      select.disabled = true;
      state.selectedStream = "";
      return;
    }

    select.replaceChildren(
      new Option("Select a stream", ""),
      ...streams.map((stream) => new Option(streamLabels[stream] || stream, stream)),
    );
    select.disabled = false;

    if (streams.includes(normalizedStream(state.selectedStream))) {
      select.value = state.selectedStream;
    } else {
      state.selectedStream = streams[0];
      select.value = state.selectedStream;
    }
  }

  function renderSubjectOptions() {
    const select = $("subjectFilter");
    const current = state.selectedSubject;
    const group = selectedGroup();
    const subjects = group ? subjectsFor(group) : [];

    if (!group) {
      select.replaceChildren(new Option(state.selectedGrade ? "Select a stream first" : "Select a class first", ""));
      select.disabled = true;
      state.selectedSubject = "";
      return;
    }

    select.replaceChildren(
      new Option(`All Subjects${subjects.length ? ` (${subjects.length})` : ""}`, ""),
      ...subjects.map((subject) => new Option(subject, subject)),
    );
    select.disabled = !subjects.length;
    state.selectedSubject = subjects.includes(current) ? current : "";
    select.value = state.selectedSubject;
  }

  function renderRegisteredClasses() {
    const root = $("registeredClassSummary");
    root.replaceChildren();
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);

    if (!grades.length) {
      const empty = document.createElement("div");
      empty.className = "registered-class-subjects";
      empty.textContent = state.loadingScope ? "Loading teaching scope..." : "No registered classes found.";
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
    const classes = [...new Set(state.groups.map((group) => group.grade))]
      .sort((left, right) => left - right)
      .map(classLabel);
    $("selectedClassContext").textContent = classes.length ? classes.join(" · ") : "No registered classes";
  }

  function renderFilters() {
    renderClassOptions();
    renderStreamOptions();
    renderSubjectOptions();
    renderRegisteredClasses();
    renderScope();
    $("statClasses").textContent = String(new Set(state.groups.map((group) => group.grade)).size);
  }

  function filterStudents() {
    if (!state.selectedGrade) return [];
    const selectedGrade = Number(state.selectedGrade);
    const students = state.students.filter((student) => {
      const studentGrade = Number(student.grade);
      if (studentGrade !== selectedGrade) return false;

      if (selectedGrade >= 11) {
        if (!state.selectedStream) return false;
        return normalizedStream(student.stream) === normalizedStream(state.selectedStream);
      }

      return normalizedStream(student.stream) === "";
    });

    if (!state.selectedSubject) return students;
    const group = state.groups.find((entry) =>
      entry.grade === selectedGrade && normalizedStream(entry.stream) === normalizedStream(state.selectedStream),
    );
    if (!group) return students;
    const allowedSubjects = subjectsFor(group);
    if (!allowedSubjects.includes(state.selectedSubject)) return [];
    return students;
  }

  function renderStudentRows(students) {
    const body = $("studentTableBody");
    body.replaceChildren();
    if (!students.length) {
      setTableMessage(state.selectedGrade ? "No students found for the selected grade and stream." : "Select a class to view students.");
      return;
    }

    students
      .slice()
      .sort((left, right) => left.full_name.localeCompare(right.full_name))
      .forEach((student) => {
        const row = document.createElement("tr");
        const studentName = document.createElement("td");
        const nameWrap = document.createElement("div");
        nameWrap.className = "student-info-cell";
        const avatar = document.createElement("img");
        avatar.className = "student-avatar";
        avatar.alt = "Student avatar";
        avatar.src = student.profile_photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || "Student")}&background=00818a&color=fff`;
        const textWrap = document.createElement("div");
        const name = document.createElement("div");
        name.className = "student-name";
        name.textContent = student.full_name || "Unnamed student";
        const idLine = document.createElement("div");
        idLine.className = "student-id";
        idLine.textContent = student.email || "No email";
        textWrap.append(name, idLine);
        nameWrap.append(avatar, textWrap);
        studentName.appendChild(nameWrap);

        const studentIdCell = document.createElement("td");
        studentIdCell.className = "student-id-cell";
        studentIdCell.textContent = student.student_id || "—";

        const gradeCell = document.createElement("td");
        gradeCell.className = "grade-cell";
        gradeCell.innerHTML = `<span class="badge-grade">${escapeHtml(classLabel(student.grade))}</span>`;

        const streamCell = document.createElement("td");
        streamCell.className = "grade-cell";
        const stream = normalizedStream(student.stream);
        streamCell.textContent = stream ? (streamLabels[stream] || stream) : "N/A";

        const subjectsCell = document.createElement("td");
        const group = state.groups.find((entry) => entry.grade === Number(student.grade) && normalizedStream(entry.stream) === normalizedStream(student.stream));
        const subjectNames = group ? subjectsFor(group) : [];
        const chips = subjectNames.length ? subjectNames.slice(0, 3).map((subject, index) => {
          const chip = document.createElement("span");
          chip.className = `subject-chip subject-chip-${(index % 3) + 1}`;
          chip.textContent = subject;
          return chip;
        }) : [(() => {
          const chip = document.createElement("span");
          chip.className = "subject-chip subject-chip-more";
          chip.textContent = "No subjects";
          return chip;
        })()];
        const subjectWrap = document.createElement("div");
        subjectWrap.className = "subject-chips";
        chips.forEach((chip) => subjectWrap.appendChild(chip));
        if (subjectNames.length > 3) {
          const more = document.createElement("span");
          more.className = "subject-chip subject-chip-more";
          more.textContent = `+${subjectNames.length - 3}`;
          subjectWrap.appendChild(more);
        }
        subjectsCell.appendChild(subjectWrap);

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.className = "status-chip";
        status.textContent = "Active";
        statusCell.appendChild(status);

        const actionCell = document.createElement("td");
        actionCell.className = "actions-cell";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "profile-action";
        button.textContent = "View Profile";
        actionCell.appendChild(button);

        row.append(studentName, studentIdCell, gradeCell, streamCell, subjectsCell, statusCell, actionCell);
        body.appendChild(row);
      });

    $("paginationInfo").textContent = `${students.length} visible student${students.length === 1 ? "" : "s"}`;
    $("paginationControls").replaceChildren();
    updateSummaryStats(students.length);
  }

  function renderStudents() {
    if (state.loadingScope) {
      setTableMessage("Loading teaching scope...");
      return;
    }
    if (state.error) {
      setTableMessage(`Error loading data. ${state.error}`, true);
      return;
    }
    if (!state.groups.length) {
      setTableMessage("No registered classes found.");
      return;
    }
    if (!state.selectedGrade) {
      setTableMessage("Select a class to view students.");
      return;
    }
    if (Number(state.selectedGrade) >= 11 && !state.selectedStream) {
      setTableMessage("Select a registered stream to view this class.");
      return;
    }

    const visibleStudents = filterStudents();
    const searchValue = state.searchTerm.trim().toLowerCase();
    const searchedStudents = searchValue
      ? visibleStudents.filter((student) => [student.full_name, student.student_id, student.email].some((value) => String(value ?? "").toLowerCase().includes(searchValue)))
      : visibleStudents;

    renderStudentRows(searchedStudents);
  }

  async function loadScope() {
    if (!state.client || !state.teacher) return;
    state.loadingScope = true;
    state.error = "";
    renderFilters();
    renderStudents();
    try {
      const groupRows = await window.TeacherData.loadRegisteredTeachingScope(state.client, state.teacher.id);
      state.groups = groupRows.map((group) => ({
        id: group.id,
        grade: group.grade,
        stream: normalizedStream(group.stream),
        teachAllSubjects: group.teachAllSubjects,
        subjects: group.subjects.map((subject) => subject.name),
      })).filter((group) => Number.isInteger(group.grade) && group.grade > 0);

      if (!state.groups.length) {
        state.selectedGrade = "";
        state.selectedStream = "";
      } else {
        const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
        if (!grades.includes(Number(state.selectedGrade))) {
          state.selectedGrade = String(grades[0]);
        }
        const gradeGroups = state.groups.filter((group) => group.grade === Number(state.selectedGrade));
        const streams = [...new Set(gradeGroups.map((group) => normalizedStream(group.stream)).filter(Boolean))];
        if (Number(state.selectedGrade) >= 11 && streams.length) {
          state.selectedStream = streams.includes(normalizedStream(state.selectedStream)) ? state.selectedStream : streams[0];
        } else {
          state.selectedStream = "";
        }
      }
    } catch (error) {
      console.error("Students teaching scope error:", error);
      state.groups = [];
      state.error = error.message || "Please try again.";
    } finally {
      state.loadingScope = false;
      renderFilters();
      void loadStudents();
    }
  }

  async function loadStudents() {
    if (!state.client || !state.teacher) return;
    state.loadingStudents = true;
    const totalQuery = state.client.from("students").select("id, student_id, full_name, email, profile_photo_url, grade, stream");
    let query = totalQuery;

    if (state.selectedGrade) {
      query = query.eq("grade", Number(state.selectedGrade));
      if (Number(state.selectedGrade) >= 11 && state.selectedStream) {
        query = query.eq("stream", state.selectedStream);
      } else {
        query = query.is("stream", null);
      }
    }

    query = query.order("full_name", { ascending: true });
    const { data, error } = await query;
    state.loadingStudents = false;

    if (error) {
      state.error = error.message || "Could not load students.";
      state.students = [];
      renderStudents();
      return;
    }

    state.error = "";
    state.students = data || [];
    renderStudents();
  }

  async function initialize() {
    const client = window.TeacherData?.getSupabaseClient?.();
    if (!client) {
      state.error = "Supabase is not configured.";
      renderFilters();
      setTableMessage("Supabase is not configured.");
      return;
    }
    state.client = client;
    $("selectedClassContext").textContent = "Loading teacher...";
    $("classFilter").replaceChildren(new Option("Loading classes...", ""));
    $("streamFilter").replaceChildren(new Option("Loading streams...", ""));
    $("subjectFilter").replaceChildren(new Option("Loading subjects...", ""));
    setTableMessage("Loading teaching scope...");

    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw new Error(`Could not verify your sign-in. ${error.message}`);
      if (!data?.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }

      state.user = data.user;
      const { data: teacher, error: teacherError } = await client
        .from("teachers")
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
      setTableMessage(state.error, true);
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
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
      }, () => { void loadStudents(); })
      .subscribe((status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.error("Students realtime subscription is unavailable.", status);
        }
      });
  }

  function selectGrade(grade) {
    state.selectedGrade = grade;
    const gradeGroups = state.groups.filter((group) => group.grade === Number(grade));
    const streams = [...new Set(gradeGroups.map((group) => normalizedStream(group.stream)).filter(Boolean))];
    state.selectedStream = Number(grade) >= 11 && streams.length ? streams[0] : "";
    state.selectedSubject = "";
    renderFilters();
    void loadStudents();
  }

  function selectStream(stream) {
    state.selectedStream = stream;
    state.selectedSubject = "";
    renderFilters();
    void loadStudents();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("classFilter").addEventListener("change", (event) => selectGrade(event.target.value));
    $("streamFilter").addEventListener("change", (event) => selectStream(event.target.value));
    $("subjectFilter").addEventListener("change", (event) => {
      state.selectedSubject = event.target.value;
      renderStudents();
    });
    $("studentSearchInput").addEventListener("input", (event) => {
      state.searchTerm = event.target.value;
      renderStudents();
    });
    $("registeredClassSummary").addEventListener("click", (event) => {
      const card = event.target.closest("[data-grade]");
      if (card) selectGrade(card.dataset.grade);
    });
    window.addEventListener("beforeunload", () => {
      if (state.channel && state.client) void state.client.removeChannel(state.channel);
      state.authSubscription?.unsubscribe();
    }, { once: true });
    void initialize();
  });
})();
