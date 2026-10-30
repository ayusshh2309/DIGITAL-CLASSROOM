(() => {
  const state = {
    date: new Date(),
    selectedDate: new Date(),
    events: [],
    profile: null,
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
    };
  }

  async function getStudentProfile() {
    const client = getClient();
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

    state.profile = student;
    return { client, user: userData.user, profile: student };
  }

  async function loadEvents(date = state.date) {
    const { client } = await getStudentProfile();
    const now = new Date();
    const upcomingEnd = new Date(now);
    upcomingEnd.setFullYear(upcomingEnd.getFullYear() + 1);
    const ranges = [monthRange(date), { start: now, end: upcomingEnd }];
    const rowsById = new Map();

    for (const range of ranges) {
      const { data, error } = await client
        .from("calendar_events")
        .select("id, teacher_id, title, description, event_type, grade, stream, subject_id, start_at, end_at, all_day, location, meeting_url, status, is_visible_to_students, source_table, source_id")
        .eq("status", "published")
        .eq("is_visible_to_students", true)
        .gte("start_at", range.start.toISOString())
        .lt("start_at", range.end.toISOString())
        .order("start_at", { ascending: true });
      if (error) throw error;
      for (const row of data || []) rowsById.set(row.id, row);
    }

    const calendarEvents = [...rowsById.values()]
      .map((row) => normalizeRow(row, "calendar_events", row.event_type))
      .filter(Boolean);
    const linkedLiveClassIds = new Set(
      calendarEvents
        .filter((event) => event.source_table === "live_classes" && event.source_id)
        .map((event) => String(event.source_id)),
    );
    try {
      const { data: liveClasses, error: liveClassError } = await client.rpc("get_student_live_classes");
      if (liveClassError) throw liveClassError;
      const liveClassEvents = (liveClasses || [])
        .filter((liveClass) => {
          const matchesRegisteredGrade = Number(liveClass.grade) === Number(state.profile.grade);
          const registeredStream = String(state.profile.stream || "").trim().toLowerCase();
          const classStream = String(liveClass.stream || "").trim().toLowerCase();
          const start = new Date(liveClass.start_at);
          return matchesRegisteredGrade
            && classStream === registeredStream
            && Number.isFinite(start.getTime())
            && ranges.some((range) => start >= range.start && start < range.end);
        })
        .filter((liveClass) => !linkedLiveClassIds.has(String(liveClass.id)))
        .map((liveClass) => normalizeRow({
          ...liveClass,
          source_table: "live_classes",
          source_id: liveClass.id,
          status: liveClass.status,
          event_type: "live_class",
        }, "live_classes", "live_class"))
        .filter(Boolean);
      return [...calendarEvents, ...liveClassEvents]
        .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
    } catch (error) {
      console.error("Could not load student live classes for the calendar.", error);
      return calendarEvents.sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
    }
  }

  async function subscribe() {
    const client = getClient();
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
      const content = entries.slice(0, 3).map((entry) => {
        const cssClass = eventTypeClass(entry.type);
        return `<div class="event ${cssClass}" data-calendar-event-id="${escapeHtml(entry.id)}" role="button" tabindex="0"><i class="fa-solid fa-circle"></i><span>${escapeHtml(entry.title)}</span></div>`;
      }).join("");
      const todayClass = dayKey(new Date()) === currentKey ? "today" : "";
      const selectedClass = dayKey(state.selectedDate) === currentKey ? "selected-day" : "";
      dayCells.push(`<div class="day ${todayClass} ${selectedClass}" data-date="${currentKey}"><div class="date-number">${day}</div>${content}</div>`);
    }

    const remainder = (7 - (dayCells.length % 7)) % 7;
    for (let index = 0; index < remainder; index += 1) {
      dayCells.push('<div class="day other-month"></div>');
    }

    grid.innerHTML = dayCells.join("");
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

  function renderHolidays() {
    const now = new Date();
    const holidays = state.events
      .filter((event) => event.type === "holiday" && new Date(event.start_at) >= now)
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at))
      .slice(0, 3);
    const container = $("holidaysCard");
    if (!container) return;
    container.innerHTML = '<div class="side-card-header"><h3>Upcoming Holidays</h3><span id="holidayMonthLabel"></span></div>' + (holidays.length ? holidays.map((event) => `<div class="holiday-item" data-calendar-event-id="${escapeHtml(event.id)}" role="button" tabindex="0"><div class="holiday-icon"><i class="fa-solid fa-umbrella-beach"></i></div><div class="holiday-info"><h4>${escapeHtml(event.title)}</h4><p>${formatDate(event.start_at, { month: "short", day: "numeric", year: "numeric" })}</p></div></div>`).join("") : '<div class="holiday-item"><div class="holiday-info"><h4>No upcoming holidays</h4><p>None for the current calendar.</p></div></div>');
  }

  function renderClassUpdate() {
    const classUpdates = state.events
      .filter((event) => event.type === "rescheduled_class" || event.status === "cancelled")
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
    const container = $("classUpdateCard");
    if (!container) return;
    const update = classUpdates[0];
    if (!update) {
      container.innerHTML = '<div class="side-card-header"><h3>Class Update</h3><span>Important</span></div><div class="reschedule-box"><p>No recent class updates.</p></div>';
      return;
    }
    container.innerHTML = `<div class="side-card-header"><h3>Class Update</h3><span>Important</span></div><div class="reschedule-box" data-calendar-event-id="${escapeHtml(update.id)}" role="button" tabindex="0"><div class="reschedule-top"><div class="reschedule-icon"><i class="fa-solid fa-calendar-xmark"></i></div><h4>${eventTypeBadge(update.type)}</h4></div><p>${escapeHtml(update.description || update.title)}</p><div class="schedule-change"><span class="new-time">${formatDate(update.start_at, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span></div></div>`;
  }

  function renderCalendar() {
    const monthTitle = $("monthTitle");
    if (monthTitle) {
      monthTitle.textContent = formatDate(state.date, { month: "long", year: "numeric" });
    }
    renderRegistrationContext();
    renderMonthGrid();
    renderMiniCalendar();
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
      : event.end_at
        ? `${formatDate(event.start_at, { hour: "numeric", minute: "2-digit" })} - ${formatDate(event.end_at, { hour: "numeric", minute: "2-digit" })}`
        : formatDate(event.start_at, { hour: "numeric", minute: "2-digit" });
    $("modalSubject").textContent = event.subject || "General";
    const details = [
      eventTypeLabel(event.type),
      event.class_grade ? `Grade ${event.class_grade}${event.stream ? ` - ${event.stream}` : ""}` : "",
      event.teacher ? `By ${event.teacher}` : "",
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
    }
    const liveClassRow = $("modalLiveClassRow");
    const liveClassButton = $("modalLiveClass");
    const isLiveClass = event.source_table === "live_classes" && event.source_id;
    if (liveClassRow) liveClassRow.hidden = !isLiveClass || Boolean(event.meeting_url);
    if (liveClassButton) {
      liveClassButton.dataset.liveClassId = isLiveClass ? String(event.source_id) : "";
    }
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
        void openAuthorizedUrl(
          () => {
            const downloads = window.SmartLearningDownloads;
            if (!downloads?.getStudentMaterialUrl) {
              throw new Error("Student material access is unavailable. Reload the page and try again.");
            }
            return downloads.getStudentMaterialUrl(materialButton.dataset.materialId);
          },
          "teacher material",
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
      state.stopRealtime = await subscribe();
    } catch (error) {
      console.error("Could not subscribe to student calendar Realtime updates.", error);
    }
    await refresh();
  }

  window.addEventListener("pagehide", () => state.stopRealtime());
  init();
})();
