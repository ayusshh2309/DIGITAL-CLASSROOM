(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    groups: [],
    classes: [],
    grade: "",
    stream: "",
    subjectId: "",
    subject: "",
    date: "",
    students: [],
    sessions: [],
    records: [],
    history: [],
    drafts: new Map(),
    month: new Date(),
    channelCleanup: () => {},
    loading: false,
    saving: false,
    error: "",
    requestId: 0,
  };

  const $ = (id) => document.getElementById(id);
  const streamLabels = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
  const displayStatus = (status) => ({
    present: "Present",
    absent: "Absent",
    late: "Late",
    not_marked: "Not marked",
  }[status] || "Not marked");

  function showToast(message, isError = false) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    if (isError) node.style.background = "#b83d4b";
    $("toastRoot").replaceChildren(node);
    window.setTimeout(() => node.remove(), 3500);
  }

  function setTableMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-state";
    cell.textContent = message;
    row.appendChild(cell);
    $("attendanceBody").replaceChildren(row);
  }

  function groupForSelection() {
    return state.groups.find((group) =>
      group.grade === Number(state.grade) && (group.stream || "") === state.stream,
    ) || null;
  }

  function selectedRecords() {
    const session = state.sessions.find((item) => item.attendance_date === state.date);
    if (!session) return [];
    return state.records.filter((record) => String(record.session_id) === String(session.id));
  }

  function recordFor(student) {
    return state.drafts.get(String(student.id)) ||
      selectedRecords().find((record) => String(record.student_id) === String(student.id)) ||
      { student_id: student.id, status: "not_marked", check_in: null, check_out: null, duration_minutes: null, remarks: "" };
  }

  function currentStats() {
    const records = state.students.map(recordFor);
    const present = records.filter((record) => record.status === "present").length;
    const absent = records.filter((record) => record.status === "absent").length;
    const late = records.filter((record) => record.status === "late").length;
    const rate = state.students.length ? Math.round(((present + late) / state.students.length) * 100) : 0;
    $("totalStat").textContent = String(state.students.length);
    $("presentStat").textContent = String(present);
    $("absentStat").textContent = String(absent);
    $("lateStat").textContent = String(late);
    $("rateStat").textContent = `${rate}%`;
    $("analytics").innerHTML = state.students.length
      ? `<div style="font-size:1.8rem;font-weight:800;color:#6548d8">${rate}%</div><p style="margin:6px 0;color:#718196;font-size:.75rem">${state.students.length} students · ${present} present · ${absent} absent · ${late} late</p>`
      : "No attendance data yet.";
    return { present, absent, late, rate };
  }

  function formatDuration(minutes) {
    if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return "—";
    const value = Number(minutes);
    return `${Math.floor(value / 60)}h ${value % 60}m`;
  }

  function displayedDuration(record) {
    const checkIn = AttendanceService.formatAttendanceTime(record.check_in);
    const checkOut = AttendanceService.formatAttendanceTime(record.check_out);
    if (checkIn && checkOut) {
      const toMinutes = (value) => {
        const [hours, minutes] = value.split(":").map(Number);
        return hours * 60 + minutes;
      };
      const difference = toMinutes(checkOut) - toMinutes(checkIn);
      if (difference >= 0) return formatDuration(difference);
    }
    return formatDuration(record.duration_minutes);
  }

  function renderRows() {
    if (state.loading) {
      setTableMessage("Loading attendance...");
      return;
    }
    if (state.error) {
      setTableMessage(state.error);
      return;
    }
    if (!state.classes.length) {
      setTableMessage("No registered classes found.");
      return;
    }
    if (!state.grade || !groupForSelection() || !state.subjectId || !state.date) {
      setTableMessage("Select a registered class, stream, subject, and date.");
      return;
    }
    if (!state.students.length) {
      setTableMessage("No students registered for this class.");
      currentStats();
      return;
    }

    const search = $("studentSearch").value.trim().toLocaleLowerCase();
    const filter = $("statusFilter").value;
    const rows = state.students.filter((student) => {
      const record = recordFor(student);
      const matchesSearch = [
        student.full_name,
        student.student_id,
        student.roll_number,
      ].some((value) => String(value || "").toLocaleLowerCase().includes(search));
      return matchesSearch && (filter === "All" || record.status === filter);
    });

    $("attendanceBody").innerHTML = rows.length
      ? rows.map((student) => {
        const record = recordFor(student);
        const checkIn = AttendanceService.formatAttendanceTime(record.check_in);
        const checkOut = AttendanceService.formatAttendanceTime(record.check_out);
        return `<tr data-student="${escapeHtml(student.id)}"><td><button class="student-link" data-action="student">${escapeHtml(student.full_name)}</button></td><td>${escapeHtml(student.student_id)}<br><small style="color:#718196">Roll ${escapeHtml(student.roll_number || "—")}</small></td><td><div class="status-group">${["present", "absent", "late"].map((status) => `<button class="status-button ${status} ${record.status === status ? "active" : ""}" data-status="${status}">${displayStatus(status)}</button>`).join("")}${record.status === "not_marked" ? '<span class="attendance-unmarked">Not marked</span>' : ""}</div></td><td><input class="row-input" data-field="check_in" type="time" value="${escapeHtml(checkIn)}" aria-label="Check in time for ${escapeHtml(student.full_name)}"></td><td><input class="row-input" data-field="check_out" type="time" value="${escapeHtml(checkOut)}" aria-label="Check out time for ${escapeHtml(student.full_name)}"></td><td>${displayedDuration(record)}</td><td><input class="row-input" data-field="remarks" value="${escapeHtml(record.remarks || "")}" placeholder="Optional" aria-label="Remarks for ${escapeHtml(student.full_name)}"></td></tr>`;
      }).join("")
      : `<tr><td colspan="7" class="empty-state">No students match your search or status filter.</td></tr>`;
    currentStats();
  }

  function renderClassOptions() {
    const select = $("classSelect");
    const grades = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
    select.replaceChildren(...(grades.length
      ? grades.map((grade) => new Option(`Class ${grade}`, String(grade)))
      : [new Option(state.loading ? "Loading registered classes..." : "No registered classes found", "")]));
    if (grades.includes(Number(state.grade))) select.value = state.grade;
    else {
      state.grade = grades.length ? String(grades[0]) : "";
      select.value = state.grade;
    }
  }

  function renderStreamOptions() {
    const select = $("streamSelect");
    const available = [...new Set(state.groups
      .filter((group) => group.grade === Number(state.grade))
      .map((group) => group.stream || "")
      .filter(Boolean))];
    if (Number(state.grade) < 11) {
      state.stream = "";
      select.replaceChildren(new Option("Not applicable", ""));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.replaceChildren(...(available.length
      ? available.map((stream) => new Option(streamLabels[stream] || stream, stream))
      : [new Option("No registered streams", "")]));
    if (!available.includes(state.stream)) state.stream = available[0] || "";
    select.value = state.stream;
  }

  function renderSubjectOptions() {
    const select = $("subjectSelect");
    const group = groupForSelection();
    const subjects = group?.subjects || [];
    select.replaceChildren(...(subjects.length
      ? subjects.map((subject) => new Option(subject.name, String(subject.id)))
      : [new Option(state.loading ? "Loading subjects..." : "No registered subjects", "")]));
    if (subjects.some((subject) => String(subject.id) === state.subjectId)) {
      select.value = state.subjectId;
      state.subject = subjects.find((subject) => String(subject.id) === state.subjectId)?.name || "";
    } else {
      state.subjectId = subjects.length ? String(subjects[0].id) : "";
      state.subject = subjects[0]?.name || "";
      select.value = state.subjectId;
    }
    const currentSubject = $("currentSubject");
    if (currentSubject) currentSubject.textContent = state.subject || "Select a subject";
  }

  function renderHistory() {
    const recordsBySession = new Map();
    state.history.forEach((record) => {
      const rows = recordsBySession.get(String(record.session_id)) || [];
      rows.push(record);
      recordsBySession.set(String(record.session_id), rows);
    });
    $("historyBody").innerHTML = state.sessions.length
      ? state.sessions.map((session) => {
        const rows = recordsBySession.get(String(session.id)) || [];
        const present = rows.filter((record) => record.status === "present").length;
        const absent = rows.filter((record) => record.status === "absent").length;
        const late = rows.filter((record) => record.status === "late").length;
        const total = rows.length;
        const rate = total ? Math.round(((present + late) / total) * 100) : 0;
        return `<tr><td>${escapeHtml(AttendanceService.formatDate(session.attendance_date))}</td><td>${present}</td><td>${absent}</td><td>${late}</td><td>${rate}%</td><td><span style="color:${session.status === "completed" ? "#139a70" : "#718196"};font-weight:800">${session.status === "completed" ? "Completed" : "Draft"}</span></td><td><button class="history-action" data-date="${escapeHtml(session.attendance_date)}">View</button></td></tr>`;
      }).join("")
      : `<tr><td colspan="7" class="empty-state">No attendance data yet.</td></tr>`;
  }

  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    $("calendarLabel").textContent = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(state.month);
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const completed = new Set(state.sessions.filter((session) => session.status === "completed").map((session) => session.attendance_date));
    let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => `<span>${day}</span>`).join("");
    for (let index = 0; index < offset; index += 1) html += '<button class="calendar-day muted" disabled></button>';
    for (let day = 1; day <= days; day += 1) {
      const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      html += `<button class="calendar-day ${value === today() ? "today" : ""} ${value === state.date ? "selected" : ""} ${completed.has(value) ? "completed" : ""}" data-date="${value}">${day}</button>`;
    }
    $("calendarGrid").innerHTML = html;
  }

  function renderDrawer(student) {
    const rows = state.history.filter((record) => String(record.student_id) === String(student.id));
    const present = rows.filter((record) => record.status === "present").length;
    const absent = rows.filter((record) => record.status === "absent").length;
    const late = rows.filter((record) => record.status === "late").length;
    const rate = rows.length ? Math.round(((present + late) / rows.length) * 100) : 0;
    $("drawerRoot").innerHTML = `<div class="drawer-backdrop"><aside class="drawer"><button class="drawer-close" data-close><i class="fa-solid fa-xmark"></i></button><span class="eyebrow">Student attendance</span><h2 style="margin-top:8px">${escapeHtml(student.full_name)}</h2><p style="color:#718196">Class ${state.grade}${state.stream ? ` · ${escapeHtml(streamLabels[state.stream] || state.stream)}` : ""} · ${escapeHtml(student.student_id)}</p><div class="student-summary"><div><b>${rows.length}</b><small>Total classes</small></div><div><b>${present}</b><small>Present</small></div><div><b>${absent}</b><small>Absent</small></div><div><b>${late}</b><small>Late</small></div><div><b>${rate}%</b><small>Overall attendance</small></div></div><h3 style="font-size:1rem">History</h3>${rows.length ? rows.slice().sort((left, right) => right.attendance_date.localeCompare(left.attendance_date)).map((record) => `<p style="display:flex;justify-content:space-between;border-bottom:1px solid #e5eaf1;padding:11px 0;font-size:.8rem"><span>${escapeHtml(AttendanceService.formatDate(record.attendance_date))}</span><strong>${displayStatus(record.status)}</strong></p>`).join("") : `<p style="color:#718196;margin-top:12px">No attendance data yet.</p>`}</aside></div>`;
  }

  function validateSelection() {
    const group = groupForSelection();
    if (!state.teacher || !state.user) throw new Error("Sign in with a teacher account to manage attendance.");
    if (!group) throw new Error("Select a grade and stream in your registered teaching scope.");
    if ((Number(state.grade) >= 11) && !state.stream) throw new Error("Select a registered stream.");
    if (!state.subjectId || !group.subjects.some((subject) => String(subject.id) === state.subjectId)) {
      throw new Error("Select a subject registered for this grade and stream.");
    }
    if (!state.date || Number.isNaN(new Date(`${state.date}T00:00:00`).getTime())) throw new Error("Select a valid attendance date.");
    return group;
  }

  async function loadRegister({ preserveDrafts = false } = {}) {
    if (!state.client || !state.teacher || !state.grade || !state.subjectId) {
      renderRows();
      return;
    }
    const requestId = ++state.requestId;
    state.loading = true;
    state.error = "";
    $("tableSubtitle").textContent = "Loading students and attendance...";
    renderRows();
    try {
      const group = validateSelection();
      const [students, attendance] = await Promise.all([
        AttendanceService.loadAuthorizedAttendanceStudents(state.client, state.grade, group.stream),
        AttendanceService.loadAttendanceSelection(state.client, state.teacher.id, state.grade, group.stream, state.subjectId),
      ]);
      if (requestId !== state.requestId) return;
      const drafts = preserveDrafts ? state.drafts : new Map();
      state.students = students;
      state.sessions = attendance.sessions;
      state.records = attendance.records;
      state.history = attendance.records;
      state.drafts = new Map([...drafts].filter(([studentId]) => students.some((student) => String(student.id) === studentId)));
      const session = state.sessions.find((item) => item.attendance_date === state.date);
      const recorded = Boolean(session && session.status === "completed");
      $("recordedBanner").hidden = !recorded;
      $("recordedBanner").textContent = recorded ? "Attendance completed for this class, subject, and date. You can edit and save it again." : "";
      $("tableTitle").textContent = `Class ${state.grade}${state.stream ? ` · ${streamLabels[state.stream] || state.stream}` : ""} · ${state.subject}`;
      $("tableSubtitle").textContent = state.date ? AttendanceService.formatDate(state.date) : "Select a date";
      state.loading = false;
      renderRows();
      renderHistory();
      renderCalendar();
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.loading = false;
      state.students = [];
      state.records = [];
      state.sessions = [];
      state.history = [];
      state.error = "Unable to load attendance. Please try again.";
      $("tableSubtitle").textContent = state.error;
      console.error("Attendance loading error:", error);
      renderRows();
      renderHistory();
      renderCalendar();
      showToast(state.error, true);
    }
  }

  async function loadScope() {
    state.loading = true;
    state.error = "";
    $("classSelect").replaceChildren(new Option("Loading registered classes...", ""));
    $("streamSelect").replaceChildren(new Option("Loading streams...", ""));
    $("subjectSelect").replaceChildren(new Option("Loading subjects...", ""));
    setTableMessage("Loading teacher...");
    try {
      const initialized = await AttendanceService.initializeAttendance();
      state.client = initialized.client;
      state.user = initialized.user;
      state.teacher = initialized.teacher;
      state.groups = initialized.groups;
      state.classes = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
      if (!state.user) throw new Error("Sign in with a teacher account to manage attendance.");
      renderClassOptions();
      renderStreamOptions();
      renderSubjectOptions();
      $("modeLabel").textContent = "Supabase mode";
      $("dateSelect").value = state.date;
      state.loading = false;
      if (!state.classes.length) {
        state.error = "";
        setTableMessage("No registered classes found.");
        currentStats();
        renderHistory();
        renderCalendar();
      } else {
        await loadRegister();
      }
      state.channelCleanup = AttendanceService.subscribeToAttendanceRealtime(
        state.client,
        state.teacher.id,
        (payload) => {
          if (["teacher_grade_groups", "teacher_subject_assignments"].includes(payload?.table)) {
            void refreshScopeAfterChange();
          } else {
            void loadRegister({ preserveDrafts: true });
          }
        },
      );
    } catch (error) {
      state.loading = false;
      if (error.code === "AUTH_REQUIRED") {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      state.error = "Unable to load attendance. Please try again.";
      $("modeLabel").textContent = "Supabase unavailable";
      $("tableSubtitle").textContent = state.error;
      console.error("Attendance initialization error:", error);
      renderRows();
      renderHistory();
      renderCalendar();
      showToast(state.error, true);
    }
  }

  async function refreshScopeAfterChange() {
    try {
      state.groups = await window.TeacherData.loadRegisteredTeachingScope(state.client, state.teacher.id);
      state.classes = [...new Set(state.groups.map((group) => group.grade))].sort((left, right) => left - right);
      state.drafts.clear();
      renderClassOptions();
      renderStreamOptions();
      renderSubjectOptions();
      await loadRegister();
    } catch (error) {
      console.error("Attendance teaching scope update failed:", error);
      showToast("Unable to refresh your registered grades and subjects.", true);
    }
  }

  function changeScope() {
    state.drafts.clear();
    renderStreamOptions();
    renderSubjectOptions();
    void loadRegister();
  }

  function editRecord(student, changes) {
    const original = recordFor(student);
    state.drafts.set(String(student.id), { ...original, student_id: student.id, ...changes });
    renderRows();
  }

  async function save() {
    if (state.saving) return;
    try {
      validateSelection();
      if (!state.students.length) {
        showToast("No students registered for this class.", true);
        return;
      }
      state.saving = true;
      $("saveButton").disabled = true;
      $("saveButton").textContent = "Saving attendance...";
      const records = state.students.map((student) => {
        const record = recordFor(student);
        return {
          student_id: student.id,
          status: record.status || "not_marked",
          check_in: record.check_in || "",
          check_out: record.check_out || "",
          remarks: record.remarks || "",
        };
      });
      await AttendanceService.saveAttendanceSession(state.client, {
        grade: state.grade,
        stream: state.stream,
        subjectId: state.subjectId,
        date: state.date,
        records,
      });
      state.drafts.clear();
      await loadRegister();
      showToast("Attendance saved successfully.");
    } catch (error) {
      console.error("Attendance save error:", error);
      showToast(error.message || "Attendance could not be saved. Please try again.", true);
    } finally {
      state.saving = false;
      $("saveButton").disabled = false;
      $("saveButton").innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save attendance';
    }
  }

  async function exportReport() {
    try {
      validateSelection();
      if (!window.XLSX) throw new Error("Excel export is unavailable. Please try again later.");
      $("exportButton").disabled = true;
      $("exportButton").textContent = "Exporting report...";
      const data = state.students.map((student) => {
        const record = selectedRecords().find((item) => String(item.student_id) === String(student.id)) ||
          { status: "not_marked", check_in: null, check_out: null, duration_minutes: null, remarks: "" };
        return {
          "Student Name": student.full_name,
          "Student ID": student.student_id,
          "Roll Number": student.roll_number || "",
          Grade: state.grade,
          Stream: state.stream ? (streamLabels[state.stream] || state.stream) : "",
          Subject: state.subject,
          Date: state.date,
          Status: displayStatus(record.status),
          "Check In": AttendanceService.formatAttendanceTime(record.check_in),
          "Check Out": AttendanceService.formatAttendanceTime(record.check_out),
          Duration: displayedDuration(record),
          Remarks: record.remarks || "",
        };
      });
      const book = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(data), "Attendance");
      const streamToken = state.stream
        ? (state.stream.replace(/^science_/, "").replace("_humanities", "-humanities"))
        : "";
      const scope = [`grade-${state.grade}`, streamToken, state.subject, state.date]
        .filter(Boolean)
        .map((part) => String(part).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
        .join("-");
      window.XLSX.writeFile(book, `attendance-${scope}.xlsx`);
    } catch (error) {
      console.error("Attendance export error:", error);
      showToast(error.message || "Unable to export attendance.", true);
    } finally {
      $("exportButton").disabled = false;
      $("exportButton").innerHTML = '<i class="fa-solid fa-file-export"></i> Export report';
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    state.date = today();
    $("dateSelect").value = state.date;
    $("statusFilter").replaceChildren(
      new Option("All statuses", "All"),
      new Option("Present", "present"),
      new Option("Absent", "absent"),
      new Option("Late", "late"),
      new Option("Not marked", "not_marked"),
    );
    $("saveButton").addEventListener("click", () => void save());
    $("exportButton").addEventListener("click", () => void exportReport());
    $("classSelect").addEventListener("change", () => {
      state.grade = $("classSelect").value;
      state.stream = "";
      state.subjectId = "";
      changeScope();
    });
    $("streamSelect").addEventListener("change", () => {
      state.stream = $("streamSelect").value;
      state.subjectId = "";
      changeScope();
    });
    $("subjectSelect").addEventListener("change", () => {
      state.subjectId = $("subjectSelect").value;
      state.subject = $("subjectSelect").selectedOptions[0]?.textContent || "";
      const currentSubject = $("currentSubject");
      if (currentSubject) currentSubject.textContent = state.subject || "Select a subject";
      state.drafts.clear();
      void loadRegister();
    });
    $("dateSelect").addEventListener("change", () => {
      state.date = $("dateSelect").value;
      state.drafts.clear();
      void loadRegister();
    });
    $("studentSearch").addEventListener("input", renderRows);
    $("statusFilter").addEventListener("change", renderRows);
    $("markAllButton").addEventListener("click", () => {
      state.students.forEach((student) => {
        const record = recordFor(student);
        state.drafts.set(String(student.id), { ...record, student_id: student.id, status: "present" });
      });
      renderRows();
    });
    $("prevMonth").addEventListener("click", () => {
      state.month.setMonth(state.month.getMonth() - 1);
      renderCalendar();
    });
    $("nextMonth").addEventListener("click", () => {
      state.month.setMonth(state.month.getMonth() + 1);
      renderCalendar();
    });
    $("attendanceBody").addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-student]");
      if (!row) return;
      const student = state.students.find((item) => String(item.id) === row.dataset.student);
      if (!student) return;
      if (event.target.closest("[data-action=student]")) renderDrawer(student);
      const status = event.target.closest("[data-status]")?.dataset.status;
      if (status) editRecord(student, { status });
    });
    $("attendanceBody").addEventListener("change", (event) => {
      const row = event.target.closest("tr[data-student]");
      const field = event.target.dataset.field;
      if (!row || !["check_in", "check_out", "remarks"].includes(field)) return;
      const student = state.students.find((item) => String(item.id) === row.dataset.student);
      if (student) editRecord(student, { [field]: event.target.value });
    });
    $("historyBody").addEventListener("click", (event) => {
      const date = event.target.closest("[data-date]")?.dataset.date;
      if (!date) return;
      $("dateSelect").value = date;
      state.date = date;
      state.drafts.clear();
      void loadRegister();
    });
    $("calendarGrid").addEventListener("click", (event) => {
      const date = event.target.closest("[data-date]")?.dataset.date;
      if (!date) return;
      $("dateSelect").value = date;
      state.date = date;
      state.drafts.clear();
      void loadRegister();
    });
    $("drawerRoot").addEventListener("click", (event) => {
      if (event.target.closest("[data-close]") || event.target.classList.contains("drawer-backdrop")) {
        $("drawerRoot").replaceChildren();
      }
    });
    window.addEventListener("beforeunload", () => state.channelCleanup(), { once: true });
    void loadScope();
  });
})();
