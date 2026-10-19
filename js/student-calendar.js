(() => {
  const state = {
    date: new Date(),
    events: [],
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

  function normalizeRow(row, source, type) {
    const start = new Date(row.start_at);
    if (!Number.isFinite(start.getTime())) return null;
    const end = row.end_at ? new Date(row.end_at) : null;
    const subjectRelation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    return {
      id: `${source}-${row.id}`,
      source,
      type: type || row.event_type || "event",
      title: row.title || row.name || row.topic || "Academic event",
      description: row.description || "",
      subject: subjectRelation?.name || row.subject_name || row.subject || (row.subject_id ? `Subject ${row.subject_id}` : ""),
      class_grade: row.grade ?? row.class_grade ?? "",
      stream: row.stream || "",
      start_at: start.toISOString(),
      end_at: end && Number.isFinite(end.getTime()) ? end.toISOString() : null,
      status: row.status || "scheduled",
      location: row.location || row.meeting_url || "",
      all_day: Boolean(row.all_day),
    };
  }

  async function getStudentProfile() {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured.");
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData?.user) {
      throw Object.assign(new Error("Authentication failed. Please sign in again."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id, user_id, grade, stream")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student) throw new Error("Student profile could not be found.");

    return { client, user: userData.user, profile: student };
  }

  async function loadEvents(date = state.date) {
    const { client, user } = await getStudentProfile();
    const range = monthRange(date);
    const { data, error } = await client.rpc("get_student_calendar_events", {
      requested_student_id: user.id,
    });
    if (error) throw error;

    return (data || [])
      .map((row) => normalizeRow(row, row.source || "calendar_events", row.event_type))
      .filter(Boolean)
      .filter((event) => {
        const eventTime = new Date(event.start_at).getTime();
        return eventTime >= range.start.getTime() && eventTime < range.end.getTime();
      })
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
  }

  async function subscribe() {
    const client = getClient();
    if (!client) throw new Error("Supabase is not configured.");
    if (activeChannel) await client.removeChannel(activeChannel);
    const channel = client.channel("student-calendar-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events" }, () => {
        void refresh();
      });
    activeChannel = channel;
    channel.subscribe((status, error) => {
      if (error || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Student calendar Realtime subscription failed.", error || status);
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
        return `<div class="event ${cssClass}" data-event-id="${escapeHtml(entry.id)}"><i class="fa-solid fa-circle"></i><span>${escapeHtml(entry.title)}</span></div>`;
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
      return `<div class="upcoming-event"><div class="event-date"><strong>${String(date.getDate()).padStart(2, "0")}</strong><span>${formatDate(date, { month: "short" }).slice(0, 3)}</span></div><div class="upcoming-info"><h4>${escapeHtml(event.title)}</h4><p><i class="fa-regular fa-clock"></i>${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })}${event.subject ? ` · ${escapeHtml(event.subject)}` : ""}</p></div></div>`;
    }).join("") : '<div class="upcoming-event"><div class="upcoming-info"><h4>No upcoming events</h4><p>There are no future events for your profile.</p></div></div>');
  }

  function renderHolidays() {
    const holidays = state.events.filter((event) => event.type === "holiday").sort((left, right) => new Date(left.start_at) - new Date(right.start_at)).slice(0, 3);
    const container = $("holidaysCard");
    if (!container) return;
    container.innerHTML = '<div class="side-card-header"><h3>Upcoming Holidays</h3><span id="holidayMonthLabel"></span></div>' + (holidays.length ? holidays.map((event) => `<div class="holiday-item"><div class="holiday-icon"><i class="fa-solid fa-umbrella-beach"></i></div><div class="holiday-info"><h4>${escapeHtml(event.title)}</h4><p>${formatDate(event.start_at, { month: "short", day: "numeric", year: "numeric" })}</p></div></div>`).join("") : '<div class="holiday-item"><div class="holiday-info"><h4>No upcoming holidays</h4><p>None for the current calendar.</p></div></div>');
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
    container.innerHTML = `<div class="side-card-header"><h3>Class Update</h3><span>Important</span></div><div class="reschedule-box"><div class="reschedule-top"><div class="reschedule-icon"><i class="fa-solid fa-calendar-xmark"></i></div><h4>${eventTypeBadge(update.type)}</h4></div><p>${escapeHtml(update.description || update.title)}</p><div class="schedule-change"><span class="old-time">${formatDate(update.start_at, { month: "short", day: "numeric" })}</span><i class="fa-solid fa-arrow-right"></i><span class="new-time">${formatDate(update.end_at || update.start_at, { month: "short", day: "numeric" })}</span></div></div>`;
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
    $("modalTime").textContent = event.all_day
      ? "All day"
      : `${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })} - ${formatDate(event.end_at || event.start_at, { hour: "numeric", minute: "2-digit" })}`;
    $("modalSubject").textContent = event.subject || "General";
    $("modalDetails").textContent = `${event.description || "No additional details provided."} ${event.location ? `Location: ${event.location}` : ""}`;
    modal.classList.add("show");
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
      renderStats();
      block(error.message || "Unable to load student calendar data.");
      const message = escapeHtml(error.message || "Unable to load calendar data.");
      if ($("upcomingCard")) $("upcomingCard").innerHTML = `<div class="side-card-header"><h3>Upcoming</h3></div><div class="upcoming-event"><div class="upcoming-info"><h4>${message}</h4></div></div>`;
      if ($("holidaysCard")) $("holidaysCard").innerHTML = `<div class="side-card-header"><h3>Upcoming Holidays</h3></div><div class="holiday-item"><div class="holiday-info"><h4>${message}</h4></div></div>`;
      if ($("classUpdateCard")) $("classUpdateCard").innerHTML = `<div class="side-card-header"><h3>Class Update</h3></div><div class="reschedule-box"><p>${message}</p></div>`;
    }
  }

  function bindUi() {
    document.addEventListener("click", (event) => {
      const eventItem = event.target.closest(".event");
      if (eventItem && eventItem.textContent) {
        const matching = state.events.find((entry) => entry.id === eventItem.dataset.eventId);
        if (matching) {
          event.stopPropagation();
          renderModal(matching);
          return;
        }
      }
      const dayElement = event.target.closest(".day");
      if (dayElement && dayElement.dataset.date) {
        const [year, month, day] = dayElement.dataset.date.split("-").map(Number);
        state.date = new Date(year, month - 1, 1);
        renderCalendar();
      }
    });

    window.goToday = () => {
      state.date = new Date();
      void refresh();
    };

    window.previousMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1);
      void refresh();
    };

    window.nextMonth = () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1);
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
      state.stopRealtime = await subscribe();
    } catch (error) {
      console.error("Could not subscribe to student calendar Realtime updates.", error);
    }
    await refresh();
  }

  window.addEventListener("pagehide", () => state.stopRealtime());
  init();
})();
