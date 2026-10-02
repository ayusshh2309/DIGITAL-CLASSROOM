(() => {
  const state = {
    events: [],
    date: new Date(),
    view: "month",
    filter: "",
    selected: new Date(),
    stopRealtime: () => {},
  };

  const $ = (id) => document.getElementById(id);

  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const formatDate = (value, options = {}) => new Intl.DateTimeFormat("en-US", options).format(new Date(value));
  const displayType = (type) => String(type || "event").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

  const typeClass = (type) => String(type || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const eventTime = (event) => {
    const start = new Date(event.start_at);
    const end = event.end_at ? new Date(event.end_at) : null;
    const startText = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(start);
    if (!end || dayKey(start) !== dayKey(end)) return startText;
    return `${startText} - ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(end)}`;
  };

  function visibleEvents() {
    return state.filter ? state.events.filter((event) => event.type === state.filter) : state.events;
  }

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

  function populateFilter() {
    const select = $("calendarTypeFilter");
    if (!select) return;
    const types = [...new Set(state.events.map((event) => event.type).filter(Boolean))].sort();
    const currentValue = state.filter && types.includes(state.filter) ? state.filter : "";
    select.innerHTML = '<option value="">All event types</option>' + types.map((type) => `<option value="${esc(type)}">${esc(displayType(type))}</option>`).join("");
    select.value = currentValue;
    state.filter = currentValue;
  }

  function renderCalendar() {
    const title = $("calendarTitle");
    if (title) {
      title.textContent = state.view === "month" ? formatDate(state.date) : state.view === "week" ? `Week of ${formatDate(state.date, { month: "short", day: "numeric", year: "numeric" })}` : formatDate(state.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }

    if (state.view === "month") renderMonth(); else renderPeriod();
    renderMini();
    renderUpcoming();
    renderSummary();
    populateFilter();
  }

  function showDetails(event) {
    const root = $("calendarModalRoot");
    if (!root) return;
    const status = new Date(event.end_at || event.start_at) < new Date() ? "Completed" : (event.status || "Scheduled");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><span class="page-eyebrow"><i class="fa-solid fa-circle-info"></i> ${esc(displayType(event.type))}</span><h2 style="margin-top:7px">${esc(event.title || "Academic event")}</h2></div><button class="icon-button" data-close><i class="fa-solid fa-xmark"></i></button></div><div class="modal-grid"><div class="field"><label>Class</label><div>${esc(event.class_grade ? `Class ${event.class_grade}` : "All classes")}</div></div><div class="field"><label>Subject</label><div>${esc(event.subject || "All subjects")}</div></div><div class="field"><label>Date and time</label><div>${esc(formatDate(event.start_at, { dateStyle: "medium", timeStyle: "short" }))}</div></div><div class="field"><label>Status</label><div>${esc(status)}</div></div><div class="field full"><label>Description</label><div>${esc(event.description || "No additional details.")}</div></div>${event.location ? `<div class="field full"><label>Location / Link</label><div><a href="${esc(event.location)}" target="_blank" rel="noreferrer">${esc(event.location)}</a></div></div>` : ""}</div><div class="modal-actions"><button class="cal-button" data-close>Close</button></div></div></div>`;
  }

  async function refreshEvents() {
    try {
      state.events = await window.CalendarService.loadEvents(state.date);
      renderCalendar();
    } catch (error) {
      console.error("Failed to load teacher calendar events.", error);
      if ($("calendarView")) $("calendarView").innerHTML = '<div class="empty"><i class="fa-regular fa-circle-exclamation"></i>Unable to load calendar events.</div>';
      console.error(error?.message || "Calendar could not be loaded.");
    }
  }

  function bindEvents() {
    $("prevDate")?.addEventListener("click", () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1);
      refreshEvents();
    });

    $("nextDate")?.addEventListener("click", () => {
      state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1);
      refreshEvents();
    });

    $("todayButton")?.addEventListener("click", () => {
      state.date = new Date();
      state.selected = new Date();
      refreshEvents();
    });

    $("calendarTypeFilter")?.addEventListener("change", (event) => {
      state.filter = event.target.value || "";
      renderCalendar();
    });

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
        renderCalendar();
      });
    });

    $("addEventButton")?.addEventListener("click", () => {
      const root = $("calendarModalRoot");
      if (!root) return;
      root.innerHTML = `<div class="modal-backdrop"><form class="modal" id="eventForm"><div class="modal-head"><div><span class="page-eyebrow"><i class="fa-solid fa-calendar-plus"></i> Calendar event</span><h2 style="margin-top:7px">Add event</h2></div><button type="button" class="icon-button" data-close><i class="fa-solid fa-xmark"></i></button></div><div class="modal-grid"><div class="field full"><label>Title *</label><input name="title" required placeholder="Event title"></div><div class="field"><label>Type</label><select name="event_type"><option value="event">Event</option><option value="holiday">Holiday</option><option value="reminder">Reminder</option><option value="exam">Exam</option></select></div><div class="field"><label>Class</label><select name="grade" id="addEventGrade"><option value="">Select class</option></select></div><div class="field"><label>Stream</label><input name="stream" placeholder="Optional stream"></div><div class="field"><label>Subject</label><select name="subject_id" id="addEventSubject"><option value="">Select subject</option></select></div><div class="field"><label>Start date</label><input name="start_date" type="date" required></div><div class="field"><label>Start time</label><input name="start_time" type="time"></div><div class="field"><label>End date</label><input name="end_date" type="date"></div><div class="field"><label>End time</label><input name="end_time" type="time"></div><div class="field"><label>Location</label><input name="location" placeholder="Venue or link"></div></div><div class="modal-actions"><button type="button" class="cal-button" data-close>Cancel</button><button type="submit" class="cal-button primary">Save event</button></div></form></div>`;

      window.CalendarService.registerClasses().then((classes) => {
        const gradeSelect = $("addEventGrade");
        if (!gradeSelect) return;
        gradeSelect.innerHTML = '<option value="">Select class</option>' + classes.map((group) => `<option value="${esc(group.grade)}">Grade ${esc(group.grade)}${group.stream ? ` ${esc(group.stream)}` : ""}</option>`).join("");
      }).catch(() => {});

      const form = $("eventForm");
      if (form) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const formData = new FormData(form);
          const payload = {
            title: String(formData.get("title") || "").trim(),
            event_type: formData.get("event_type") || "event",
            grade: formData.get("grade") || "",
            stream: formData.get("stream") || "",
            subject_id: formData.get("subject_id") || null,
            start_at: new Date(`${formData.get("start_date")}T${formData.get("start_time") || "00:00"}:00`).toISOString(),
            end_at: new Date(`${formData.get("end_date") || formData.get("start_date")}T${formData.get("end_time") || formData.get("start_time") || "00:00"}:00`).toISOString(),
            location: formData.get("location") || "",
          };

          if (!payload.title) {
            console.error("Event title is required.");
            return;
          }

          try {
            await window.CalendarService.addCalendarEvent(payload);
            root.innerHTML = "";
            await refreshEvents();
          } catch (error) {
            console.error("Unable to save calendar event.", error);
          }
        });
      }
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
        state.date = new Date(year, month - 1, 1);
        renderCalendar();
      }
    });
  }

  async function init() {
    bindEvents();
    await refreshEvents();
    if (window.CalendarService && typeof window.CalendarService.subscribe === "function") {
      state.stopRealtime = await window.CalendarService.subscribe(() => refreshEvents());
    }
  }

  init();
})();
