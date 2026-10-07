(() => {
  let registeredTeachingScope = [];

  function normalizeStream(grade, stream) {
    return Number(grade) >= 11 ? String(stream || "").trim().toLowerCase() : "";
  }

  async function loadTeacherClasses() {
    await initializeAttendance();
    return [...new Set(registeredTeachingScope.map((group) => String(group.grade)))]
      .sort((left, right) => Number(left) - Number(right));
  }

  function loadTeacherSubjects(grade, stream = "") {
    const normalizedGrade = Number(grade);
    const normalizedStream = normalizeStream(normalizedGrade, stream);
    return registeredTeachingScope
      .filter((group) => group.grade === normalizedGrade && group.stream === normalizedStream)
      .flatMap((group) => group.subjects.map((subject) => subject.name));
  }

  async function initializeAttendance() {
    const client = window.TeacherData?.getSupabaseClient?.();
    if (!client) throw new Error("Supabase is not configured.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) {
      if (authError.name === "AuthSessionMissingError" || authError.code === "session_not_found") {
        throw Object.assign(new Error("Your session has expired. Please sign in again."), {
          code: "AUTH_REQUIRED",
          cause: authError,
        });
      }
      throw authError;
    }
    if (!authData?.user) {
      throw Object.assign(new Error("Sign in with a teacher account to manage attendance."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: teacher, error: teacherError } = await client
      .from("teachers")
      .select("id, user_id, full_name")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (teacherError) throw teacherError;
    if (!teacher || teacher.user_id !== authData.user.id) {
      throw Object.assign(new Error("No teacher profile is linked to this account."), {
        code: "TEACHER_UNAVAILABLE",
      });
    }

    registeredTeachingScope = await window.TeacherData.loadRegisteredTeachingScope(client, teacher.id);
    return { client, user: authData.user, teacher, groups: registeredTeachingScope };
  }

  async function loadRegisteredTeachingScope(client, teacherId) {
    registeredTeachingScope = await window.TeacherData.loadRegisteredTeachingScope(client, teacherId);
    return registeredTeachingScope;
  }

  async function loadAuthorizedAttendanceStudents(client, grade, stream) {
    const normalizedGrade = Number(grade);
    const normalizedStream = normalizeStream(normalizedGrade, stream);
    if (!Number.isInteger(normalizedGrade) || normalizedGrade < 5 || normalizedGrade > 12) {
      throw new Error("Select a valid registered grade.");
    }
    if (normalizedGrade >= 11 && !["science_pcm", "science_pcb", "commerce", "arts_humanities"].includes(normalizedStream)) {
      throw new Error("Select a valid registered stream.");
    }

    let query = client
      .from("students")
      .select("id, student_id, full_name, grade, stream, roll_number")
      .eq("grade", normalizedGrade)
      .order("full_name", { ascending: true });
    query = normalizedStream ? query.eq("stream", normalizedStream) : query.is("stream", null);
    return readAllRows(query);
  }

  async function ensureAttendanceSession(client, { grade, stream, subjectId, date }) {
    const { data, error } = await client.rpc("ensure_teacher_attendance_session", {
      requested_grade: Number(grade),
      requested_stream: normalizeStream(grade, stream) || null,
      requested_subject_id: subjectId,
      requested_attendance_date: date,
    });
    if (error) throw error;
    if (!data) throw new Error("The attendance session could not be created or loaded.");
    return String(data);
  }

  async function loadAttendanceSelection(client, teacherId, grade, stream, subjectId) {
    const normalizedGrade = Number(grade);
    const normalizedStream = normalizeStream(normalizedGrade, stream);
    let query = client
      .from("attendance_sessions")
      .select("id, teacher_id, grade, stream, subject_id, attendance_date, status, created_at, updated_at")
      .eq("teacher_id", teacherId)
      .eq("grade", normalizedGrade)
      .eq("subject_id", subjectId)
      .order("attendance_date", { ascending: false });
    query = normalizedStream ? query.eq("stream", normalizedStream) : query.is("stream", null);
    const sessions = await readAllRows(query);

    const sessionRows = sessions;
    if (!sessionRows.length) return { sessions: [], records: [] };
    const records = await readAllRows(client
      .from("attendance_records")
      .select("id, session_id, student_id, status, check_in, check_out, duration_minutes, remarks, created_at, updated_at")
      .in("session_id", sessionRows.map((session) => session.id)));

    const sessionById = new Map(sessionRows.map((session) => [String(session.id), session]));
    return {
      sessions: sessionRows,
      records: (records || []).map((record) => {
        const session = sessionById.get(String(record.session_id));
        return {
          ...record,
          grade: session?.grade,
          stream: session?.stream,
          subject_id: session?.subject_id,
          attendance_date: session?.attendance_date,
        };
      }),
    };
  }

  async function readAllRows(query) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
    }
  }

  function attendanceTimestamp(value, date, label) {
    if (!value) return null;
    const clock = String(value).trim();
    if (/^\d{2}:\d{2}$/.test(clock)) {
      const [hours, minutes] = clock.split(":").map(Number);
      if (hours > 23 || minutes > 59) throw new Error(`Enter a valid ${label} time.`);
      const timestamp = new Date(`${date}T${clock}:00`);
      if (Number.isNaN(timestamp.getTime())) throw new Error(`Enter a valid ${label} time.`);
      return timestamp;
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) throw new Error(`Enter a valid ${label} time.`);
    return timestamp;
  }

  async function saveAttendanceSession(client, { grade, stream, subjectId, date, records }) {
    if (!Array.isArray(records)) throw new Error("Attendance records must be a list.");
    const preparedRecords = records.map((record) => {
      const checkIn = attendanceTimestamp(record.check_in, date, "check-in");
      const checkOut = attendanceTimestamp(record.check_out, date, "check-out");
      if (checkIn && checkOut && checkOut < checkIn) {
        throw new Error("Check-out must be later than check-in.");
      }
      const status = String(record.status || "not_marked").trim().toLowerCase();
      if (!["present", "absent", "late", "not_marked"].includes(status)) {
        throw new Error("Select a valid attendance status.");
      }
      return {
        student_id: record.student_id,
        status,
        check_in: checkIn?.toISOString() || null,
        check_out: checkOut?.toISOString() || null,
        duration_minutes: checkIn && checkOut
          ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000)
          : null,
        remarks: String(record.remarks || "").trim() || null,
      };
    });

    const { data, error } = await client.rpc("save_teacher_attendance", {
      requested_grade: Number(grade),
      requested_stream: normalizeStream(grade, stream) || null,
      requested_subject_id: subjectId,
      requested_attendance_date: date,
      requested_records: preparedRecords,
    });
    if (error) throw error;
    if (!data) throw new Error("Attendance could not be saved.");
    return String(data);
  }

  function subscribeToAttendanceRealtime(client, teacherId, onChange, onError = () => {}) {
    const channel = client
      .channel(`teacher-attendance-${teacherId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "attendance_sessions",
        filter: `teacher_id=eq.${teacherId}`,
      }, onChange)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "attendance_records",
      }, onChange)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
      }, onChange)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "teacher_grade_groups",
        filter: `teacher_id=eq.${teacherId}`,
      }, onChange)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "teacher_subject_assignments",
        filter: `teacher_id=eq.${teacherId}`,
      }, onChange)
      .subscribe((status, error) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          const realtimeError = error || new Error(`Attendance realtime subscription failed: ${status}`);
          console.error("Attendance realtime subscription is unavailable.", realtimeError);
          onError(realtimeError);
        }
      });
    return () => client.removeChannel(channel);
  }

  function formatAttendanceTime(value) {
    if (!value) return "";
    const text = String(value);
    if (/^\d{2}:\d{2}$/.test(text)) return text;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return new Intl.DateTimeFormat("en", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  window.AttendanceService = {
    loadTeacherClasses,
    loadTeacherSubjects,
    loadRegisteredTeachingScope,
    initializeAttendance,
    loadAuthorizedAttendanceStudents,
    ensureAttendanceSession,
    loadAttendanceSelection,
    saveAttendanceSession,
    subscribeToAttendanceRealtime,
    formatAttendanceTime,
    formatDate,
  };
})();
