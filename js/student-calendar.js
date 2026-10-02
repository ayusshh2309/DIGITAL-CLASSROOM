(() => {
  const state = {
    date: new Date(),
    events: [],
    profile: null,
    stopRealtime: () => {},
  };

  const $ = (id) => document.getElementById(id);
  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const formatDate = (value, options = {}) => new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  const block = (message) => {
    const root = $("calendarGrid");
    if (root) root.innerHTML = `<div class="empty-state">${message}</div>`;
  };

  function getClient() {
    return window.SmartLearningSupabase?.getClient?.() || null;
  }

  function eventTypeClass(type) {
    const normalized = String(type || "class").toLowerCase();
    if (normalized === "live_class") return "event-class";
    if (normalized === "material") return "event-material";
    if (normalized === "assignment") return "event-assignment";
    if (normalized === "holiday") return "event-holiday";
    if (normalized === "rescheduled_class") return "event-rescheduled";
    if (normalized === "exam") return "event-exam";
    if (normalized === "quiz") return "event-exam";
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
    return "Event";
  }

  function toZulu(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function normalizeRow(row, source, type) {
    const startAt = row.start_at || row.created_at || row.published_at || row.due_at || new Date().toISOString();
    const endAt = row.end_at || row.due_at || row.deadline || row.published_at || startAt;
    return {
      id: `${source}-${row.id}`,
      source,
      type,
      title: row.title || row.name || row.topic || "Academic event",
      description: row.description || row.instructions || row.message || row.details || "",
      subject: row.subject || row.subject_name || "",
      class_grade: row.class_grade || row.grade || row.class || "",
      stream: row.stream || row.class_stream || "",
      start_at: startAt,
      end_at: endAt,
      status: row.status || "scheduled",
      location: row.meeting_url || row.location || row.file_url || row.external_url || "",
      teacher_name: row.teacher_name || "",
      duration_minutes: Number(row.duration_minutes || row.duration || 0) || null,
      question_count: Number(row.question_count || row.questions_count || 0) || null,
    };
  }

  async function getStudentProfile() {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured.");
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      throw Object.assign(new Error("Authentication failed. Please sign in again."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: student, error: studentError } = await client
      .from("students")
      .select("*")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student) throw new Error("Student profile could not be found.");

    return { client, user: userData.user, profile: student };
  }

  function eligibleSubjects(profile) {
    const values = profile.eligible_subjects || profile.subjects || profile.selected_subjects || [];
    return new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  }

  function matchesStudent(student, row) {
    const grade = String(student.grade || student.class_grade || "").trim();
    const stream = String(student.stream || student.class_stream || "").trim();
    const subject = String(row.subject || row.subject_name || "").trim().toLowerCase();
    const allowedSubjects = eligibleSubjects(student);

    if (row.class_grade && String(row.class_grade).trim() !== grade) return false;
    if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
    if (allowedSubjects.size && subject && !allowedSubjects.has(subject)) return false;
    return true;
  }

  async function queryTable(table, typeName, matchFn) {
    const client = getClient();
    if (!client) return [];
    try {
      const { data, error } = await client.from(table).select("*");
      if (error) return [];
      return (data || []).filter((row) => matchFn(row)).map((row) => normalizeRow(row, table, typeName));
    } catch (error) {
      return [];
    }
  }

  async function loadEvents() {
    const { profile } = await getStudentProfile();
    const subjectSet = eligibleSubjects(profile);
    const grade = String(profile.grade || profile.class_grade || "").trim();
    const stream = String(profile.stream || profile.class_stream || "").trim();

    const tables = [
      ["live_classes", "live_class", (row) => {
        if (String(row.class_grade || "").trim() !== grade) return false;
        if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
        if (subjectSet.size) {
          const subject = String(row.subject || "").trim().toLowerCase();
          return subject && subjectSet.has(subject);
        }
        return true;
      }],
      ["materials", "material", (row) => {
        if (String(row.class_grade || "").trim() !== grade) return false;
        if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
        if (row.status && row.status !== "published") return false;
        if (subjectSet.size) {
          const subject = String(row.subject || "").trim().toLowerCase();
          return subject && subjectSet.has(subject);
        }
        return true;
      }],
      ["quizzes", "quiz", (row) => {
        if (String(row.class_grade || "").trim() !== grade) return false;
        if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
        if (!row.status || !["published", "scheduled"].includes(row.status)) return false;
        if (subjectSet.size) {
          const subject = String(row.subject || "").trim().toLowerCase();
          return subject && subjectSet.has(subject);
        }
        return true;
      }],
      ["assignments", "assignment", (row) => {
        if (String(row.class_grade || "").trim() !== grade) return false;
        if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
        if (row.status && row.status !== "published") return false;
        if (subjectSet.size) {
          const subject = String(row.subject || "").trim().toLowerCase();
          return subject && subjectSet.has(subject);
        }
        return true;
      }],
      ["academic_calendar", "holiday", (row) => {
        if (row.status && row.status !== "published") return false;
        if (row.class_grade && String(row.class_grade).trim() !== grade) return false;
        if (row.stream && String(row.stream).trim() && stream && String(row.stream).trim().toLowerCase() !== stream.toLowerCase()) return false;
        return true;
      }],
    ];

    const eventCollections = await Promise.all(
      tables.map(async ([table, typeName, predicate]) => queryTable(table, typeName, predicate)),
    );

    const events = eventCollections.flat();
    return events.sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
  }

  async function subscribe() {
    const client = getClient();
    if (!client) return () => {};
    const channel = client.channel("student-calendar-realtime");
    ["live_classes", "materials", "quizzes", "assignments", "academic_calendar"].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        loadEvents().then((events) => {
          state.events = events;
          renderCalendar();
        }).catch(() => {});
      });
    });
    await channel.subscribe();
    return () => client.removeChannel(channel);
  }

  function renderMonthGrid() {
    const firstDay = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    const daysInMonth = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7;
    const grid = $("calendarGrid");
    if (!grid) return;

    const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayCells = [
      ...weekdayNames.map((label) => `<div class="weekday">${label}</div>`),
    ];

    for (let index = 0; index < offset; index += 1) {
      dayCells.push('<div class="day other-month"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const currentDate = new Date(state.date.getFullYear(), state.date.getMonth(), day);
      const currentKey = dayKey(currentDate);
      const entries = state.events.filter((event) => dayKey(event.start_at) === currentKey);
      const content = entries.slice(0, 3).map((entry) => {
        const cssClass = eventTypeClass(entry.type);
        return `<div class="event ${cssClass}"><i class="fa-solid fa-circle"></i><span>${entry.title}</span></div>`;
      }).join("");
      const todayClass = dayKey(new Date()) === currentKey ? "today" : "";
      dayCells.push(`<div class="day ${todayClass}" data-date="${currentKey}"><div class="date-number">${day}</div>${content}</div>`);
    }

    const remainder = (7 - (dayCells.length % 7)) % 7;
    for (let index = 0; index < remainder; index += 1) {
      dayCells.push('<div class="day other-month"></div>');
    }

    grid.innerHTML = dayCells.join("");
  }

  function renderStats() {
    const month = state.date.getMonth();
    const year = state.date.getFullYear();
    const monthEvents = state.events.filter((event) => {
      const start = new Date(event.start_at);
      return start.getMonth() === month && start.getFullYear() === year;
    });
    const classesStat = $("classesStat");
    const assignmentsStat = $("assignmentsStat");
    const assessmentsStat = $("assessmentsStat");
    const holidaysStat = $("holidaysStat");

    if (classesStat) classesStat.textContent = monthEvents.filter((event) => ["live_class", "class"].includes(event.type)).length;
    if (assignmentsStat) assignmentsStat.textContent = monthEvents.filter((event) => event.type === "assignment").length;
    if (assessmentsStat) assessmentsStat.textContent = monthEvents.filter((event) => ["quiz", "exam"].includes(event.type)).length;
    if (holidaysStat) holidaysStat.textContent = monthEvents.filter((event) => event.type === "holiday").length;
  }

  function renderUpcoming() {
    const upcoming = state.events.filter((event) => new Date(event.start_at) >= new Date()).sort((left, right) => new Date(left.start_at) - new Date(right.start_at)).slice(0, 4);
    const container = $("upcomingCard");
    if (!container) return;
    container.innerHTML = '<div class="side-card-header"><h3>Upcoming</h3><span>Next 7 days</span></div>' + (upcoming.length ? upcoming.map((event) => {
      const date = new Date(event.start_at);
      return `<div class="upcoming-event"><div class="event-date"><strong>${String(date.getDate()).padStart(2, "0")}</strong><span>${formatDate(date, { month: "short" }).slice(0, 3)}</span></div><div class="upcoming-info"><h4>${event.title}</h4><p><i class="fa-regular fa-clock"></i>${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })}${event.subject ? ` · ${event.subject}` : ""}</p></div></div>`;
    }).join("") : '<div class="upcoming-event"><div class="upcoming-info"><h4>No upcoming events</h4><p>There are no future events for your profile.</p></div></div>');
  }

  function renderHolidays() {
    const holidays = state.events.filter((event) => event.type === "holiday").sort((left, right) => new Date(left.start_at) - new Date(right.start_at)).slice(0, 3);
    const container = $("holidaysCard");
    if (!container) return;
    container.innerHTML = '<div class="side-card-header"><h3>Upcoming Holidays</h3><span id="holidayMonthLabel"></span></div>' + (holidays.length ? holidays.map((event) => `<div class="holiday-item"><div class="holiday-icon"><i class="fa-solid fa-umbrella-beach"></i></div><div class="holiday-info"><h4>${event.title}</h4><p>${formatDate(event.start_at, { month: "short", day: "numeric", year: "numeric" })}</p></div></div>`).join("") : '<div class="holiday-item"><div class="holiday-info"><h4>No upcoming holidays</h4><p>None for the current calendar.</p></div></div>');
  }

  function renderClassUpdate() {
    const classUpdates = state.events.filter((event) => event.type === "rescheduled_class" || event.status === "cancelled").slice(0, 1);
    const container = $("classUpdateCard");
    if (!container) return;
    const update = classUpdates[0];
    if (!update) {
      container.innerHTML = '<div class="side-card-header"><h3>Class Update</h3><span>Important</span></div><div class="reschedule-box"><p>No class schedule changes right now.</p></div>';
      return;
    }
    container.innerHTML = `<div class="side-card-header"><h3>Class Update</h3><span>Important</span></div><div class="reschedule-box"><div class="reschedule-top"><div class="reschedule-icon"><i class="fa-solid fa-calendar-xmark"></i></div><h4>${eventTypeBadge(update.type)}</h4></div><p>${update.description || update.title}</p><div class="schedule-change"><span class="old-time">${formatDate(update.start_at, { month: "short", day: "numeric" })}</span><i class="fa-solid fa-arrow-right"></i><span class="new-time">${formatDate(update.end_at || update.start_at, { month: "short", day: "numeric" })}</span></div></div>`;
  }

  function renderCalendar() {
    const monthTitle = $("monthTitle");
    if (monthTitle) {
      monthTitle.textContent = formatDate(state.date, { month: "long", year: "numeric" });
    }
    renderMonthGrid();
    renderStats();
    renderUpcoming();
    renderClassUpdate();
    renderHolidays();
  }

  function renderModal(event) {
    const modal = $("eventModal");
    if (!modal) return;
    $("modalTitle").textContent = event.title;
    $("modalDate").textContent = formatDate(event.start_at, { month: "long", day: "numeric", year: "numeric" });
    $("modalTime").textContent = `${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })} - ${formatDate(event.end_at || event.start_at, { hour: "numeric", minute: "2-digit" })}`;
    $("modalSubject").textContent = event.subject || "General";
    $("modalDetails").textContent = `${event.description || "No additional details provided."} ${event.location ? `Location: ${event.location}` : ""}`;
    modal.classList.add("show");
  }

  async function refresh() {
    try {
      state.events = await loadEvents();
      renderCalendar();
    } catch (error) {
      console.error("Unable to render student calendar.", error);
      block(error.message || "Unable to load student calendar data.");
    }
  }

  function bindUi() {
    document.addEventListener("click", (event) => {
      const dayElement = event.target.closest(".day");
      if (dayElement && dayElement.dataset.date) {
        const [year, month, day] = dayElement.dataset.date.split("-").map(Number);
        state.date = new Date(year, month - 1, 1);
        renderCalendar();
      }
      const eventItem = event.target.closest(".event");
      if (eventItem && eventItem.textContent) {
        const date = eventItem.closest(".day")?.dataset.date;
        if (!date) return;
        const matching = state.events.filter((entry) => dayKey(entry.start_at) === date);
        if (matching[0]) renderModal(matching[0]);
      }
    });

    window.goToday = () => {
      state.date = new Date();
      renderCalendar();
    };

    window.previousMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1);
      renderCalendar();
    };

    window.nextMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1);
      renderCalendar();
    };

    window.closeModal = () => {
      const overlay = $("eventModal");
      if (overlay) overlay.classList.remove("show");
    };
  }

  async function init() {
    bindUi();
    await refresh();
    state.stopRealtime = await subscribe();
  }

  init();
})();
