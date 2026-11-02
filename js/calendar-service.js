(() => {
  const EVENT_TYPES = new Set([
    "class",
    "live_class",
    "quiz",
    "exam",
    "assignment",
    "material",
    "announcement",
    "holiday",
    "meeting",
    "other",
  ]);
  let activeChannel = null;

  const getClient = () => window.SmartLearningSupabase?.getClient?.() || null;

  function buildDateRange(date = new Date(), view = "month") {
    if (view === "day") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    if (view === "week") {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
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
        .select("grade, stream, subject_id")
        .eq("teacher_id", teacherId),
    ]);
    if (groupsResult.error) throw groupsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    const { data: subjects, error: subjectsError } = await client
      .from("subjects")
      .select("id, name, grades, streams");
    if (subjectsError) throw subjectsError;

    const assignments = assignmentsResult.data || [];
    const groups = (groupsResult.data || []).map((group) => {
      const grade = Number(group.grade);
      const stream = normalizeStream(group.stream);
      const groupAssignments = assignments.filter((assignment) =>
        Number(assignment.grade) === grade
        && normalizeStream(assignment.stream) === stream);
      const applicableSubjects = (subjects || []).filter((subject) =>
        (subject.grades || []).includes(grade)
        && (grade < 11 || (subject.streams || []).some((value) =>
          normalizeStream(value) === stream)));
      const allowedIds = group.teach_all_subjects
        ? null
        : new Set(groupAssignments.map((assignment) => String(assignment.subject_id)));

      return {
        ...group,
        subjects: applicableSubjects
          .filter((subject) => allowedIds === null || allowedIds.has(String(subject.id)))
          .map(({ id, name }) => ({ id, name })),
      };
    });

    return {
      groups,
      assignments,
    };
  }

  function normalizeStream(value) {
    return String(value || "").trim().toLowerCase();
  }

  function eventMatchesScope(event, scope) {
    const grade = Number(event.grade);
    const stream = normalizeStream(event.stream);
    const group = scope.groups.find((item) =>
      Number(item.grade) === grade
      && normalizeStream(item.stream) === stream);
    if (!group) return false;
    if (event.subject_id == null) return true;
    return group.subjects.some((subject) =>
      String(subject.id) === String(event.subject_id));
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  async function fetchRows(buildQuery, source) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await buildQuery().range(offset, offset + 999);
      if (error) throw new Error(`Could not load ${source}: ${error.message}`);
      if (data != null && !Array.isArray(data)) {
        throw new Error(`${source} query returned an unexpected response.`);
      }
      const page = data || [];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  function combineDateAndTime(date, time) {
    if (!date) return null;
    const value = new Date(`${date}T${String(time || "00:00").slice(0, 8)}`);
    return Number.isFinite(value.getTime()) ? value : null;
  }

  function sourceEvent(row, scope, source, type, startValue, endValue = null, allDay = false) {
    const start = startValue instanceof Date ? startValue : new Date(startValue);
    if (!Number.isFinite(start.getTime())) return null;
    const end = endValue ? (endValue instanceof Date ? endValue : new Date(endValue)) : null;
    const group = scope.groups.find((item) =>
      Number(item.grade) === Number(row.grade ?? row.class_grade)
      && normalizeStream(item.stream) === normalizeStream(row.stream));
    const subject = group?.subjects.find((item) =>
      String(item.id) === String(row.subject_id));

    return {
      ...row,
      id: `${source}-${row.id}`,
      calendar_id: null,
      source,
      source_table: source,
      source_id: row.id,
      type,
      event_type: type,
      title: row.title || row.name || (type === "material" ? "Study material" : "Academic event"),
      description: row.description || row.message || "",
      class_grade: row.grade ?? row.class_grade ?? "",
      subject: subject?.name || "",
      start_at: start.toISOString(),
      end_at: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
      all_day: allDay,
      location: row.location || row.meeting_platform || row.meeting_url || "",
      meeting_url: row.meeting_url || "",
      material_type: row.material_type || "",
      announcement_type: row.type || "",
    };
  }

  async function loadMaterials(client, profile, scope, range) {
    const rows = await fetchRows(
      () => client.from("materials")
        .select("id, teacher_id, title, description, material_type, grade, stream, subject_id, created_at")
        .eq("teacher_id", profile.id)
        .gte("created_at", range.start.toISOString())
        .lt("created_at", range.end.toISOString())
        .order("created_at", { ascending: true }),
      "teacher materials",
    );
    return rows
      .filter((row) => eventMatchesScope(row, scope))
      .map((row) => sourceEvent(row, scope, "materials", "material", row.created_at, null, true))
      .filter(Boolean);
  }

  async function loadLiveClasses(client, profile, scope, range) {
    const fields = "id, teacher_id, title, description, grade, class_grade, stream, subject_id, class_date, start_time, end_time, start_at, end_at, status, publication_status, meeting_platform";
    const startDate = dateKey(range.start);
    const endDate = dateKey(range.end);
    const [byClassDate, byTimestamp] = await Promise.all([
      fetchRows(
        () => client.from("live_classes")
          .select(fields)
          .eq("teacher_id", profile.id)
          .gte("class_date", startDate)
          .lt("class_date", endDate)
          .order("class_date", { ascending: true }),
        "teacher live classes",
      ),
      fetchRows(
        () => client.from("live_classes")
          .select(fields)
          .eq("teacher_id", profile.id)
          .gte("start_at", range.start.toISOString())
          .lt("start_at", range.end.toISOString())
          .order("start_at", { ascending: true }),
        "teacher live classes",
      ),
    ]);
    const rowsById = new Map([...byClassDate, ...byTimestamp].map((row) => [String(row.id), row]));

    return [...rowsById.values()]
      .filter((row) => eventMatchesScope(row, scope))
      .map((row) => {
        const start = row.start_at || combineDateAndTime(row.class_date, row.start_time);
        let end = row.end_at || combineDateAndTime(row.class_date, row.end_time);
        const startDateTime = start instanceof Date ? start : new Date(start);
        if (end && startDateTime && new Date(end) <= startDateTime) {
          const nextDay = new Date(end);
          nextDay.setDate(nextDay.getDate() + 1);
          end = nextDay;
        }
        return sourceEvent(row, scope, "live_classes", "live_class", start, end);
      })
      .filter(Boolean);
  }

  async function loadQuizzes(client, profile, scope, range) {
    const startDate = dateKey(range.start);
    const endDate = dateKey(range.end);
    const [scheduled, unscheduled] = await Promise.all([
      fetchRows(
        () => client.from("quizzes")
          .select("id, teacher_id, title, description, grade, stream, subject_id, status, scheduled_date, scheduled_time, duration_minutes, created_at")
          .eq("teacher_id", profile.id)
          .gte("scheduled_date", startDate)
          .lt("scheduled_date", endDate)
          .order("scheduled_date", { ascending: true }),
        "teacher quizzes",
      ),
      fetchRows(
        () => client.from("quizzes")
          .select("id, teacher_id, title, description, grade, stream, subject_id, status, scheduled_date, scheduled_time, duration_minutes, created_at")
          .eq("teacher_id", profile.id)
          .is("scheduled_date", null)
          .gte("created_at", range.start.toISOString())
          .lt("created_at", range.end.toISOString())
          .order("created_at", { ascending: true }),
        "teacher quizzes",
      ),
    ]);
    const rowsById = new Map([...scheduled, ...unscheduled].map((row) => [String(row.id), row]));

    return [...rowsById.values()]
      .filter((row) => eventMatchesScope(row, scope))
      .map((row) => {
        const start = row.scheduled_date
          ? combineDateAndTime(row.scheduled_date, row.scheduled_time)
          : row.created_at;
        const end = row.scheduled_time && start
          ? new Date(new Date(start).getTime() + Number(row.duration_minutes || 0) * 60_000)
          : null;
        return sourceEvent(row, scope, "quizzes", "quiz", start, end, !row.scheduled_time);
      })
      .filter(Boolean);
  }

  async function loadAnnouncements(client, profile, scope, range) {
    const dateFilters = [
      (query) => query.gte("published_at", range.start.toISOString()).lt("published_at", range.end.toISOString()),
      (query) => query.gte("publish_at", range.start.toISOString()).lt("publish_at", range.end.toISOString()),
      (query) => query.is("published_at", null).is("publish_at", null)
        .gte("created_at", range.start.toISOString()).lt("created_at", range.end.toISOString()),
    ];
    const rowGroups = await Promise.all(dateFilters.map((filter) => fetchRows(
      () => filter(client.from("announcements")
        .select("id, teacher_id, title, message, type, grade, stream, subject_id, status, publish_at, published_at, created_at")
        .eq("teacher_id", profile.id)
        .order("created_at", { ascending: true })),
      "teacher announcements",
    )));
    const rowsById = new Map(rowGroups.flat().map((row) => [String(row.id), row]));

    return [...rowsById.values()]
      .filter((row) => eventMatchesScope(row, scope))
      .map((row) => {
        const start = row.published_at || row.publish_at || row.created_at;
        return sourceEvent({
          ...row,
          description: row.message || "",
        }, scope, "announcements", "announcement", start, null, true);
      })
      .filter(Boolean);
  }

  async function validateEvent(input, scope) {
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
    if (grade === null || !Number.isInteger(grade) || grade < 5 || grade > 12) {
      throw new Error("Choose a valid class grade.");
    }
    if ((grade < 11 && stream !== null) || (grade >= 11 && stream === null)) {
      throw new Error("Choose the stream assigned to this class.");
    }
    if (subjectId !== null && !/^\d+$/.test(subjectId)) {
      throw new Error("Enter a valid subject ID.");
    }

    const group = scope.groups.find((item) =>
      Number(item.grade) === grade
      && normalizeStream(item.stream) === normalizeStream(stream));
    if (!group) throw new Error("Choose a class and stream assigned to your teacher profile.");

    if (subjectId !== null && !group.subjects.some((subject) => String(subject.id) === subjectId)) {
      throw new Error("Choose a subject assigned to this class.");
    }

    const visibleToStudents = Boolean(input.is_visible_to_students);
    if (visibleToStudents && subjectId !== null) {
      throw new Error("Student Calendar visibility currently supports class-wide events only. Clear the subject to publish this event to students.");
    }

    const status = String(input.status || "draft").trim().toLowerCase();
    if (!["draft", "scheduled", "published", "completed", "cancelled"].includes(status)) {
      throw new Error("Choose a valid event status.");
    }
    const meetingUrl = String(input.meeting_url || "").trim() || null;
    if (meetingUrl) {
      let parsedUrl;
      try {
        parsedUrl = new URL(meetingUrl);
      } catch {
        throw new Error("Enter a valid meeting URL.");
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Meeting URLs must use HTTP or HTTPS.");
      }
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
      meeting_url: meetingUrl,
      status,
      is_visible_to_students: visibleToStudents,
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
      source_table: row.source_table || "calendar_events",
      source_id: row.source_id || row.id,
      type: row.event_type || "other",
      class_grade: row.grade ?? "",
      subject: subject?.name || row.subject_name || row.subject || "",
      start_at: start.toISOString(),
      end_at: row.end_at ? new Date(row.end_at).toISOString() : null,
      location: row.location || row.meeting_url || "",
      meeting_url: row.meeting_url || "",
    };
  }

  async function loadEvents(date = new Date(), view = "month") {
    const { client, profile } = await requireTeacher();
    const scope = await getTeacherScope(client, profile.id);
    const range = buildDateRange(date, view);
    const [calendarRows, materials, liveClasses, quizzes, announcements] = await Promise.all([
      fetchRows(
        () => client.from("calendar_events")
          .select("*")
          .eq("teacher_id", profile.id)
          .gte("start_at", range.start.toISOString())
          .lt("start_at", range.end.toISOString())
          .order("start_at", { ascending: true }),
        "teacher calendar events",
      ),
      loadMaterials(client, profile, scope, range),
      loadLiveClasses(client, profile, scope, range),
      loadQuizzes(client, profile, scope, range),
      loadAnnouncements(client, profile, scope, range),
    ]);
    const events = [
      ...calendarRows
        .filter((row) => eventMatchesScope(row, scope))
        .map(normalizeCalendarRow)
        .filter(Boolean),
      ...materials,
      ...liveClasses,
      ...quizzes,
      ...announcements,
    ];
    const uniqueEvents = new Map();
    events.forEach((event) => {
      const start = new Date(event.start_at);
      if (start >= range.start && start < range.end) {
        uniqueEvents.set(`${event.source_table}:${event.source_id || event.id}`, event);
      }
    });
    return [...uniqueEvents.values()]
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
  }

  async function createEvent(input) {
    const { client, profile } = await requireTeacher();
    const scope = await getTeacherScope(client, profile.id);
    const payload = await validateEvent(input, scope);
    const { data, error } = await client.from("calendar_events")
      .insert({
        teacher_id: profile.id,
        ...payload,
      })
      .select("*")
      .single();
    if (error) throw error;
    return normalizeCalendarRow(data);
  }

  async function updateEvent(id, input) {
    const { client, profile } = await requireTeacher();
    if (!id) throw new Error("A calendar event ID is required.");
    const scope = await getTeacherScope(client, profile.id);
    const payload = await validateEvent(input, scope);
    const { data, error } = await client.from("calendar_events")
      .update(payload)
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
    const { client, profile } = await requireTeacher();
    if (activeChannel) await client.removeChannel(activeChannel);

    const channel = client.channel(`teacher-calendar-${profile.id}`);
    for (const table of ["calendar_events", "materials", "live_classes", "quizzes", "announcements"]) {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter: `teacher_id=eq.${profile.id}`,
      }, () => onChange?.());
    }
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
