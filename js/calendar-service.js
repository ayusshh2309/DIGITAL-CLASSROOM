(() => {
  const SOURCES = [
    ["liveClasses", "live_classes", "Live Class"],
    ["smartLearningAnnouncements", "announcements", "Announcement"],
    ["teacherMaterials", "materials", "Material"],
    ["smartLearningDC_published_quizzes", "quizzes", "Assessment"],
    ["calendarEvents", "calendar_events", "Event"],
  ];
  const read = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const teacherId = () => window.AttendanceService?.teacherId?.() || "local-teacher";
  const classes = () => window.AttendanceService?.loadTeacherClasses?.() || [];
  const subjects = (grade) => window.AttendanceService?.loadTeacherSubjects?.(grade) || [];
  const client = () => window.SmartLearningSupabase?.getClient?.() || null;
  const dateOf = (item) => item.start_at || item.start_time || item.scheduled_at || item.published_at || item.due_date || item.date || item.created_at;
  const normalize = (item, source, type) => { const start = dateOf(item); return { id: `${source}-${item.id || item.announcement_id || item.title || Date.now()}`, source, source_id: String(item.id || item.announcement_id || ""), type: item.type || type, title: item.title || item.name || item.topic || item.assessment_name || "Untitled event", description: item.description || item.message || item.content || item.topic || "", class_grade: String(item.class_grade || item.grade || item.class || ""), subject: item.subject || item.subject_name || "", start_at: start || new Date().toISOString(), end_at: item.end_at || item.end_time || item.due_date || start || new Date().toISOString(), status: item.status || (item.published_at ? "Published" : "Scheduled"), location: item.location || item.meeting_url || item.join_url || "", attachment_url: item.file_url || item.url || item.attachment_url || "", teacher_id: String(item.teacher_id || teacherId()) }; };
  function localEvents() { return SOURCES.flatMap(([key, , type]) => read(key).map((item) => normalize(item, key, type))).filter((event) => event.teacher_id === teacherId() || !event.teacher_id || event.teacher_id === "local-teacher"); }
  async function loadEvents() { const supabase = client(); if (!supabase) return localEvents(); const results = await Promise.all(SOURCES.map(async ([, table, type]) => { const { data, error } = await supabase.from(table).select("*").eq("teacher_id", teacherId()); if (error) { console.warn(`Calendar source ${table} unavailable`, error.message); return []; } return (data || []).map((item) => normalize(item, table, type)); })); return results.flat(); }
  function registerClasses() { return classes(); }
  function registerSubjects(grade) { return subjects(grade); }
  function saveLocalEvent(input) { const records = read("calendarEvents"); const event = { ...input, id: input.id || `local-${Date.now()}`, teacher_id: teacherId(), created_at: input.created_at || new Date().toISOString() }; const next = [event, ...records.filter((item) => item.id !== event.id)]; localStorage.setItem("calendarEvents", JSON.stringify(next)); window.dispatchEvent(new CustomEvent("smart-learning-calendar-updated")); return normalize(event, "calendarEvents", "Event"); }
  function deleteLocalEvent(id) { localStorage.setItem("calendarEvents", JSON.stringify(read("calendarEvents").filter((item) => item.id !== id))); window.dispatchEvent(new CustomEvent("smart-learning-calendar-updated")); }
  function subscribe(onChange) { const supabase = client(); if (!supabase) { const handler = () => onChange(); window.addEventListener("smart-learning-calendar-updated", handler); window.addEventListener("storage", handler); return () => { window.removeEventListener("smart-learning-calendar-updated", handler); window.removeEventListener("storage", handler); }; } const channel = supabase.channel(`calendar-${teacherId()}`); SOURCES.forEach(([, table]) => channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `teacher_id=eq.${teacherId()}` }, onChange)); channel.subscribe(); return () => supabase.removeChannel(channel); }
  window.CalendarService = { loadEvents, registerClasses, registerSubjects, saveLocalEvent, deleteLocalEvent, subscribe, teacherId };
})();
