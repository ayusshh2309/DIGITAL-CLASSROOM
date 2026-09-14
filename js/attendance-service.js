(() => {
  const STORAGE_KEY = "smartLearningAttendance";
  const STUDENTS_KEY = "teacherStudents";
  const gradeGroups = {
    grades_5_6: ["5", "6"],
    grades_7_8: ["7", "8"],
    grades_9_10: ["9", "10"],
    grades_11_12: ["11", "12"],
  };
  const standardSubjects = {
    5: ["English", "Mathematics", "EVS", "Hindi"],
    6: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    7: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    8: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    9: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    10: ["English", "Mathematics", "Science", "Social Science", "Hindi"],
  };
  const streamSubjects = {
    science_pcm: ["Physics", "Chemistry", "Mathematics"],
    science_pcb: ["Physics", "Chemistry", "Biology"],
    commerce: ["Accountancy", "Business Studies", "Economics"],
    arts_humanities: [
      "History",
      "Geography",
      "Political Science",
      "Psychology",
    ],
  };
  const fallbackNames = [
    "Aarav Sharma",
    "Aanya Verma",
    "Arjun Patel",
    "Meera Singh",
    "Sahil Khan",
    "Ishita Gupta",
    "Karan Mehta",
    "Diya Nair",
  ];

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch {
      return fallback;
    }
  };
  const teacher = () =>
    readJson("teacherRegistration", null) ||
    readJson("teacherProfile", null) ||
    readJson("teacherData", null) ||
    readJson("finalTeacherRegistration", null) ||
    {};
  const teacherId = () =>
    teacher().authUserId ||
    teacher().id ||
    teacher().personal?.email ||
    "local-teacher";
  const normalizeGrade = (value) =>
    String(value ?? "").match(/\d+/)?.[0] || String(value ?? "");
  const assignments = () => {
    const professional = teacher().professional || {};
    const result = new Map();
    const add = (grade, subject) => {
      const normalized = normalizeGrade(grade);
      if (!normalized || !subject) return;
      if (!result.has(normalized)) result.set(normalized, new Set());
      result.get(normalized).add(String(subject));
    };
    const raw =
      professional.specialistAssignments ||
      professional.specialist_assignments ||
      professional.subjectAssignments ||
      {};
    const list = Array.isArray(raw)
      ? raw
      : Object.entries(raw).map(([subject, grades]) => ({ subject, grades }));
    list.forEach((item) =>
      (item.grades || []).forEach((grade) => add(grade, item.subject)),
    );
    const groups =
      professional.selected_grade_groups ||
      professional.gradeGroups ||
      professional.grade_groups ||
      [];
    const grades = [
      ...groups.flatMap((group) => gradeGroups[group] || []),
      ...(professional.grades || professional.selected_grades || []).map(
        normalizeGrade,
      ),
    ];
    const streams = professional.streams || professional.selected_streams || [];
    const senior = [
      ...new Set(
        streams
          .flatMap((stream) => streamSubjects[stream] || [])
          .concat(["English", "Physical Education", "Computer Science"]),
      ),
    ];
    if (!list.length)
      grades.forEach((grade) =>
        (Number(grade) >= 11
          ? senior
          : standardSubjects[grade] || professional.subjects || []
        ).forEach((subject) => add(grade, subject)),
      );
    if (!result.size && Array.isArray(professional.subjects))
      grades.forEach((grade) =>
        professional.subjects.forEach((subject) => add(grade, subject)),
      );
    return result;
  };

  function loadTeacherClasses() {
    return [...assignments().keys()].sort((a, b) => Number(a) - Number(b));
  }
  function loadTeacherSubjects(grade) {
    return [...(assignments().get(normalizeGrade(grade)) || [])];
  }
  function loadRegisteredStudents(grade) {
    const stored = readJson(STUDENTS_KEY, []);
    const filtered = stored.filter(
      (student) =>
        normalizeGrade(
          student.class_grade || student.grade || student.class,
        ) === normalizeGrade(grade) && student.status !== "Inactive",
    );
    if (filtered.length) return filtered.map(normalizeStudent);
    return [];
  }
  function normalizeStudent(student, index) {
    return {
      ...student,
      id: String(student.id || student.student_id || `student-${index}`),
      student_id: String(
        student.student_id || student.id || `SLDC-${index + 1}`,
      ),
      name: student.name || student.full_name || "Unnamed student",
      roll_no: String(
        student.roll_no || student.rollNumber || index + 1,
      ).padStart(2, "0"),
    };
  }
  function key({ grade, class_grade, subject, date, attendance_date }) {
    return `${teacherId()}|${normalizeGrade(class_grade ?? grade)}|${subject}|${attendance_date ?? date}`;
  }
  function readLocal() {
    return readJson(STORAGE_KEY, []);
  }
  function writeLocal(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
  function getAttendanceForDate(grade, subject, date) {
    return readLocal().filter(
      (record) =>
        record.teacher_id === teacherId() &&
        normalizeGrade(record.class_grade) === normalizeGrade(grade) &&
        record.subject === subject &&
        record.attendance_date === date,
    );
  }
  async function loadAttendance(grade, subject, date) {
    const client = window.SmartLearningSupabase?.getClient();
    if (client) {
      const { data, error } = await client
        .from("attendance")
        .select("*")
        .eq("teacher_id", teacherId())
        .eq("class_grade", normalizeGrade(grade))
        .eq("subject", subject)
        .eq("attendance_date", date);
      if (error) throw error;
      return data || [];
    }
    return getAttendanceForDate(grade, subject, date);
  }
  async function saveAttendance(records) {
    return updateAttendance(records);
  }
  async function updateAttendance(records) {
    const client = window.SmartLearningSupabase?.getClient();
    const payload = records.map((record) => ({
      ...record,
      teacher_id: teacherId(),
      class_grade: normalizeGrade(record.class_grade),
      updated_at: new Date().toISOString(),
    }));
    if (client) {
      const { data, error } = await client
        .from("attendance")
        .upsert(payload, {
          onConflict:
            "teacher_id,student_id,class_grade,subject,attendance_date",
        })
        .select();
      if (error) throw error;
      return data || payload;
    }
    const existing = readLocal().filter(
      (item) => !payload.some((record) => key(record) === key(item)),
    );
    writeLocal([...existing, ...payload]);
    return payload;
  }
  async function getAttendanceHistory(grade, subject) {
    const client = window.SmartLearningSupabase?.getClient();
    if (client) {
      const { data, error } = await client
        .from("attendance")
        .select("*")
        .eq("teacher_id", teacherId())
        .eq("class_grade", normalizeGrade(grade))
        .eq("subject", subject)
        .order("attendance_date", { ascending: false });
      if (error) throw error;
      return data || [];
    }
    return readLocal().filter(
      (record) =>
        record.teacher_id === teacherId() &&
        normalizeGrade(record.class_grade) === normalizeGrade(grade) &&
        record.subject === subject,
    );
  }
  async function exportAttendanceToExcel(options = {}) {
    const history = await getAttendanceHistory(options.grade, options.subject);
    const rows = history.map((record) => ({
      Date: record.attendance_date,
      "Student ID": record.student_id,
      "Student Name": record.student_name,
      Class: `Class ${record.class_grade}`,
      Subject: record.subject,
      Status: record.status,
      Remarks: record.remarks || "",
    }));
    if (!window.XLSX) {
      const csv = [
        Object.keys(rows[0] || { Date: "No records" }).join(","),
        ...rows.map((row) =>
          Object.values(row)
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "attendance-report.csv";
      link.click();
      return;
    }
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet([
        {
          Teacher:
            teacher().personal?.fullName || teacher().fullName || "Teacher",
          Class: `Class ${options.grade}`,
          Subject: options.subject,
          "Academic Year": new Date().getFullYear(),
          "Total Students": options.total || 0,
          "Average Attendance": `${options.rate || 0}%`,
        },
      ]),
      "Summary",
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(rows),
      "Daily Attendance",
    );
    const overview = [
      ...new Set(history.map((record) => record.student_id)),
    ].map((studentId) => {
      const studentRows = history.filter(
        (record) => record.student_id === studentId,
      );
      const present = studentRows.filter(
        (record) => record.status === "Present",
      ).length;
      const absent = studentRows.filter(
        (record) => record.status === "Absent",
      ).length;
      const late = studentRows.filter(
        (record) => record.status === "Late",
      ).length;
      return {
        "Student Name": studentRows[0]?.student_name || studentId,
        "Total Classes": studentRows.length,
        Present: present,
        Absent: absent,
        Late: late,
        "Attendance %": studentRows.length
          ? `${Math.round(((present + late) / studentRows.length) * 100)}%`
          : "0%",
      };
    });
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(overview),
      "Student Overview",
    );
    XLSX.writeFile(book, "attendance-report.xlsx");
  }
  function subscribeToAttendance({ grade, subject, date, onChange }) {
    const client = window.SmartLearningSupabase?.getClient();
    if (!client) return () => {};
    const channel = client
      .channel(`attendance-${teacherId()}-${normalizeGrade(grade)}-${subject}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance",
          filter: `teacher_id=eq.${teacherId()}`,
        },
        (payload) => {
          const record = payload.new || payload.old;
          if (
            record &&
            normalizeGrade(record.class_grade) === normalizeGrade(grade) &&
            record.subject === subject &&
            record.attendance_date === date
          )
            onChange(payload);
        },
      )
      .subscribe();
    return () => client.removeChannel(channel);
  }
  window.AttendanceService = {
    loadTeacherClasses,
    loadTeacherSubjects,
    loadRegisteredStudents,
    loadAttendance,
    saveAttendance,
    updateAttendance,
    getAttendanceForDate,
    getAttendanceHistory,
    exportAttendanceToExcel,
    subscribeToAttendance,
    teacherId,
  };
})();
