(() => {
  const getClient = () => window.SmartLearningSupabase?.getClient?.() || null;

  function normalizeTeacherRecord(value) {
    return {
      id: value?.id || null,
      user_id: value?.user_id || value?.teacher_user_id || null,
      name: value?.full_name || value?.name || value?.teacher_name || "Teacher",
      grade_groups: Array.isArray(value?.grade_groups) ? value.grade_groups : [],
      subject_assignments: Array.isArray(value?.subject_assignments) ? value.subject_assignments : [],
    };
  }

  async function requireTeacher() {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured.");
    }

    const { data: userResult, error: userError } = await client.auth.getUser();
    if (userError || !userResult?.user) {
      throw Object.assign(new Error("Authentication failed. Please sign in again."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: profile, error: profileError } = await client
      .from("teachers")
      .select("*")
      .eq("user_id", userResult.user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }
    if (!profile) {
      throw new Error("Teacher profile could not be found.");
    }

    return { client, user: userResult.user, profile: normalizeTeacherRecord(profile) };
  }

  async function getTeacherScope() {
    const { client, profile } = await requireTeacher();
    const teacherId = profile.id;
    const teacherUserId = profile.user_id;

    const [groupsResult, assignmentsResult] = await Promise.all([
      client.from("teacher_grade_groups").select("*").eq("teacher_id", teacherId),
      client.from("teacher_subject_assignments").select("*").eq("teacher_id", teacherId),
    ]);

    if (groupsResult.error) throw groupsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    return {
      teacherId,
      teacherUserId,
      groups: groupsResult.data || [],
      assignments: assignmentsResult.data || [],
    };
  }

  function dateFilterClause(range) {
    const start = range?.start ? new Date(range.start).toISOString() : null;
    const end = range?.end ? new Date(range.end).toISOString() : null;
    return { start, end };
  }

  function buildDateRange(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  function tableEvent(row, source, typeName, extra = {}) {
    const startAt = row.start_at || row.created_at || row.published_at || row.due_at || row.date;
    const endAt = row.end_at || row.deadline || row.due_at || startAt;
    return {
      id: `${source}-${row.id}`,
      source,
      source_id: row.id,
      type: typeName,
      title: row.title || row.name || row.topic || "Academic event",
      description: row.description || row.instructions || row.message || row.topic || "",
      class_grade: row.class_grade || row.grade || row.class || "",
      stream: row.stream || row.class_stream || "",
      subject: row.subject || row.subject_name || "",
      start_at: startAt,
      end_at: endAt,
      status: row.status || "scheduled",
      location: row.location || row.meeting_url || row.join_url || row.file_url || row.external_url || "",
      teacher_name: row.teacher_name || extra.teacher_name || "",
      duration_minutes: Number(row.duration_minutes || row.duration || 0) || null,
      question_count: row.question_count || row.questions_count || null,
      original_start_at: row.original_start_at || row.previous_start_at || null,
      ...extra,
    };
  }

  async function loadEvents(date = new Date()) {
    const { client, profile } = await requireTeacher();
    const range = buildDateRange(date);
    const teacherId = profile.id;
    const teacherUserId = profile.user_id;
    const queries = [];

    const collect = async (table, typeName, mapper, selector = null) => {
      let query = client.from(table).select("*");
      if (selector) {
        query = selector(query);
      }
      const { data, error } = await query;
      if (error) {
        return [];
      }
      return (data || []).map(mapper).filter(Boolean);
    };

    const liveClasses = await collect(
      "live_classes",
      "live_class",
      (row) => tableEvent(row, "live_classes", "live_class", { location: row.meeting_url || row.location || "" }),
      (query) => query.or(`teacher_id.eq.${teacherUserId},teacher_id.eq.${teacherId}`).gte("start_at", range.start.toISOString()).lte("start_at", range.end.toISOString())
    );

    const materials = await collect(
      "materials",
      "material",
      (row) => tableEvent(row, "materials", "material", { location: row.file_url || row.external_url || "" }),
      (query) => query.or(`teacher_id.eq.${teacherUserId},teacher_id.eq.${teacherId}`).gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString())
    );

    const quizzes = await collect(
      "quizzes",
      "quiz",
      (row) => tableEvent(row, "quizzes", row.status === "exam" ? "exam" : "quiz", {
        location: row.meeting_url || row.location || "",
      }),
      (query) => query.or(`teacher_id.eq.${teacherUserId},teacher_id.eq.${teacherId}`).gte("start_at", range.start.toISOString()).lte("start_at", range.end.toISOString())
    );

    const announcements = await collect(
      "announcements",
      "announcement",
      (row) => tableEvent(row, "announcements", "announcement", {
        location: row.location || row.link || "",
      }),
      (query) => query.or(`teacher_id.eq.${teacherUserId},teacher_id.eq.${teacherId}`).gte("published_at", range.start.toISOString()).lte("published_at", range.end.toISOString())
    );

    const calendarEvents = await collect(
      "calendar_events",
      "calendar_event",
      (row) => tableEvent(row, "calendar_events", row.event_type || "event"),
      (query) => query.eq("teacher_id", teacherId).gte("start_at", range.start.toISOString()).lte("start_at", range.end.toISOString())
    );

    const events = [...liveClasses, ...materials, ...quizzes, ...announcements, ...calendarEvents];
    return events.sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
  }

  async function subscribe(onChange) {
    const client = getClient();
    if (!client) return () => {};
    const tableNames = ["live_classes", "materials", "quizzes", "announcements", "calendar_events"];
    const channel = client.channel("teacher-calendar-realtime");
    tableNames.forEach((tableName) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableName },
        () => {
          onChange?.();
        },
      );
    });
    await channel.subscribe();
    return () => { client.removeChannel(channel); };
  }

  window.CalendarService = {
    loadEvents,
    subscribe,
    requireTeacher,
    getTeacherScope,
  };
})();
