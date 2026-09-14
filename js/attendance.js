(() => {
  const state = {
    classes: [],
    grade: "",
    subject: "",
    date: "",
    students: [],
    records: [],
    history: [],
    month: new Date(),
    unsubscribeRealtime: () => {},
  };
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>\"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  const showToast = (message, error = false) => {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    if (error) node.style.background = "#b83d4b";
    $("toastRoot").replaceChildren(node);
    setTimeout(() => node.remove(), 3000);
  };
  const formatDate = (date) =>
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`));
  const activeRecord = (student) =>
    state.records.find(
      (record) => String(record.student_id) === String(student.student_id),
    );
  async function persistStatus(record) {
    try {
      await AttendanceService.updateAttendance([record]);
      state.records = await AttendanceService.loadAttendance(
        state.grade,
        state.subject,
        state.date,
      );
      state.history = await AttendanceService.getAttendanceHistory(
        state.grade,
        state.subject,
      );
      renderRows();
      renderHistory();
      renderCalendar();
    } catch (error) {
      showToast("Attendance status could not be saved.", true);
      console.error(error);
    }
  }
  function refreshRealtimeSubscription() {
    state.unsubscribeRealtime();
    state.unsubscribeRealtime = AttendanceService.subscribeToAttendance({
      grade: state.grade,
      subject: state.subject,
      date: state.date,
      onChange: async () => {
        state.records = await AttendanceService.loadAttendance(
          state.grade,
          state.subject,
          state.date,
        );
        state.history = await AttendanceService.getAttendanceHistory(
          state.grade,
          state.subject,
        );
        renderRows();
        renderHistory();
        renderCalendar();
      },
    });
  }
  const stats = () => {
    const statuses = state.students.map(
      (student) => activeRecord(student)?.status || "Unmarked",
    );
    const present = statuses.filter((status) => status === "Present").length;
    const absent = statuses.filter((status) => status === "Absent").length;
    const late = statuses.filter((status) => status === "Late").length;
    const rate = state.students.length
      ? Math.round(((present + late) / state.students.length) * 100)
      : 0;
    $("totalStat").textContent = state.students.length;
    $("presentStat").textContent = present;
    $("absentStat").textContent = absent;
    $("lateStat").textContent = late;
    $("rateStat").textContent = `${rate}%`;
    $("analytics").innerHTML = state.students.length
      ? `<div style="font-size:1.8rem;font-weight:800;color:#6548d8">${rate}%</div><p style="margin:6px 0;color:#718196;font-size:.75rem">${present} present · ${absent} absent · ${late} late</p>`
      : "No attendance data yet.";
    return { present, absent, late, rate };
  };
  function renderRows() {
    const search = $("studentSearch").value.toLowerCase();
    const filter = $("statusFilter").value;
    const rows = state.students.filter((student) => {
      const record = activeRecord(student);
      return (
        (!search ||
          `${student.name} ${student.student_id}`
            .toLowerCase()
            .includes(search)) &&
        (filter === "All" || (record?.status || "Unmarked") === filter)
      );
    });
    $("attendanceBody").innerHTML = rows.length
      ? rows
          .map((student) => {
            const record = activeRecord(student) || {
              status: "Unmarked",
              check_in: "",
              check_out: "",
              remarks: "",
            };
            return `<tr data-student="${esc(student.student_id)}"><td><button class="student-link" data-action="student">${esc(student.name)}</button></td><td>${esc(student.student_id)}<br><small style="color:#718196">Roll ${esc(student.roll_no)}</small></td><td><div class="status-group">${["Present", "Absent", "Late"].map((status) => `<button class="status-button ${status.toLowerCase()} ${record.status === status ? "active" : ""}" data-status="${status}">${status}</button>`).join("")}</div></td><td><input class="row-input" data-field="check_in" value="${esc(record.check_in)}" placeholder="09:00"></td><td><input class="row-input" data-field="check_out" value="${esc(record.check_out)}" placeholder="15:00"></td><td>${duration(record.check_in, record.check_out)}</td><td><input class="row-input" data-field="remarks" value="${esc(record.remarks)}" placeholder="Optional"></td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><strong>${state.classes.length ? "No students found" : "No registered classes found"}</strong><p>${state.classes.length ? "Students enrolled in this class will appear here." : "Complete teacher registration to configure attendance classes."}</p></div></td></tr>`;
    stats();
  }
  const duration = (start, end) => {
    if (!start || !end) return "—";
    const parse = (value) => {
      const match = String(value).match(/(\d{1,2}):(\d{2})/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    };
    const minutes = parse(end) - parse(start);
    return Number.isFinite(minutes) && minutes >= 0
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : "—";
  };
  function syncRecord(studentId, patch = {}) {
    const current = state.records.find(
      (record) => String(record.student_id) === String(studentId),
    );
    if (current) Object.assign(current, patch);
    else
      state.records.push({
        teacher_id: AttendanceService.teacherId(),
        student_id: studentId,
        student_name:
          state.students.find(
            (student) => String(student.student_id) === String(studentId),
          )?.name || "",
        class_grade: state.grade,
        subject: state.subject,
        attendance_date: state.date,
        status: "Unmarked",
        ...patch,
      });
  }
  function renderSubjects() {
    const subjects = AttendanceService.loadTeacherSubjects(state.grade);
    $("subjectSelect").innerHTML = subjects.length
      ? subjects.map((subject) => `<option>${esc(subject)}</option>`).join("")
      : `<option value="">No registered subjects</option>`;
    state.subject = subjects[0] || "";
  }
  async function loadRegister() {
    state.grade = $("classSelect").value;
    renderSubjects();
    state.subject = $("subjectSelect").value;
    state.date = $("dateSelect").value;
    state.students = state.grade
      ? AttendanceService.loadRegisteredStudents(state.grade)
      : [];
    try {
      state.records = state.subject
        ? await AttendanceService.loadAttendance(
            state.grade,
            state.subject,
            state.date,
          )
        : [];
      state.history = state.subject
        ? await AttendanceService.getAttendanceHistory(
            state.grade,
            state.subject,
          )
        : [];
      renderRows();
      renderHistory();
      renderCalendar();
      const summary = stats();
      const recorded = state.records.length > 0;
      $("recordedBanner").hidden = !recorded;
      $("recordedBanner").innerHTML = recorded
        ? `Attendance already recorded · ${summary.present} present · ${summary.absent} absent · ${summary.late} late · ${summary.rate}% attendance <button class="history-action" style="float:right" id="editRecorded">Edit attendance</button>`
        : "";
      $("tableTitle").textContent = state.grade
        ? `Class ${state.grade} · ${state.subject}`
        : "Attendance register";
      $("tableSubtitle").textContent = state.date
        ? formatDate(state.date)
        : "Select a date";
      refreshRealtimeSubscription();
    } catch (error) {
      showToast("Unable to load attendance records.", true);
      console.error(error);
    }
  }
  function renderHistory() {
    const groups = {};
    state.history.forEach((record) => {
      (groups[record.attendance_date] ||= []).push(record);
    });
    const rows = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    $("historyBody").innerHTML = rows.length
      ? rows
          .map(([date, records]) => {
            const present = records.filter(
              (record) => record.status === "Present",
            ).length;
            const absent = records.filter(
              (record) => record.status === "Absent",
            ).length;
            const late = records.filter(
              (record) => record.status === "Late",
            ).length;
            const rate = records.length
              ? Math.round(((present + late) / records.length) * 100)
              : 0;
            return `<tr><td>${formatDate(date)}</td><td>${present}</td><td>${absent}</td><td>${late}</td><td>${rate}%</td><td><span style="color:#139a70;font-weight:800">Completed</span></td><td><button class="history-action" data-date="${date}">View</button></td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty-state">No saved attendance for this class and subject yet.</td></tr>`;
  }
  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    $("calendarLabel").textContent = new Intl.DateTimeFormat("en", {
      month: "long",
      year: "numeric",
    }).format(state.month);
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const completed = new Set(
      state.history.map((record) => record.attendance_date),
    );
    let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map((day) => `<span>${day}</span>`)
      .join("");
    for (let index = 0; index < offset; index += 1)
      html += '<button class="calendar-day muted" disabled></button>';
    for (let day = 1; day <= days; day += 1) {
      const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      html += `<button class="calendar-day ${value === today() ? "today" : ""} ${value === state.date ? "selected" : ""} ${completed.has(value) ? "completed" : ""}" data-date="${value}">${day}</button>`;
    }
    $("calendarGrid").innerHTML = html;
  }
  function openDrawer(student) {
    const records = state.history.filter(
      (record) => String(record.student_id) === String(student.student_id),
    );
    const present = records.filter(
      (record) => record.status === "Present",
    ).length;
    const absent = records.filter(
      (record) => record.status === "Absent",
    ).length;
    const late = records.filter((record) => record.status === "Late").length;
    const rate = records.length
      ? Math.round(((present + late) / records.length) * 100)
      : 0;
    $("drawerRoot").innerHTML =
      `<div class="drawer-backdrop"><aside class="drawer"><button class="drawer-close" data-close><i class="fa-solid fa-xmark"></i></button><span class="eyebrow">Student attendance</span><h2 style="margin-top:8px">${esc(student.name)}</h2><p style="color:#718196">Class ${state.grade} · ${esc(state.subject)} · ${esc(student.student_id)}</p><div class="student-summary"><div><b>${records.length}</b><small>Total classes</small></div><div><b>${present}</b><small>Present</small></div><div><b>${absent}</b><small>Absent</small></div><div><b>${late}</b><small>Late</small></div><div><b>${rate}%</b><small>Overall attendance</small></div></div><h3 style="font-size:1rem">History</h3>${
        records.length
          ? records
              .sort((a, b) =>
                b.attendance_date.localeCompare(a.attendance_date),
              )
              .map(
                (record) =>
                  `<p style="display:flex;justify-content:space-between;border-bottom:1px solid #e5eaf1;padding:11px 0;font-size:.8rem"><span>${formatDate(record.attendance_date)}</span><strong>${record.status}</strong></p>`,
              )
              .join("")
          : `<p style="color:#718196;margin-top:12px">No saved records for this student.</p>`
      }</aside></div>`;
  }
  async function save() {
    const payload = state.records.filter(
      (record) => record.status && record.status !== "Unmarked",
    );
    if (!payload.length) {
      showToast("Mark at least one student before saving.", true);
      return;
    }
    try {
      await AttendanceService.saveAttendance(payload);
      state.records = await AttendanceService.loadAttendance(
        state.grade,
        state.subject,
        state.date,
      );
      state.history = await AttendanceService.getAttendanceHistory(
        state.grade,
        state.subject,
      );
      renderRows();
      renderHistory();
      renderCalendar();
      showToast("Attendance saved successfully.");
    } catch (error) {
      showToast("Attendance could not be saved.", true);
      console.error(error);
    }
  }
  document.addEventListener("DOMContentLoaded", async () => {
    state.classes = AttendanceService.loadTeacherClasses();
    $("classSelect").innerHTML = state.classes.length
      ? state.classes
          .map((grade) => `<option value="${grade}">Class ${grade}</option>`)
          .join("")
      : `<option value="">No registered classes</option>`;
    $("dateSelect").value = today();
    $("modeLabel").textContent = window.SmartLearningSupabase?.isConfigured()
      ? "Supabase mode"
      : "Local mode";
    await loadRegister();
    $("classSelect").addEventListener("change", loadRegister);
    $("subjectSelect").addEventListener("change", loadRegister);
    $("dateSelect").addEventListener("change", loadRegister);
    $("studentSearch").addEventListener("input", renderRows);
    $("statusFilter").addEventListener("change", renderRows);
    $("saveButton").addEventListener("click", save);
    $("markAllButton").addEventListener("click", () => {
      state.students.forEach((student) =>
        syncRecord(student.student_id, { status: "Present" }),
      );
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
    $("exportButton").addEventListener("click", () =>
      AttendanceService.exportAttendanceToExcel({
        grade: state.grade,
        subject: state.subject,
        total: state.students.length,
        rate: stats().rate,
      }),
    );
    $("attendanceBody").addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-student]");
      if (!row) return;
      const student = state.students.find(
        (item) => String(item.student_id) === row.dataset.student,
      );
      if (event.target.closest("[data-action=student]")) openDrawer(student);
      const status = event.target.closest("[data-status]")?.dataset.status;
      if (status) {
        syncRecord(student.student_id, { status });
        renderRows();
        void persistStatus(activeRecord(student));
      }
    });
    $("attendanceBody").addEventListener("change", (event) => {
      const row = event.target.closest("tr[data-student]");
      const field = event.target.dataset.field;
      if (row && field) {
        syncRecord(row.dataset.student, { [field]: event.target.value });
        renderRows();
      }
    });
    $("historyBody").addEventListener("click", (event) => {
      const date = event.target.closest("[data-date]")?.dataset.date;
      if (date) {
        $("dateSelect").value = date;
        loadRegister();
      }
    });
    $("calendarGrid").addEventListener("click", (event) => {
      const date = event.target.closest("[data-date]")?.dataset.date;
      if (date) {
        $("dateSelect").value = date;
        loadRegister();
      }
    });
    $("drawerRoot").addEventListener("click", (event) => {
      if (
        event.target.closest("[data-close]") ||
        event.target.classList.contains("drawer-backdrop")
      )
        $("drawerRoot").replaceChildren();
    });
  });
})();
