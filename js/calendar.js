(() => {
  const state = {
    events: [],
    date: new Date(),
    view: "month",
    selected: new Date(),
    stopRealtime: () => {},
    teacherScope: null,
    refreshSequence: 0,
    filters: { grade: "", stream: "", subject: "" },
  };

  const $ = (id) => document.getElementById(id);
  const setPageMessage = (message, type = "status") => {
    const element = $("calendarMessage");
    if (!element) return;
    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
  };

  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const formatDate = (value, options = {}) => new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  const displayType = (type) => String(type || "event").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

  const typeClass = (type) => String(type || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const visibleEvents = () => state.events.filter((event) =>
    (!state.filters.grade || String(event.grade ?? "") === state.filters.grade)
    && (!state.filters.stream || String(event.stream || "") === state.filters.stream)
    && (!state.filters.subject || String(event.subject_id || "") === state.filters.subject));

  const eventTime = (event) => {
    if (event.all_day) return "All day";
    const start = new Date(event.start_at);
    const end = event.end_at ? new Date(event.end_at) : null;
    const startText = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(start);
    if (!end || dayKey(start) !== dayKey(end)) return startText;
    return `${startText} - ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(end)}`;
  };

  function renderSummary() {
    const month = state.date.getMonth();
    const year = state.date.getFullYear();
    const rows = visibleEvents().filter((event) => {
      const dt = new Date(event.start_at);
      return dt.getMonth() === month && dt.getFullYear() === year;
    });

    const counts = {
      total: rows.length,
      classes: rows.filter((event) => event.type === "live_class").length,
      assessments: rows.filter((event) => ["quiz", "exam"].includes(event.type)).length,
      reminders: rows.filter((event) => ["announcement", "reminder", "calendar_event"].includes(event.type)).length,
      holidays: rows.filter((event) => event.type === "holiday").length,
    };

    if ($("totalEvents")) $("totalEvents").textContent = counts.total;
    if ($("classesScheduled")) $("classesScheduled").textContent = counts.classes;
    if ($("assessmentsCount")) $("assessmentsCount").textContent = counts.assessments;
    if ($("remindersCount")) $("remindersCount").textContent = counts.reminders;
    if ($("holidaysCount")) $("holidaysCount").textContent = counts.holidays;
  }

  function renderMonth() {
    const year = state.date.getFullYear();
    const month = state.date.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let html = labels.map((label) => `<div class="day-heading">${label}</div>`).join("");

    for (let index = 0; index < offset; index += 1) {
      html += '<div class="day-cell"></div>';
    }

    for (let day = 1; day <= days; day += 1) {
      const currentDate = new Date(year, month, day);
      const key = dayKey(currentDate);
      const events = visibleEvents().filter((event) => dayKey(event.start_at) === key);
      html += `<div class="day-cell" data-date="${key}"><div class="day-number ${key === dayKey(new Date()) ? "today" : ""}">${day}<span>${events.length ? events.length : ""}</span></div>${events.slice(0, 3).map((event) => `<button class="event-pill ${typeClass(event.type)}" data-event-id="${esc(event.id)}"><span>${esc(event.title || "Academic event")}</span><span class="event-time">${esc(eventTime(event))}</span></button>`).join("")}${events.length > 3 ? `<small>+${events.length - 3} more</small>` : ""}</div>`;
    }

    if ($("calendarView")) {
      $("calendarView").innerHTML = `<div class="calendar-grid">${html}</div>`;
    }
  }

  function renderPeriod() {
    const start = new Date(state.date);
    start.setHours(0, 0, 0, 0);
    const events = visibleEvents();

    if (state.view === "week") {
      const monday = new Date(start);
      monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const dates = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return date;
      });
      const rows = dates.map((date) => {
        const dayEvents = events.filter((event) => dayKey(event.start_at) === dayKey(date)).map((event) => `<button class="event-pill ${typeClass(event.type)}" data-event-id="${esc(event.id)}"><span>${esc(event.title || "Academic event")}</span><span class="event-time">${esc(eventTime(event))}</span></button>`).join("") || '<span style="color:#a2afbc;font-size:.75rem">No events</span>';
        return `<div class="time-row"><div class="time-label">${formatDate(date, { weekday: "short", day: "numeric" })}</div><div class="time-events">${dayEvents}</div></div>`;
      }).join("");
      if ($("calendarView")) $("calendarView").innerHTML = `<div class="week-grid">${rows}</div>`;
      return;
    }

    const dayEvents = events.filter((event) => dayKey(event.start_at) === dayKey(start));
    if ($("calendarView")) {
      $("calendarView").innerHTML = `<div class="day-grid">${dayEvents.length ? dayEvents.map((event) => `<button class="event-pill ${typeClass(event.type)}" data-event-id="${esc(event.id)}"><span>${esc(event.title || "Academic event")}</span><span class="event-time">${esc(eventTime(event))}</span></button>`).join("") : '<div class="empty"><i class="fa-regular fa-calendar-xmark"></i>No events scheduled for this day.</div>'}</div>`;
    }
  }

  function renderMini() {
    const year = state.date.getFullYear();
    const month = state.date.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();
    let html = ["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span class="mini-week">${day}</span>`).join("");

    for (let index = 0; index < offset; index += 1) html += "<span></span>";

    for (let day = 1; day <= totalDays; day += 1) {
      const currentDate = new Date(year, month, day);
      const key = dayKey(currentDate);
      const selected = key === dayKey(state.selected) ? "selected" : "";
      const today = key === dayKey(new Date()) ? "today" : "";
      html += `<button class="${selected} ${today}" data-mini-date="${key}">${day}</button>`;
    }

    if ($("miniCalendar")) $("miniCalendar").innerHTML = html;
  }

  function renderUpcoming() {
    const now = new Date();
    const upcoming = visibleEvents().filter((event) => new Date(event.end_at || event.start_at) >= now).sort((left, right) => new Date(left.start_at) - new Date(right.start_at)).slice(0, 6);
    if (!$("upcomingEvents")) return;
    $("upcomingEvents").innerHTML = upcoming.length ? upcoming.map((event) => `<div class="upcoming-item" data-event-id="${esc(event.id)}"><i class="upcoming-dot"></i><span><strong>${esc(event.title || "Academic event")}</strong><small>${esc(eventTime(event))} · ${esc(formatDate(event.start_at, { month: "short", day: "numeric" }))}</small></span></div>`).join("") : '<div class="empty"><i class="fa-regular fa-calendar-xmark"></i>No upcoming events.</div>';
  }

  function renderCalendar() {
    const title = $("calendarTitle");
    if (title) {
      const period = state.view === "month"
        ? formatDate(state.date, { month: "long", year: "numeric" })
        : state.view === "week"
          ? `Week of ${formatDate(state.date, { month: "short", day: "numeric", year: "numeric" })}`
          : formatDate(state.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const today = formatDate(new Date(), { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      title.textContent = `${period} · Today: ${today}`;
    }

    if (state.view === "month") renderMonth(); else renderPeriod();
    renderMini();
    renderUpcoming();
    renderSummary();
  }

  function renderFilters() {
    const gradeFilter = $("calendarGradeFilter");
    const streamFilter = $("calendarStreamFilter");
    const subjectFilter = $("calendarSubjectFilter");
    if (!gradeFilter || !streamFilter || !subjectFilter) return;
    const groups = state.teacherScope?.groups || [];
    const grades = [...new Set(groups.map((group) => String(group.grade)))].sort((a, b) => Number(a) - Number(b));
    gradeFilter.innerHTML = '<option value="">All assigned classes</option>' + grades
      .map((grade) => `<option value="${esc(grade)}">${esc(`Class ${grade}`)}</option>`).join("");
    gradeFilter.value = state.filters.grade;

    const filteredGroups = groups.filter((group) =>
      !state.filters.grade || String(group.grade) === state.filters.grade);
    const streams = [...new Set(filteredGroups.map((group) => group.stream).filter(Boolean))];
    streamFilter.innerHTML = '<option value="">All streams</option>' + streams
      .map((stream) => `<option value="${esc(stream)}">${esc(stream)}</option>`).join("");
    streamFilter.value = streams.includes(state.filters.stream) ? state.filters.stream : "";
    state.filters.stream = streamFilter.value;

    const subjects = new Map();
    filteredGroups
      .filter((group) => !state.filters.stream || String(group.stream || "") === state.filters.stream)
      .forEach((group) => (group.subjects || []).forEach((subject) =>
        subjects.set(String(subject.id), subject.name)));
    subjectFilter.innerHTML = '<option value="">All assigned subjects</option>' + [...subjects]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
    if (!subjects.has(state.filters.subject)) state.filters.subject = "";
    subjectFilter.value = state.filters.subject;
  }

  function showDetails(event) {
    const root = $("calendarModalRoot");
    if (!root) return;
    const storedStatus = String(event.status || "scheduled").trim().toLowerCase();
    const isLiveClass = event.source === "live_classes" || event.type === "live_class";
    const eventEnd = new Date(event.end_at || event.start_at);
    const status = isLiveClass
      ? storedStatus === "scheduled" && eventEnd < new Date()
        ? "Missed"
        : (event.status || "Scheduled")
      : eventEnd < new Date() ? "Completed" : (event.status || "Scheduled");
    const editable = !event.source_table;
    const meetingUrl = event.meeting_url || "";
    const locationUrl = event.location || "";
    const meetingLink = meetingUrl
      ? `<div class="field full"><label>Meeting link</label><div><a href="${esc(meetingUrl)}" target="_blank" rel="noopener noreferrer">Join meeting</a></div></div>`
      : "";
    const location = locationUrl && locationUrl !== meetingUrl
      ? `<div class="field full"><label>Location</label><div>${esc(locationUrl)}</div></div>`
      : "";
    root.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><span class="page-eyebrow"><i class="fa-solid fa-circle-info"></i> ${esc(displayType(event.type))}</span><h2 style="margin-top:7px">${esc(event.title || "Academic event")}</h2></div><button class="icon-button" data-close><i class="fa-solid fa-xmark"></i></button></div><div class="modal-grid"><div class="field"><label>Class</label><div>${esc(event.class_grade ? `Class ${event.class_grade}` : "All classes")}</div></div><div class="field"><label>Subject</label><div>${esc(event.subject || "All subjects")}</div></div><div class="field"><label>Date and time</label><div>${esc(event.all_day ? formatDate(event.start_at, { dateStyle: "medium" }) : formatDate(event.start_at, { dateStyle: "medium", timeStyle: "short" }))}</div></div><div class="field"><label>Status</label><div>${esc(status)}</div></div><div class="field full"><label>Description</label><div>${esc(event.description || "No additional details.")}</div></div>${meetingLink}${location}</div><p data-modal-error role="alert"></p><div class="modal-actions">${editable ? '<button class="cal-button" data-delete-event>Delete</button><button class="cal-button primary" data-edit-event>Edit</button>' : ""}<button class="cal-button" data-close>Close</button></div></div></div>`;
    root.querySelector("[data-edit-event]")?.addEventListener("click", () => openEventForm(event));
    root.querySelector("[data-delete-event]")?.addEventListener("click", async () => {
      if (!window.confirm("Delete this calendar event? Its source activity, if any, will not be deleted.")) return;
      const button = root.querySelector("[data-delete-event]");
      button.disabled = true;
      try {
        await window.CalendarService.deleteEvent(event.calendar_id);
        root.innerHTML = "";
        const refreshed = await refreshEvents();
        setPageMessage(refreshed ? "Calendar event deleted." : "Calendar event deleted, but the list could not refresh.", refreshed ? "success" : "error");
      } catch (error) {
        button.disabled = false;
        const message = root.querySelector("[data-modal-error]");
        if (message) message.textContent = error.message || "Could not delete this event.";
      }
    });
  }

  const dateTimeInput = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };

  function openEventForm(event = null) {
    const root = $("calendarModalRoot");
    if (!root) return;
    const groups = state.teacherScope?.groups || [];
    if (!groups.length) {
      setPageMessage("Your registered teaching scope could not be loaded. Calendar events cannot be created without it.", "error");
      return;
    }
    const grades = [...new Set(groups.map((group) => Number(group.grade)).filter(Number.isInteger))].sort((a, b) => a - b);
    const currentGrade = String(event?.grade ?? event?.class_grade ?? groups[0].grade);
    const gradeOptions = grades.map((grade) => `<option value="${grade}" ${currentGrade === String(grade) ? "selected" : ""}>Class ${grade}</option>`).join("");
    const types = ["event", "class", "holiday", "material", "quiz", "exam", "live_class", "announcement", "meeting", "other"];
    const typeOptions = types.map((type) => `<option value="${type}" ${String(event?.event_type || event?.type || "event") === type ? "selected" : ""}>${esc(displayType(type))}</option>`).join("");
    const statuses = ["draft", "scheduled", "published", "completed", "cancelled"];
    const statusOptions = statuses.map((status) => `<option value="${status}" ${String(event?.status || "draft") === status ? "selected" : ""}>${esc(displayType(status))}</option>`).join("");
    const currentStream = String(event?.stream || "");
    const selectedGroup = groups.find((group) =>
      Number(group.grade) === Number(currentGrade)
      && String(group.stream || "") === currentStream);
    root.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><span class="page-eyebrow"><i class="fa-regular fa-calendar"></i> Calendar event</span><h2 style="margin-top:7px">${event ? "Edit event" : "Add event"}</h2></div><button class="icon-button" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><form id="calendarEventForm"><div class="modal-grid"><div class="field full"><label for="calendarEventTitle">Title</label><input id="calendarEventTitle" name="title" maxlength="160" required value="${esc(event?.title || "")}"></div><div class="field"><label for="calendarEventType">Event type</label><select id="calendarEventType" name="event_type" required>${typeOptions}</select></div><div class="field"><label for="calendarEventStatus">Status</label><select id="calendarEventStatus" name="status" required>${statusOptions}</select></div><div class="field"><label for="calendarEventGrade">Class</label><select id="calendarEventGrade" name="grade" required>${gradeOptions}</select></div><div class="field"><label for="calendarEventStream">Stream</label><select id="calendarEventStream" name="stream"><option value="">No stream</option></select></div><div class="field"><label for="calendarEventSubject">Subject</label><select id="calendarEventSubject" name="subject_id"><option value="">All assigned subjects</option></select></div><div class="field"><label for="calendarEventStart">Start</label><input id="calendarEventStart" name="start_at" type="datetime-local" required value="${esc(dateTimeInput(event?.start_at))}"></div><div class="field"><label for="calendarEventEnd">End (optional)</label><input id="calendarEventEnd" name="end_at" type="datetime-local" value="${esc(dateTimeInput(event?.end_at))}"></div><div class="field"><label for="calendarEventLocation">Location</label><input id="calendarEventLocation" name="location" value="${esc(event?.location || "")}"></div><div class="field"><label for="calendarEventMeetingUrl">Meeting URL</label><input id="calendarEventMeetingUrl" name="meeting_url" type="url" value="${esc(event?.meeting_url || event?.location || "")}"></div><div class="field full"><label for="calendarEventDescription">Description (optional)</label><textarea id="calendarEventDescription" name="description" rows="3">${esc(event?.description || "")}</textarea></div><div class="field"><label><input name="all_day" type="checkbox" ${event?.all_day ? "checked" : ""}> All-day event</label></div><div class="field"><label><input name="is_visible_to_students" type="checkbox" ${event?.is_visible_to_students ? "checked" : ""}> Visible to students for class-wide events only</label></div></div><p class="calendar-form-error" data-form-error role="alert"></p><div class="modal-actions"><button class="cal-button" type="button" data-close>Cancel</button><button class="cal-button primary" type="submit">${event ? "Save changes" : "Create event"}</button></div></form></div></div>`;

    const form = root.querySelector("#calendarEventForm");
    const gradeSelect = form.elements.grade;
    const streamSelect = form.elements.stream;
    const subjectSelect = form.elements.subject_id;
    const updateScopeOptions = (selectedStream = "", selectedSubject = "") => {
      const grade = Number(gradeSelect.value);
      const gradeGroups = groups.filter((group) => Number(group.grade) === grade);
      const streams = [...new Set(gradeGroups.map((group) => group.stream).filter(Boolean))];
      streamSelect.innerHTML = grade >= 11
        ? streams.map((stream) => `<option value="${esc(stream)}">${esc(stream)}</option>`).join("")
        : '<option value="">No stream</option>';
      streamSelect.required = grade >= 11;
      if (grade < 11) {
        streamSelect.value = "";
      } else {
        streamSelect.value = streams.includes(selectedStream) ? selectedStream : (streams[0] || "");
      }
      const group = gradeGroups.find((item) => String(item.stream || "") === streamSelect.value);
      const subjects = group?.subjects || [];
      subjectSelect.innerHTML = '<option value="">All assigned subjects</option>' + subjects
        .map((subject) => `<option value="${esc(subject.id)}">${esc(subject.name)}</option>`).join("");
      subjectSelect.value = subjects.some((subject) => String(subject.id) === selectedSubject)
        ? selectedSubject
        : "";
    };
    gradeSelect.addEventListener("change", () => updateScopeOptions());
    streamSelect.addEventListener("change", () => updateScopeOptions(streamSelect.value, subjectSelect.value));
    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const submitButton = form.querySelector('[type="submit"]');
      const errorElement = form.querySelector("[data-form-error]");
      submitButton.disabled = true;
      errorElement.textContent = "";
      const data = new FormData(form);
      const payload = Object.fromEntries(data.entries());
      payload.all_day = form.elements.all_day.checked;
      payload.is_visible_to_students = form.elements.is_visible_to_students.checked;
      try {
        if (event) {
          await window.CalendarService.updateEvent(event.calendar_id, payload);
        } else {
          await window.CalendarService.createEvent(payload);
        }
        const action = !event
          ? "saved"
          : payload.status === "published"
            ? "marked as published"
            : payload.status === "cancelled"
              ? "cancelled"
              : "updated";
        const refreshed = await refreshEvents();
        root.innerHTML = "";
        setPageMessage(
          refreshed
            ? `Calendar event ${action} in Supabase.`
            : `Calendar event ${action} in Supabase, but the list could not refresh.`,
          refreshed ? "success" : "error",
        );
        if (!refreshed) {
          if ($("calendarView")) $("calendarView").innerHTML = '<div class="empty">The event was saved, but the calendar could not be refreshed. Refresh the page to verify it.</div>';
        }
      } catch (error) {
        submitButton.disabled = false;
        errorElement.textContent = error.message || "Could not save this event.";
      }
    });
    updateScopeOptions(selectedGroup?.stream || "", String(event?.subject_id || ""));
  }

  async function refreshEvents() {
    const sequence = ++state.refreshSequence;
    const requestedDate = new Date(state.date);
    try {
      const events = await window.CalendarService.loadEvents(requestedDate, state.view);
      if (sequence !== state.refreshSequence) return true;
      state.events = events;
      renderCalendar();
      setPageMessage(events.length ? "" : "No calendar events are stored for this period.", "status");
      return true;
    } catch (error) {
      if (sequence !== state.refreshSequence) return true;
      console.error("Failed to load teacher calendar events.", error);
      state.events = [];
      renderSummary();
      renderUpcoming();
      setPageMessage(error?.message || "Unable to load calendar events.", "error");
      if ($("calendarView")) $("calendarView").innerHTML = `<div class="empty"><i class="fa-regular fa-circle-exclamation"></i>${esc(error?.message || "Unable to load calendar events.")}</div>`;
      return false;
    }
  }

  function bindEvents() {
    $("prevDate")?.addEventListener("click", () => {
      shiftDate(-1);
      refreshEvents();
    });

    $("nextDate")?.addEventListener("click", () => {
      shiftDate(1);
      refreshEvents();
    });

    $("todayButton")?.addEventListener("click", () => {
      state.date = new Date();
      state.selected = new Date();
      refreshEvents();
    });
    $("addCalendarEventButton")?.addEventListener("click", () => openEventForm());

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
        refreshEvents();
      });
    });

    $("calendarGradeFilter")?.addEventListener("change", (event) => {
      state.filters.grade = event.target.value;
      state.filters.stream = "";
      state.filters.subject = "";
      renderFilters();
      renderCalendar();
    });
    $("calendarStreamFilter")?.addEventListener("change", (event) => {
      state.filters.stream = event.target.value;
      state.filters.subject = "";
      renderFilters();
      renderCalendar();
    });
    $("calendarSubjectFilter")?.addEventListener("change", (event) => {
      state.filters.subject = event.target.value;
      renderCalendar();
    });

    document.addEventListener("click", (event) => {
      const closeTarget = event.target.closest("[data-close]");
      if (closeTarget) {
        const modalRoot = $("calendarModalRoot");
        if (modalRoot) modalRoot.innerHTML = "";
      }

      const eventButton = event.target.closest("[data-event-id]");
      if (eventButton) {
        const targetEvent = state.events.find((entry) => entry.id === eventButton.getAttribute("data-event-id"));
        if (targetEvent) showDetails(targetEvent);
      }

      const miniDate = event.target.closest("[data-mini-date]");
      if (miniDate) {
        const [year, month, day] = miniDate.getAttribute("data-mini-date").split("-").map(Number);
        state.selected = new Date(year, month - 1, day);
        state.date = new Date(state.selected);
        refreshEvents();
      }
    });
  }

  function shiftDate(direction) {
    if (state.view === "week") {
      state.date.setDate(state.date.getDate() + direction * 7);
    } else if (state.view === "day") {
      state.date.setDate(state.date.getDate() + direction);
    } else {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() + direction, 1);
    }
    state.selected = new Date(state.date);
  }

  async function init() {
    bindEvents();
    renderCalendar();
    try {
      const { client, profile } = await window.CalendarService.requireTeacher();
      state.teacherScope = await window.CalendarService.getTeacherScope(client, profile.id);
      renderFilters();
    } catch (error) {
      console.error("Failed to load teacher calendar scope.", error);
      setPageMessage(error?.message || "Unable to load registered teaching scope.", "error");
    }
    if (window.CalendarService && typeof window.CalendarService.subscribe === "function") {
      try {
        state.stopRealtime = await window.CalendarService.subscribe(() => refreshEvents());
      } catch (error) {
        console.error("Could not subscribe to calendar Realtime updates.", error);
      }
    }
    await refreshEvents();
  }

  window.addEventListener("pagehide", () => state.stopRealtime());
  init();
})();
