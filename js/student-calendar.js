(() => {
  const state = {
    date: new Date(),
    selectedDate: new Date(),
    events: [],
    profile: null,
    subjectIds: new Set(),
    subjectsById: new Map(),
    sourceErrors: [],
    client: null,
    authSubscription: null,
    stopRealtime: () => {},
    refreshSequence: 0,
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const formatDate = (value, options = {}) => new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  const monthRange = (date) => ({
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
  });
  const block = (message) => {
    const root = $("calendarGrid");
    if (root) root.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  };
  let activeChannel = null;

  function getClient() {
    const supabase = window.SmartLearningSupabase;
    if (!supabase) {
      throw new Error("The shared Supabase configuration did not initialize.");
    }
    if (!supabase.isConfigured?.()) {
      throw new Error("Supabase is not configured for this application.");
    }
    const client = supabase.getClient?.();
    if (!client) {
      throw new Error("The Supabase SDK did not load. Check your connection and reload the page.");
    }
    return client;
  }

  function eventTypeClass(type) {
    const normalized = String(type || "class").toLowerCase();
    if (normalized === "live_class") return "event-class";
    if (normalized === "material") return "event-material";
    if (normalized === "assignment") return "event-assignment";
    if (normalized === "holiday") return "event-holiday";
    if (normalized === "rescheduled_class") return "event-rescheduled";
    if (normalized === "exam") return "event-exam";
    if (normalized === "quiz") return "event-quiz";
    if (normalized === "announcement") return "event-announcement";
    return "event-class";
  }

  function eventTypeBadge(type) {
    const normalized = String(type || "class").toLowerCase();
    if (normalized === "live_class") return "Class";
    if (normalized === "material") return "Material";
    if (normalized === "assignment") return "Assignment";
    if (normalized === "holiday") return "Holiday";
    if (normalized === "rescheduled_class") return "Rescheduled";
    if (normalized === "exam") return "Exam";
    if (normalized === "quiz") return "Quiz";
    if (normalized === "announcement") return "Announcement";
    return "Event";
  }

  function eventTypeLabel(type) {
    const labels = {
      live_class: "Class",
      class: "Class",
      material: "Study material",
      assignment: "Assignment",
      holiday: "Holiday",
      rescheduled_class: "Rescheduled class",
      exam: "Exam",
      quiz: "Quiz",
      announcement: "Announcement",
    };
    return labels[String(type || "").toLowerCase()] || "Event";
  }

  function normalizeRow(row, source, type) {
    const start = new Date(row.start_at);
    if (!Number.isFinite(start.getTime())) return null;
    const end = row.end_at ? new Date(row.end_at) : null;
    const subjectRelation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    return {
      id: `${source}-${row.id}`,
      source,
      source_table: row.source_table || null,
      source_id: row.source_id || null,
      calendar_id: row.id,
      type: type || row.event_type || "event",
      title: row.title || row.name || row.topic || "Academic event",
      description: row.description || "",
      teacher: row.teacher_name || "",
      subject: subjectRelation?.name || row.subject_name || row.subject || (row.subject_id ? `Subject ${row.subject_id}` : ""),
      subject_id: row.subject_id,
      class_grade: row.grade ?? row.class_grade ?? "",
      stream: row.stream || "",
      start_at: start.toISOString(),
      end_at: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
      status: row.status || "scheduled",
      location: row.location || row.meeting_url || "",
      meeting_url: row.meeting_url || "",
      all_day: Boolean(row.all_day),
      material_type: row.material_type || "",
      file_name: row.file_name || "",
    };
  }

  async function getStudentProfile() {
    const client = state.client || getClient();
    const curriculum = await window.SubjectService.getStudentSubjects(client);
    state.client = client;
    state.profile = curriculum.student;
    state.subjectIds = new Set(
      curriculum.subjects.map((subject) => String(subject.id)),
    );
    state.subjectsById = new Map(
      (curriculum.subjectCatalog || curriculum.subjects)
        .map((subject) => [String(subject.id), subject]),
    );
    return { client, user: curriculum.user, profile: curriculum.student };
  }

  function eventIsInRanges(event, ranges) {
    const start = new Date(event.start_at);
    return Number.isFinite(start.getTime()) &&
      ranges.some((range) => start >= range.start && start < range.end);
  }

  function createEventRanges(date) {
    const now = new Date();
    const upcomingEnd = new Date(now);
    upcomingEnd.setFullYear(upcomingEnd.getFullYear() + 1);
    const month = monthRange(date);
    return [
      {
        start: new Date(Math.min(month.start.getTime(), now.getTime())),
        end: new Date(Math.max(month.end.getTime(), upcomingEnd.getTime())),
      },
    ];
  }

  async function loadCalendarEvents(client, ranges) {
    const rowsById = new Map();
    for (const range of ranges) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client
          .from("calendar_events")
          .select("id, teacher_id, title, description, event_type, grade, stream, subject_id, start_at, end_at, all_day, location, meeting_url, status, is_visible_to_students, source_table, source_id")
          .eq("status", "published")
          .eq("is_visible_to_students", true)
          .gte("start_at", range.start.toISOString())
          .lt("start_at", range.end.toISOString())
          .order("start_at", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        const page = data || [];
        for (const row of page) rowsById.set(row.id, row);
        if (page.length < 1000) break;
      }
    }
    const calendarEvents = [...rowsById.values()]
      .filter((row) =>
        !["materials", "live_classes", "quizzes"].includes(row.source_table) &&
        (row.subject_id == null || state.subjectIds.has(String(row.subject_id))),
      )
      .map((row) => normalizeRow(row, "calendar_events", row.event_type))
      .filter(Boolean);
    return calendarEvents;
  }

  async function loadMaterials(client, ranges) {
    const data = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error } = await client
        .from("materials")
        .select("id, teacher_id, grade, stream, subject_id, title, description, material_type, file_name, storage_bucket, file_path, mime_type, created_at")
        .eq("grade", Number(state.profile.grade))
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      data.push(...(page || []));
      if ((page || []).length < 1000) break;
    }

    const eligibleRows = data.filter((row) => {
      const subjectId = String(row.subject_id);
      return state.subjectIds.has(subjectId) &&
        (Number(state.profile.grade) < 11 ||
          String(row.stream || "").trim().toLowerCase() ===
            String(state.profile.stream || "").trim().toLowerCase()) &&
        eventIsInRanges({ start_at: row.created_at }, ranges);
    });
    const teacherIds = [...new Set(eligibleRows.map((row) => row.teacher_id).filter(Boolean))];
    let teacherNames = new Map();
    if (teacherIds.length) {
      const { data: teachers, error: teacherError } = await client
        .from("teachers")
        .select("id, full_name")
        .in("id", teacherIds);
      if (teacherError) {
        console.warn("Student calendar could not load material teacher names.", teacherError);
      } else {
        teacherNames = new Map((teachers || []).map((teacher) => [
          String(teacher.id),
          teacher.full_name,
        ]));
      }
    }

    return eligibleRows.map((row) => {
      const subject = state.subjectsById.get(String(row.subject_id));
      const type = String(row.material_type || "").trim().toLowerCase();
      const iconLabel = type === "photo" || type === "image" ? "Photo" :
        type ? type.charAt(0).toUpperCase() + type.slice(1) : "Material";
      return normalizeRow({
        ...row,
        title: row.title || row.file_name || "Study material",
        description: [iconLabel, row.file_name].filter(Boolean).join(" · "),
        teacher_name: teacherNames.get(String(row.teacher_id)) || "",
        subject_name: subject?.name || "",
        start_at: row.created_at,
        end_at: row.created_at,
        all_day: true,
        source_table: "materials",
        source_id: row.id,
      }, "materials", "material");
    }).filter(Boolean);
  }

  async function loadLiveClasses(client, ranges) {
    const { data, error } = await client.rpc("get_student_live_classes");
    if (error) throw error;
    return (data || [])
      .filter((liveClass) => {
        const gradeMatches = Number(liveClass.grade) === Number(state.profile.grade);
        const streamMatches = Number(state.profile.grade) < 11 ||
          String(liveClass.stream || "").trim().toLowerCase() ===
            String(state.profile.stream || "").trim().toLowerCase();
        return gradeMatches &&
          streamMatches &&
          state.subjectIds.has(String(liveClass.subject_id)) &&
          eventIsInRanges(liveClass, ranges);
      })
      .map((liveClass) => normalizeRow({
        ...liveClass,
        source_table: "live_classes",
        source_id: liveClass.id,
        subject_name: liveClass.subject_name,
        event_type: "live_class",
      }, "live_classes", "live_class"))
      .filter(Boolean);
  }

  async function loadQuizzes(client, ranges) {
    const catalog = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .rpc("get_student_quiz_catalog")
        .range(offset, offset + 999);
      if (error) throw error;
      catalog.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    const eligibleCatalog = (catalog || []).filter((quiz) =>
      quiz.subject_id != null &&
      state.subjectIds.has(String(quiz.subject_id)) &&
      Number(quiz.grade) === Number(state.profile.grade) &&
      (Number(state.profile.grade) < 11 ||
        String(quiz.stream || "").trim().toLowerCase() ===
          String(state.profile.stream || "").trim().toLowerCase()),
    );
    if (!eligibleCatalog.length) return [];

    const quizIds = [...new Set(eligibleCatalog.map((quiz) => quiz.id))];
    const quizRows = [];
    for (let index = 0; index < quizIds.length; index += 500) {
      const { data, error } = await client
        .from("quizzes")
        .select("id, teacher_id, title, description, grade, stream, subject_id, status, student_access, start_at, end_at, published_at, duration_minutes")
        .in("id", quizIds.slice(index, index + 500));
      if (error) throw error;
      quizRows.push(...(data || []));
    }

    const catalogById = new Map(eligibleCatalog.map((quiz) => [String(quiz.id), quiz]));
    const rows = (quizRows || []).filter((quiz) => {
      const catalogEntry = catalogById.get(String(quiz.id));
      const date = quiz.start_at || quiz.published_at;
      return catalogEntry &&
        String(quiz.status || catalogEntry.quiz_status).toLowerCase() === "published" &&
        date &&
        eventIsInRanges({ start_at: date }, ranges);
    });
    const teacherIds = [...new Set(rows.map((quiz) => quiz.teacher_id).filter(Boolean))];
    let teacherNames = new Map();
    if (teacherIds.length) {
      const { data: teachers, error: teacherError } = await client
        .from("teachers")
        .select("id, full_name")
        .in("id", teacherIds);
      if (teacherError) {
        console.warn("Student calendar could not load quiz teacher names.", teacherError);
      } else {
        teacherNames = new Map((teachers || []).map((teacher) => [
          String(teacher.id),
          teacher.full_name,
        ]));
      }
    }
    return rows.map((quiz) => {
      const catalogEntry = catalogById.get(String(quiz.id));
      const startAt = quiz.start_at || quiz.published_at;
      const endAt = quiz.end_at || (
        quiz.duration_minutes
          ? new Date(new Date(startAt).getTime() + Number(quiz.duration_minutes) * 60_000).toISOString()
          : null
      );
      return normalizeRow({
        ...quiz,
        subject_name: state.subjectsById.get(String(quiz.subject_id))?.name ||
          catalogEntry.subject_name,
        teacher_name: teacherNames.get(String(quiz.teacher_id)) || "",
        start_at: startAt,
        end_at: endAt,
        source_table: "quizzes",
        source_id: quiz.id,
        status: quiz.status || catalogEntry.quiz_status,
        event_type: "quiz",
      }, "quizzes", "quiz");
    }).filter(Boolean);
  }

  async function loadEvents(date = state.date) {
    const { client } = await getStudentProfile();
    const ranges = createEventRanges(date);
    const sources = await Promise.allSettled([
      loadCalendarEvents(client, ranges),
      loadMaterials(client, ranges),
      loadLiveClasses(client, ranges),
      loadQuizzes(client, ranges),
    ]);
    const sourceNames = ["Calendar events", "Study materials", "Live classes", "Quizzes"];
    state.sourceErrors = [];
    const events = [];
    sources.forEach((result, index) => {
      if (result.status === "fulfilled") {
        events.push(...result.value);
        return;
      }
      console.error(`Student calendar ${sourceNames[index].toLowerCase()} query failed.`, result.reason);
      state.sourceErrors.push(`${sourceNames[index]}: ${result.reason?.message || "query failed"}`);
    });
    return events.sort((left, right) =>
      new Date(left.start_at) - new Date(right.start_at),
    );
  }

  async function subscribe() {
    const client = state.client || getClient();
    if (activeChannel) await client.removeChannel(activeChannel);
    const grade = Number(state.profile.grade);
    const channel = client.channel(`student-calendar-${state.profile.user_id}`);
    for (const table of ["materials", "live_classes", "quizzes", "calendar_events"]) {
      const subscription = {
        event: "*",
        schema: "public",
        table,
      };
      if (table !== "calendar_events") subscription.filter = `grade=eq.${grade}`;
      channel.on("postgres_changes", subscription, () => void refresh());
    }
    channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "students",
        filter: `user_id=eq.${state.profile.user_id}`,
      }, () => void refresh())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "subjects",
      }, () => void refresh());
    activeChannel = channel;
    channel.subscribe((status, error) => {
      if (error || ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        console.error("Student calendar Realtime subscription failed.", { status, error });
        const statusElement = $("calendarStatus");
        if (statusElement) {
          statusElement.textContent = "Live updates are unavailable. Reload the page to check for changes.";
          statusElement.hidden = false;
        }
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

  function renderMonthGrid() {
    const firstDay = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    const daysInMonth = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 0).getDate();
    const offset = firstDay.getDay();
    const grid = $("calendarGrid");
    if (!grid) return;

    const dayCells = [];

    for (let index = 0; index < offset; index += 1) {
      dayCells.push('<div class="day other-month"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const currentDate = new Date(state.date.getFullYear(), state.date.getMonth(), day);
      const currentKey = dayKey(currentDate);
      const entries = state.events.filter((event) => dayKey(event.start_at) === currentKey);
      const content = entries.map((entry) => {
        const cssClass = eventTypeClass(entry.type);
        const icon = entry.type === "material"
          ? entry.material_type === "video"
            ? "fa-video"
            : ["photo", "image"].includes(String(entry.material_type).toLowerCase())
              ? "fa-image"
              : entry.material_type === "pdf"
                ? "fa-file-pdf"
                : "fa-file-lines"
          : entry.type === "quiz"
            ? "fa-clipboard-question"
            : entry.type === "live_class" || entry.type === "class"
              ? "fa-video"
              : "fa-circle";
        return `<div class="event ${cssClass}" data-calendar-event-id="${escapeHtml(entry.id)}" role="button" tabindex="0" aria-label="${escapeHtml(eventTypeLabel(entry.type))}: ${escapeHtml(entry.title)}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(entry.title)}</span></div>`;
      }).join("");
      const todayClass = dayKey(new Date()) === currentKey ? "today" : "";
      const selectedClass = dayKey(state.selectedDate) === currentKey ? "selected-day" : "";
      dayCells.push(`<div class="day ${todayClass} ${selectedClass}" data-date="${currentKey}" aria-label="${formatDate(currentDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${entries.length} activities"><div class="date-number">${day}</div>${content}</div>`);
    }

    const remainder = (7 - (dayCells.length % 7)) % 7;
    for (let index = 0; index < remainder; index += 1) {
      dayCells.push('<div class="day other-month"></div>');
    }

    grid.innerHTML = dayCells.join("");
  }

  function renderSelectedDayEvents() {
    const container = $("selectedDayEvents");
    if (!container) return;
    const selectedKey = dayKey(state.selectedDate);
    const events = state.events
      .filter((event) => dayKey(event.start_at) === selectedKey)
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
    container.innerHTML = `<h3>${formatDate(state.selectedDate, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })}</h3>` + (events.length
      ? `<div class="selected-day-events">${events.map((event) => `<button type="button" class="selected-day-event ${eventTypeClass(event.type)}" data-calendar-event-id="${escapeHtml(event.id)}">
          <span class="selected-day-event-type">${escapeHtml(eventTypeLabel(event.type))}</span>
          <strong>${escapeHtml(event.title)}</strong>
          <span>${event.all_day ? "All day" : formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })}${event.subject ? ` · ${escapeHtml(event.subject)}` : ""}</span>
        </button>`).join("")}</div>`
      : '<p>No activities scheduled for this day.</p>');
  }

  function renderCalendarStatus() {
    const status = $("calendarStatus");
    if (!status) return;
    const countFor = (source) => state.events.filter((event) =>
      event.source_table === source
    ).length;
    const categoryCount = (source, emptyLabel, singular, plural) => {
      const count = countFor(source);
      return count ? `${count} ${count === 1 ? singular : plural}` : emptyLabel;
    };
    const counts = [
      categoryCount("materials", "No materials uploaded", "material", "materials"),
      categoryCount("live_classes", "No live classes scheduled", "live class", "live classes"),
      categoryCount("quizzes", "No quizzes published", "quiz", "quizzes"),
    ].join(" · ");
    status.textContent = state.sourceErrors.length
      ? `${counts}. Some calendar sources could not be loaded: ${state.sourceErrors.join(" | ")}`
      : state.events.length
        ? counts
        : `No activities scheduled. ${counts}.`;
    status.dataset.state = state.sourceErrors.length ? "error" : "info";
    status.hidden = false;
  }

  function renderMiniCalendar() {
    const title = $("miniCalendarTitle");
    const grid = $("miniCalendarGrid");
    if (!grid) return;
    if (title) title.textContent = formatDate(state.date, { month: "long", year: "numeric" });

    const year = state.date.getFullYear();
    const month = state.date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    const eventDays = new Set(state.events.map((event) => dayKey(event.start_at)));
    for (let index = 0; index < 42; index += 1) {
      const dayNumber = index - startOffset + 1;
      const date = new Date(year, month, dayNumber);
      const dateKey = dayKey(date);
      const inCurrentMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
      const classes = [
        "mini-calendar-day",
        inCurrentMonth ? "" : "other-month",
        dayKey(new Date()) === dateKey ? "today" : "",
        dayKey(state.selectedDate) === dateKey ? "selected" : "",
        eventDays.has(dateKey) ? "has-events" : "",
      ].filter(Boolean).join(" ");
      cells.push(`<button type="button" class="${classes}" data-mini-date="${dateKey}" aria-label="${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}">${date.getDate()}</button>`);
    }
    grid.innerHTML = cells.join("");
  }

  function renderRegistrationContext() {
    const profile = state.profile;
    const context = $("registrationContext");
    const text = $("registrationContextText");
    if (!profile || !context || !text) return;
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const grade = String(profile.grade ?? "").replace(/^class\s+/i, "").trim();
    const stream = String(profile.stream ?? "").trim();
    if (!grade) return;
    text.textContent = `Grade ${grade}${stream ? ` - ${streamLabels[stream.toLowerCase()] || stream}` : ""}`;
    context.hidden = false;
  }

  function renderUpcoming() {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = state.events.filter((event) => {
      const start = new Date(event.start_at);
      return start >= now && start <= nextWeek;
    }).sort((left, right) => new Date(left.start_at) - new Date(right.start_at)).slice(0, 4);
    const container = $("upcomingCard");
    if (!container) return;
    container.innerHTML = '<div class="side-card-header"><h3>Upcoming</h3><span>Next 7 days</span></div>' + (upcoming.length ? upcoming.map((event) => {
      const date = new Date(event.start_at);
      return `<div class="upcoming-event" data-calendar-event-id="${escapeHtml(event.id)}" role="button" tabindex="0"><div class="event-date"><strong>${String(date.getDate()).padStart(2, "0")}</strong><span>${formatDate(date, { month: "short" }).slice(0, 3)}</span></div><div class="upcoming-info"><h4>${escapeHtml(event.title)}</h4><p><i class="fa-regular fa-clock"></i>${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })}${event.subject ? ` · ${escapeHtml(event.subject)}` : ""}</p></div></div>`;
    }).join("") : '<div class="upcoming-event"><div class="upcoming-info"><h4>No upcoming events</h4><p>There are no future events for your profile.</p></div></div>');
  }

  function renderCalendar() {
    const monthTitle = $("monthTitle");
    if (monthTitle) {
      monthTitle.textContent = formatDate(state.date, { month: "long", year: "numeric" });
    }
    renderRegistrationContext();
    renderMonthGrid();
    renderSelectedDayEvents();
    renderMiniCalendar();
    renderCalendarStatus();
    renderUpcoming();
  }

  function renderModal(event) {
    const modal = $("eventModal");
    if (!modal) return;
    $("modalTitle").textContent = event.title;
    $("modalDate").textContent = formatDate(event.start_at, { month: "long", day: "numeric", year: "numeric" });
    $("modalTime").textContent = event.all_day
      ? "All day"
      : event.end_at
        ? `${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })} - ${formatDate(event.end_at, { hour: "numeric", minute: "2-digit" })}`
        : formatDate(event.start_at, { hour: "numeric", minute: "2-digit" });
    $("modalSubject").textContent = event.subject || "General";
    const details = [
      eventTypeLabel(event.type),
      event.class_grade ? `Grade ${event.class_grade}${event.stream ? ` - ${event.stream}` : ""}` : "",
      event.teacher ? `By ${event.teacher}` : "",
      event.source_table === "quizzes" && event.status
        ? `Status: ${event.status}`
        : "",
      event.description || "No additional details provided.",
      event.location && event.location !== event.meeting_url ? `Location: ${event.location}` : "",
    ].filter(Boolean);
    $("modalDetails").textContent = details.join(" · ");
    const meetingRow = $("modalMeetingRow");
    const meetingLink = $("modalMeeting");
    try {
      const meetingUrl = new URL(event.meeting_url);
      if (meetingRow && meetingLink && ["http:", "https:"].includes(meetingUrl.protocol)) {
        meetingLink.href = meetingUrl.href;
        meetingRow.hidden = false;
      } else if (meetingRow) {
        meetingRow.hidden = true;
      }
    } catch {
      if (meetingRow) meetingRow.hidden = true;
      if (meetingLink) meetingLink.removeAttribute("href");
    }
    const materialRow = $("modalMaterialRow");
    const materialButton = $("modalMaterial");
    const isMaterial = event.source_table === "materials" && event.source_id;
    if (materialRow) materialRow.hidden = !isMaterial;
    if (materialButton) {
      materialButton.dataset.materialId = isMaterial ? String(event.source_id) : "";
      materialButton.dataset.materialType = isMaterial
        ? String(event.material_type || "")
        : "";
    }
    const liveClassRow = $("modalLiveClassRow");
    const liveClassButton = $("modalLiveClass");
    const isLiveClass = event.source_table === "live_classes" && event.source_id;
    if (liveClassRow) liveClassRow.hidden = !isLiveClass || Boolean(event.meeting_url);
    if (liveClassButton) {
      liveClassButton.dataset.liveClassId = isLiveClass ? String(event.source_id) : "";
    }
    const quizRow = $("modalQuizRow");
    const quizButton = $("modalQuiz");
    const isQuiz = event.source_table === "quizzes" && event.source_id;
    if (quizRow) quizRow.hidden = !isQuiz;
    if (quizButton) quizButton.dataset.quizId = isQuiz ? String(event.source_id) : "";
    modal.classList.add("show");
  }

  async function openAuthorizedUrl(getUrl, actionName) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await getUrl();
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        throw new Error(`${actionName} links must use HTTPS.`);
      }
      if (popup) {
        popup.location.replace(parsed.href);
      } else {
        window.location.assign(parsed.href);
      }
    } catch (error) {
      popup?.close();
      console.error(`Could not open ${actionName}.`, error);
      window.alert(error.message || `Could not open ${actionName}.`);
    }
  }

  async function refresh() {
    const sequence = ++state.refreshSequence;
    const requestedDate = new Date(state.date);
    try {
      const events = await loadEvents(requestedDate);
      if (sequence !== state.refreshSequence) return;
      state.events = events;
      renderCalendar();
    } catch (error) {
      if (sequence !== state.refreshSequence) return;
      console.error("Unable to render student calendar.", error);
      state.events = [];
      block(error.message || "Unable to load student calendar data.");
      const message = escapeHtml(error.message || "Unable to load calendar data.");
      if ($("upcomingCard")) $("upcomingCard").innerHTML = `<div class="side-card-header"><h3>Upcoming</h3></div><div class="upcoming-event"><div class="upcoming-info"><h4>${message}</h4></div></div>`;
      if (error?.code === "AUTH_REQUIRED") {
        window.location.assign("../student_registration/login.html");
      }
    }
  }

  function bindUi() {
    document.addEventListener("click", (event) => {
      const eventTrigger = event.target.closest("[data-calendar-event-id]");
      if (eventTrigger) {
        const matching = state.events.find((entry) => entry.id === eventTrigger.dataset.calendarEventId);
        if (matching) {
          event.stopPropagation();
          renderModal(matching);
          return;
        }
      }

      const materialButton = event.target.closest("#modalMaterial");
      if (materialButton?.dataset.materialId) {
        event.stopPropagation();
        const page = materialButton.dataset.materialType === "video"
          ? "st_videos.html"
          : "st_notes.html";
        window.location.assign(
          `${page}?material_id=${encodeURIComponent(materialButton.dataset.materialId)}`,
        );
        return;
      }

      const liveClassButton = event.target.closest("#modalLiveClass");
      if (liveClassButton?.dataset.liveClassId) {
        event.stopPropagation();
        void openAuthorizedUrl(async () => {
          const client = getClient();
          const { data, error } = await client.rpc("get_student_live_class_join_url", {
            requested_class_id: liveClassButton.dataset.liveClassId,
          });
          if (error) throw error;
          if (!data) throw new Error("This class is not available to join right now.");
          return data;
        }, "live class");
        return;
      }

      const quizButton = event.target.closest("#modalQuiz");
      if (quizButton?.dataset.quizId) {
        event.stopPropagation();
        window.location.assign(
          `st_quizzes.html?quiz_id=${encodeURIComponent(quizButton.dataset.quizId)}`,
        );
        return;
      }

      const miniMonthButton = event.target.closest("[data-mini-month]");
      if (miniMonthButton) {
        state.date = new Date(
          state.date.getFullYear(),
          state.date.getMonth() + Number(miniMonthButton.dataset.miniMonth),
          1,
        );
        state.selectedDate = new Date(state.date);
        void refresh();
        return;
      }

      const miniDateButton = event.target.closest("[data-mini-date]");
      if (miniDateButton) {
        const [year, month, day] = miniDateButton.dataset.miniDate.split("-").map(Number);
        state.selectedDate = new Date(year, month - 1, day);
        state.date = new Date(year, month - 1, 1);
        void refresh();
        return;
      }

      const dayElement = event.target.closest(".day");
      if (dayElement && dayElement.dataset.date) {
        const [year, month, day] = dayElement.dataset.date.split("-").map(Number);
        state.selectedDate = new Date(year, month - 1, day);
        state.date = new Date(year, month - 1, 1);
        renderCalendar();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const trigger = event.target.closest("[data-calendar-event-id]");
      if (!trigger) return;
      const matching = state.events.find((entry) => entry.id === trigger.dataset.calendarEventId);
      if (!matching) return;
      event.preventDefault();
      renderModal(matching);
    });

    window.goToday = () => {
      state.date = new Date();
      state.selectedDate = new Date();
      void refresh();
    };

    window.previousMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1);
      state.selectedDate = new Date(state.date);
      void refresh();
    };

    window.nextMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1);
      state.selectedDate = new Date(state.date);
      void refresh();
    };

    window.closeModal = () => {
      const overlay = $("eventModal");
      if (overlay) overlay.classList.remove("show");
    };
  }

  async function init() {
    bindUi();
    try {
      await refresh();
      const client = state.client || getClient();
      state.stopRealtime = await subscribe();
      const authChange = client.auth.onAuthStateChange((_event, session) => {
        const nextUserId = session?.user?.id || null;
        if (nextUserId === state.profile?.user_id) return;
        window.setTimeout(() => {
          void (async () => {
            await state.stopRealtime();
            state.events = [];
            state.profile = null;
            await refresh();
            state.stopRealtime = await subscribe();
          })().catch((error) => {
            console.error("Student calendar could not reload after an account change.", error);
            block(error.message || "Calendar access changed. Reload the page.");
          });
        }, 0);
      });
      state.authSubscription = authChange.data?.subscription || null;
    } catch (error) {
      console.error("Student calendar initialization failed.", error);
      block(error.message || "Unable to initialize the student calendar.");
    }
  }

  window.addEventListener("pagehide", () => {
    void state.stopRealtime();
    state.authSubscription?.unsubscribe();
  }, { once: true });
  init();
})();
