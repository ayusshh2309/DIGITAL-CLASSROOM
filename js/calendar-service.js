(() => {
  const EVENT_TYPES = new Set([
    "event",
    "holiday",
    "material",
    "quiz",
    "live_class",
    "announcement",
  ]);
  let activeChannel = null;

  const getClient = () => window.SmartLearningSupabase?.getClient?.() || null;

  function isMissingTableError(error, table) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    return ["42P01", "PGRST205"].includes(code) && message.includes(table.toLowerCase());
  }

  function buildDateRange(date = new Date()) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return { start, end };
  }

  function normalizeTeacherRecord(value) {
    return {
      id: value?.id || null,
      user_id: value?.user_id || null,
    };
  }

  async function requireTeacher() {
    const client = getClient();
    if (!client) throw new Error("Supabase is not configured.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) {
      throw Object.assign(new Error("Authentication failed. Please sign in again."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: profile, error: profileError } = await client
      .from("teachers")
      .select("id, user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error("Teacher profile could not be found.");

    return {
      client,
      user: authData.user,
      profile: normalizeTeacherRecord(profile),
    };
  }

  async function getTeacherScope(client, teacherId) {
    const [groupsResult, assignmentsResult] = await Promise.all([
      client.from("teacher_grade_groups")
        .select("grade, stream, teach_all_subjects")
        .eq("teacher_id", teacherId),
      client.from("teacher_subject_assignments")
        .select("grade, stream, subject_id, subject")
        .eq("teacher_id", teacherId),
    ]);
    if (groupsResult.error) throw groupsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;
    return {
      groups: groupsResult.data || [],
      assignments: assignmentsResult.data || [],
    };
  }

  function normalizeStream(value) {
    return String(value || "").trim().toLowerCase();
  }

  async function validateEvent(input, scope, client) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("Enter an event title.");
    if (title.length > 160) throw new Error("Event titles must be 160 characters or fewer.");
    if (!EVENT_TYPES.has(input.event_type)) throw new Error("Choose a valid event type.");

    const start = new Date(input.start_at);
    if (!Number.isFinite(start.getTime())) throw new Error("Enter a valid start date and time.");

    const end = input.end_at ? new Date(input.end_at) : null;
    if (input.end_at && (!Number.isFinite(end.getTime()) || end <= start)) {
      throw new Error("The end time must be later than the start time.");
    }

    const grade = input.grade === "" || input.grade == null ? null : Number(input.grade);
    const stream = String(input.stream || "").trim() || null;
    const subjectId = input.subject_id === "" || input.subject_id == null
      ? null
      : String(input.subject_id).trim();
    if (grade !== null && (!Number.isInteger(grade) || grade < 1 || grade > 12)) {
      throw new Error("Choose a valid class grade.");
    }
    if (subjectId !== null && !/^\d+$/.test(subjectId)) {
      throw new Error("Enter a valid subject ID.");
    }

    if (grade !== null) {
      const group = scope.groups.find((item) =>
        Number(item.grade) === grade
        && (grade < 11
          ? !item.stream && !stream
          : normalizeStream(item.stream) === normalizeStream(stream)));
      if (!group) throw new Error("Choose a class and stream assigned to your teacher profile.");

      if (subjectId !== null && !group.teach_all_subjects) {
        const assignedById = scope.assignments.some((item) =>
          Number(item.grade) === grade
          && normalizeStream(item.stream) === normalizeStream(stream)
          && String(item.subject_id) === subjectId);
        let subjectName = "";
        if (!assignedById) {
          const { data: subject, error } = await client.from("subjects")
            .select("id, name")
            .eq("id", subjectId)
            .maybeSingle();
          if (error) throw error;
          subjectName = String(subject?.name || "").trim().toLowerCase();
        }
        const assignedByName = subjectName && scope.assignments.some((item) =>
          Number(item.grade) === grade
          && normalizeStream(item.stream) === normalizeStream(stream)
          && String(item.subject || "").trim().toLowerCase() === subjectName);
        const assigned = assignedById || assignedByName;
        if (!assigned) throw new Error("Choose a subject assigned to this class.");
      }
    } else if (stream || subjectId !== null) {
      throw new Error("A class grade is required when specifying a stream or subject.");
    }

    return {
      title,
      description: String(input.description || "").trim() || null,
      event_type: input.event_type,
      grade,
      stream,
      subject_id: subjectId,
      start_at: start.toISOString(),
      end_at: end ? end.toISOString() : null,
      all_day: Boolean(input.all_day),
      location: String(input.location || "").trim() || null,
      meeting_url: String(input.meeting_url || "").trim() || null,
      is_visible_to_students: Boolean(input.is_visible_to_students),
    };
  }

  function normalizeCalendarRow(row) {
    const start = new Date(row.start_at);
    if (!Number.isFinite(start.getTime())) return null;
    const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    return {
      ...row,
      id: `calendar_events-${row.id}`,
      calendar_id: row.id,
      source: row.source_table || "calendar_events",
      source_id: row.source_id || row.id,
      type: row.event_type || "event",
      class_grade: row.grade ?? "",
      subject: subject?.name || row.subject_name || row.subject || "",
      start_at: start.toISOString(),
      end_at: row.end_at ? new Date(row.end_at).toISOString() : null,
      location: row.location || row.meeting_url || "",
    };
  }

  function normalizeSourceRow(row, source) {
    const status = String(row.status || "").trim().toLowerCase();
    if (source === "materials" && status && status !== "published") return null;
    if (source === "quizzes" && !["published", "scheduled", "exam"].includes(status)) return null;
    if (source === "announcements" && !["published", "scheduled"].includes(status)) return null;
    if (source === "assignments" && status && status !== "published") return null;

    const startValue = source === "live_classes"
      ? row.start_at || (row.class_date ? `${row.class_date}T${row.start_time || "00:00:00"}` : null)
      : source === "materials"
        ? row.uploaded_at || row.created_at
        : source === "quizzes"
          ? row.start_at || row.published_at || row.created_at
          : source === "announcements"
            ? status === "scheduled"
              ? row.publish_at
              : row.published_at || row.publish_at || row.created_at
            : source === "assignments"
              ? row.due_at
              : null;
    const start = startValue ? new Date(startValue) : null;
    if (!start || !Number.isFinite(start.getTime())) return null;

    const duration = Number(row.duration_minutes || row.duration || 0);
    const endValue = row.end_at || row.due_at || row.deadline
      || (duration > 0 ? new Date(start.getTime() + duration * 60_000).toISOString() : null);
    const end = endValue ? new Date(endValue) : null;
    const type = source === "live_classes" ? "live_class"
      : source === "materials" ? "material"
        : source === "quizzes" ? (status === "exam" || row.event_type === "exam" ? "exam" : "quiz")
          : source === "announcements" ? "announcement"
            : "assignment";

    return {
      id: `${source}-${row.id}`,
      source,
      source_id: row.id,
      source_table: source,
      type,
      title: row.title || row.name || row.topic || "Academic event",
      description: row.description || row.instructions || row.message || row.topic || "",
      class_grade: row.grade || row.class_grade || row.class || "",
      stream: row.stream || row.class_stream || "",
      subject: row.subject_name || row.subject || "",
      subject_id: row.subject_id || null,
      start_at: start.toISOString(),
      end_at: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
      status: row.status || "scheduled",
      location: row.location || row.meeting_url || row.join_url || row.file_url || row.external_url || "",
      duration_minutes: duration || null,
      question_count: row.question_count || row.questions_count || null,
    };
  }

  async function loadEvents(date = new Date()) {
    const { client, profile } = await requireTeacher();
    const range = buildDateRange(date);
    const teacherIds = [...new Set([profile.id, profile.user_id].filter(Boolean))];
    const tables = ["live_classes", "materials", "quizzes", "announcements", "assignments"];
    const [calendarResult, ...sourceResults] = await Promise.all([
      client.from("calendar_events")
        .select("*")
        .eq("teacher_id", profile.id)
        .gte("start_at", range.start.toISOString())
        .lt("start_at", range.end.toISOString())
        .order("start_at", { ascending: true }),
      ...tables.map((table) => client.from(table)
        .select("*")
        .in("teacher_id", teacherIds)),
    ]);
    if (calendarResult.error) throw calendarResult.error;
    sourceResults.forEach((result, index) => {
      if (result.error) {
        if (tables[index] === "assignments" && isMissingTableError(result.error, "assignments")) {
          console.warn("The assignments table is unavailable; loading the remaining calendar data.");
          return;
        }
        throw new Error(`Unable to load ${tables[index]} for the calendar: ${result.error.message}`, {
          cause: result.error,
        });
      }
    });

    const eventsBySource = new Map();
    const calendarEvents = (calendarResult.data || []).map(normalizeCalendarRow).filter(Boolean);
    calendarEvents.forEach((event) => {
      if (event.source_table && event.source_id) {
        eventsBySource.set(`${event.source_table}:${event.source_id}`, event);
      }
    });

    const monthStart = range.start.getTime();
    const monthEnd = range.end.getTime();
    sourceResults.forEach((result, index) => {
      if (result.error) return;
      (result.data || []).forEach((row) => {
        const event = normalizeSourceRow(row, tables[index]);
        if (!event) return;
        const eventTime = new Date(event.start_at).getTime();
        if (eventTime < monthStart || eventTime >= monthEnd) return;
        const key = `${event.source_table}:${event.source_id}`;
        if (!eventsBySource.has(key)) eventsBySource.set(key, event);
      });
    });

    calendarEvents.forEach((event) => {
      if (!event.source_table || !event.source_id) {
        eventsBySource.set(event.id, event);
      }
    });
    return [...eventsBySource.values()]
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
  }

  async function createEvent(input) {
    const { client, profile } = await requireTeacher();
    const scope = await getTeacherScope(client, profile.id);
    const payload = await validateEvent(input, scope, client);
    const id = input.id || crypto.randomUUID();
    const { data, error } = await client.from("calendar_events")
      .upsert({
        id,
        teacher_id: profile.id,
        ...payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return normalizeCalendarRow(data);
  }

  async function updateEvent(id, input) {
    const { client, profile } = await requireTeacher();
    if (!id) throw new Error("A calendar event ID is required.");
    const scope = await getTeacherScope(client, profile.id);
    const payload = await validateEvent(input, scope, client);
    const { data, error } = await client.from("calendar_events")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("teacher_id", profile.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The event was not found or you are not allowed to edit it.");
    return normalizeCalendarRow(data);
  }

  async function deleteEvent(id) {
    const { client, profile } = await requireTeacher();
    if (!id) throw new Error("A calendar event ID is required.");
    const { data, error } = await client.from("calendar_events")
      .delete()
      .eq("id", id)
      .eq("teacher_id", profile.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The event was not found or you are not allowed to delete it.");
  }

  async function subscribe(onChange) {
    const client = getClient();
    if (!client) throw new Error("Supabase is not configured.");
    if (activeChannel) await client.removeChannel(activeChannel);

    const channel = client.channel("teacher-calendar-events")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "calendar_events",
      }, () => onChange?.());
    activeChannel = channel;
    channel.subscribe((status, error) => {
      if (error || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Teacher calendar Realtime subscription failed.", error || status);
      }
    });

    let stopped = false;
    return async () => {
      if (stopped) return;
      stopped = true;
      if (activeChannel === channel) activeChannel = null;
      await client.removeChannel(channel);
    };
  }

  window.CalendarService = {
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    subscribe,
    requireTeacher,
    getTeacherScope,
  };
})();
