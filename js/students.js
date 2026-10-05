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
    studentLoadId: 0,
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
    return String(value ?? "").trim().toLowerCase();
  };
  const groupKey = (grade, stream) => `${Number(grade)}|${normalizedStream(stream)}`;
  const classLabel = (grade, stream = "") => {
    const normalizedGrade = Number(grade);
    if (normalizedGrade >= 11) {
      return `Grade ${normalizedGrade} — ${streamLabels[normalizedStream(stream)] || stream}`;
    }
    return `Grade ${normalizedGrade}`;
  };
  const photoUrlCache = new Map();

  function registeredGroups() {
    return state.groups.filter((group) => {
      if (group.grade >= 5 && group.grade <= 10) return !group.stream;
      return group.grade >= 11 && group.grade <= 12 &&
        Object.hasOwn(rules.streamLabels, group.stream);
    });
  }

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
    return registeredGroups().find((group) => group.grade === grade && normalizedStream(group.stream) === stream) || null;
  }

  function selectedGroups() {
    return registeredGroups().filter((group) =>
      (!state.selectedGrade || group.grade === Number(state.selectedGrade)) &&
      (!state.selectedStream || normalizedStream(group.stream) === normalizedStream(state.selectedStream)),
    );
  }

  function groupsForSelectedGrade() {
    if (!state.selectedGrade) return registeredGroups();
    const grade = Number(state.selectedGrade);
    return registeredGroups().filter((group) => group.grade === grade);
  }

  function subjectsFor(group) {
    if (!group) return [];
    const collected = [...new Set(group.subjects || [])].filter(Boolean);
    return collected.sort((left, right) => left.localeCompare(right));
  }

  function updateSummaryStats(totalCount) {
    $("statTotal").textContent = String(totalCount);
    $("studentCountPill").textContent = `${totalCount} Student${totalCount === 1 ? "" : "s"}`;
    $("statClasses").textContent = String(new Set(registeredGroups().map((group) => group.grade)).size);
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
    const groups = registeredGroups().slice().sort((left, right) =>
      left.grade - right.grade || left.stream.localeCompare(right.stream),
    );
    select.replaceChildren(
      ...(groups.length
        ? [
          new Option("All Classes", ""),
          ...groups.map((group) => new Option(
            classLabel(group.grade, group.stream),
            groupKey(group.grade, group.stream),
          )),
        ]
        : [new Option(state.loadingScope ? "Loading classes..." : "No registered classes", "")]),
    );
    select.value = selectedGroup() ? groupKey(state.selectedGrade, state.selectedStream) : "";
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
      new Option("All Streams", ""),
      ...streams.map((stream) => new Option(streamLabels[stream] || stream, stream)),
    );
    select.disabled = false;

    select.value = streams.includes(normalizedStream(state.selectedStream)) ? state.selectedStream : "";
  }

  function renderSubjectOptions() {
    const select = $("subjectFilter");
    const current = state.selectedSubject;
    const groups = selectedGroups();
    const subjects = [...new Set(groups.flatMap(subjectsFor))].sort((left, right) => left.localeCompare(right));

    if (!groups.length) {
      select.replaceChildren(new Option("No registered classes", ""));
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
    const grades = [...new Set(registeredGroups().map((group) => group.grade))].sort((left, right) => left - right);

    if (!grades.length) {
      const empty = document.createElement("div");
      empty.className = "registered-class-subjects";
      empty.textContent = state.loadingScope ? "Loading teaching scope..." : "No registered classes found.";
      root.appendChild(empty);
      return;
    }

    grades.forEach((grade) => {
      const groups = registeredGroups().filter((group) => group.grade === grade);
      groups.forEach((group) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `registered-class-card${groupKey(group.grade, group.stream) === groupKey(state.selectedGrade, state.selectedStream) ? " active" : ""}`;
        card.dataset.grade = groupKey(group.grade, group.stream);
        const title = document.createElement("strong");
        title.textContent = classLabel(group.grade, group.stream);
        const detail = document.createElement("span");
        detail.className = "registered-class-subjects";
        const subjects = subjectsFor(group);
        detail.textContent = subjects.length ? subjects.join(" · ") : "No subjects assigned";
        card.append(title, detail);
        root.appendChild(card);
      });
    });
  }

  function renderFilters() {
    renderClassOptions();
    renderStreamOptions();
    renderSubjectOptions();
    renderRegisteredClasses();
    $("statClasses").textContent = String(new Set(registeredGroups().map((group) => group.grade)).size);
  }

  function filterStudents() {
    const groups = selectedGroups();
    if (!groups.length) return [];
    const groupsByKey = new Map(groups.map((group) => [groupKey(group.grade, group.stream), group]));
    const students = state.students.filter((student) =>
      groupsByKey.has(groupKey(student.grade, student.stream)),
    );

    if (!state.selectedSubject) return students;
    return students.filter((student) => {
      const group = groupsByKey.get(groupKey(student.grade, student.stream));
      return subjectsFor(group).includes(state.selectedSubject);
    });
  }

  function renderStudentRows(students) {
    const body = $("studentTableBody");
    body.replaceChildren();
    if (!students.length) {
      setTableMessage("No students found for the registered classes.");
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
        avatar.src = student.profile_photo_signed_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || "Student")}&background=00818a&color=fff`;
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
        gradeCell.innerHTML = `<span class="badge-grade">${escapeHtml(classLabel(student.grade, student.stream))}</span>`;

        const streamCell = document.createElement("td");
        streamCell.className = "grade-cell";
        const stream = normalizedStream(student.stream);
        streamCell.textContent = stream ? (streamLabels[stream] || stream) : "N/A";

        const subjectsCell = document.createElement("td");
        const group = registeredGroups().find((entry) => entry.grade === Number(student.grade) && normalizedStream(entry.stream) === normalizedStream(student.stream));
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
    if (!registeredGroups().length) {
      setTableMessage("No registered classes found.");
      return;
    }
    if (!selectedGroups().length) {
      setTableMessage("No registered classes found.");
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
      const { data: gradeGroups, error: groupError } = await state.client
        .from("teacher_grade_groups")
        .select("grade, stream")
        .eq("teacher_id", state.teacher.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true });
      if (groupError) throw groupError;
      console.log("Registered grade groups:", gradeGroups);

      const { data: assignments, error: assignmentError } = await state.client
        .from("teacher_subject_assignments")
        .select("grade, stream, subject")
        .eq("teacher_id", state.teacher.id);
      if (assignmentError) {
        console.error("Could not load registered class subjects.", assignmentError);
      }
      const subjectsByGroup = new Map();
      (assignments || []).forEach((assignment) => {
        const key = groupKey(assignment.grade, assignment.stream);
        const subjects = subjectsByGroup.get(key) || [];
        subjects.push(assignment.subject);
        subjectsByGroup.set(key, subjects);
      });
      state.groups = (gradeGroups || []).map((group) => ({
        grade: Number(group.grade),
        stream: normalizedStream(group.stream),
        subjects: subjectsByGroup.get(groupKey(group.grade, group.stream)) || [],
      })).filter((group) => Number.isInteger(group.grade) && group.grade >= 5 && group.grade <= 12);

      if (!selectedGroup()) {
        state.selectedGrade = "";
        state.selectedStream = "";
      }
    } catch (error) {
      console.error("Students teaching scope error:", error);
      console.error("Students teaching scope error details:", error);
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
    const loadId = ++state.studentLoadId;
    const groups = selectedGroups();
    if (!groups.length) {
      state.students = [];
      renderStudents();
      return;
    }

    state.loadingStudents = true;
    try {
      const results = await Promise.all(groups.map((group) => {
        let query = state.client
          .from("students")
          .select("id, student_id, full_name, email, profile_photo_url, grade, stream")
          .eq("grade", group.grade)
          .order("full_name", { ascending: true });
        query = group.stream ? query.eq("stream", group.stream) : query.is("stream", null);
        return query;
      }));
      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) throw failedResult.error;
      if (loadId !== state.studentLoadId) return;

      state.error = "";
      const uniqueStudents = new Map();
      results.flatMap((result) => result.data || []).forEach((student) => {
        uniqueStudents.set(student.id, student);
      });
      const authorizedStudents = [...uniqueStudents.values()]
        .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || "")));
      console.log("Students query result:", authorizedStudents.map(({ id, grade, stream }) => ({ id, grade, stream })));
      const students = await Promise.all(authorizedStudents.map(async (student) => {
        try {
          return {
            ...student,
            profile_photo_signed_url: await getStudentPhotoUrl(student.profile_photo_url),
          };
        } catch (photoError) {
          console.error("Could not sign student profile photo.", photoError);
          return {
            ...student,
            profile_photo_signed_url: /^https:\/\//i.test(student.profile_photo_url || "")
              ? student.profile_photo_url
              : "",
          };
        }
      }));
      if (loadId !== state.studentLoadId) return;
      state.students = students;
      state.loadingStudents = false;
      renderStudents();
    } catch (error) {
      if (loadId !== state.studentLoadId) return;
      state.loadingStudents = false;
      state.error = error.message || "Could not load students.";
      console.error("Could not load teacher-authorized students.", error);
      console.error("Students query error:", error);
      state.students = [];
      renderStudents();
    }
  }

  async function getStudentPhotoUrl(path) {
    if (!path) return "";
    if (/^https:\/\//i.test(path)) return path;

    const cached = photoUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { data, error } = await state.client.storage
      .from("student-profile-images")
      .createSignedUrl(path, 3600);
    if (error) throw error;
    photoUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 3_500_000 });
    return data.signedUrl;
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
    $("classFilter").replaceChildren(new Option("Loading classes...", ""));
    $("streamFilter").replaceChildren(new Option("Loading streams...", ""));
    $("subjectFilter").replaceChildren(new Option("Loading subjects...", ""));
    setTableMessage("Loading students...");

    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw new Error(`Could not verify your sign-in. ${error.message}`);
      if (!data?.user) {
        window.location.assign("../teacher_registration/login.html");
        return;
      }

      state.user = data.user;
      console.log("Authenticated teacher:", state.user.id);
      const { data: teacher, error: teacherError } = await client
        .from("teachers")
        .select("id, user_id")
        .eq("user_id", state.user.id)
        .single();

      if (teacherError) throw teacherError;
      if (!teacher || teacher.user_id !== state.user.id) {
        throw new Error("No teacher profile is linked to this account.");
      }
      state.teacher = teacher;
      console.log("Teacher record:", teacher);
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
      console.error("Students page initialization error details:", error);
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
      .subscribe((status, error) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.error("Students realtime subscription is unavailable.", error || status);
        }
      });
  }

  function selectGrade(grade) {
    if (!grade) {
      state.selectedGrade = "";
      state.selectedStream = "";
      state.selectedSubject = "";
      renderFilters();
      void loadStudents();
      return;
    }
    const [selectedGrade, selectedStream] = String(grade).split("|");
    if (!registeredGroups().some((group) =>
      groupKey(group.grade, group.stream) === groupKey(selectedGrade, selectedStream),
    )) return;
    state.selectedGrade = selectedGrade;
    state.selectedStream = normalizedStream(selectedStream);
    state.selectedSubject = "";
    renderFilters();
    void loadStudents();
  }

  function selectStream(stream) {
    state.selectedStream = stream;
    if (!selectedGroup()) {
      const firstGroup = groupsForSelectedGrade()[0];
      if (firstGroup) state.selectedStream = firstGroup.stream;
    }
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
