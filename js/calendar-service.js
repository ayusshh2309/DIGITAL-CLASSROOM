(() => {
  const SOURCES = [
    ["liveClasses", "live_classes", "Live Class"],
    ["smartLearningAnnouncements", "announcements", "Announcement"],
    ["teacherMaterials", "materials", "Material"],
    ["smartLearningDC_published_quizzes", "quizzes", "Assessment"],
    ["calendarEvents", "calendar_events", "Event"],
  ];
  const LOCAL_KEYS = ["calendarEvents", "smartLearningLiveClasses", "smartLearningAnnouncements", "teacherMaterials:"];
  const profile = () => window.StudentData?.getStudentProfile?.() || ["studentProfile", "studentData", "finalStudentRegistration"].map((key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }).find(Boolean) || {};
  const client = () => window.SmartLearningSupabase?.getClient?.() || null;
  const read = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  const grade = () => String(profile().grade || profile().class_grade || profile().classGrade || profile().class || "").replace(/^class\s+/i, "").trim();
  const stream = () => String(profile().stream || profile().classStream || "").trim();
  const subjects = () => { const values = profile().eligible_subjects || profile().subjects || profile().selectedSubjects || profile().academic?.subjects || []; return (Array.isArray(values) ? values : String(values).split(",")).map((value) => String(value).trim().toLowerCase()).filter(Boolean); };
  const userId = async () => { const supabase = client(); if (!supabase) return profile().student_id || profile().id || null; const { data } = await supabase.auth.getUser(); return data?.user?.id || null; };
  const dateValue = (item) => item.start_at || item.start_time || item.scheduled_at || item.exam_at || item.published_at || item.due_date || item.date || item.created_at;
  const endValue = (item, start) => item.end_at || item.end_time || item.deadline || item.due_date || (start ? new Date(new Date(start).getTime() + Number(item.duration_minutes || item.duration || 60) * 60000).toISOString() : start);
  const eligible = (item) => { const itemGrade = String(item.class_grade || item.grade || item.class || "").replace(/^class\s+/i, "").trim(); const itemStream = String(item.stream || item.class_stream || "").trim(); const itemSubject = String(item.subject || item.subject_name || "").trim().toLowerCase(); return (!grade() || !itemGrade || itemGrade === grade()) && (!itemStream || !stream() || itemStream.toLowerCase() === stream().toLowerCase()) && (!subjects().length || !itemSubject || subjects().includes(itemSubject)); };
  const normalize = (item, source, type) => { const start = dateValue(item) || new Date().toISOString(); const normalizedType = String(item.event_type || item.calendar_type || type || item.type || "event").toLowerCase().replace(/\s+/g, "_"); return { ...item, id: `${source}-${item.id || item.material_id || item.assignment_id || item.quiz_id || item.announcement_id || item.title || start}`, source, source_id: String(item.id || item.material_id || item.assignment_id || item.quiz_id || item.announcement_id || ""), type: normalizedType, title: item.title || item.name || item.topic || item.assessment_name || item.class_title || "Academic event", description: item.description || item.instructions || item.message || item.content || item.topic || "", class_grade: String(item.class_grade || item.grade || item.class || ""), stream: item.stream || item.class_stream || "", subject: item.subject || item.subject_name || "", start_at: new Date(start).toISOString(), end_at: new Date(endValue(item, start) || start).toISOString(), status: item.status || "scheduled", teacher_name: item.teacher_name || item.teacher || "", location: item.meeting_url || item.join_url || item.location || item.external_url || item.file_url || "", file_url: item.file_url || item.external_url || "", duration_minutes: Number(item.duration_minutes || item.duration || item.time_limit || 0) || null, question_count: item.question_count || item.questions_count || null, original_start_at: item.original_start_at || item.previous_start_at || null }; };
  const localRows = () => LOCAL_KEYS.flatMap((key) => key.endsWith(":") ? Object.keys(localStorage).filter((storedKey) => storedKey.startsWith(key)).flatMap((storedKey) => read(storedKey)) : read(key)).map((item) => normalize(item, "local", item.event_type || item.type || "event")).filter(eligible);
  const queryTable = async (supabase, table, type, user) => { try { const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false }); if (error) return []; return (data || []).filter(eligible).map((item) => normalize(item, table, type)); } catch { return []; } };

  async function loadEvents() {
    const supabase = client();
    const user = await userId();
    if (!supabase || !user) return dedupe(localRows());
    try {
      const rpc = await supabase.rpc("get_student_calendar_events", { requested_student_id: user });
      if (!rpc.error && Array.isArray(rpc.data)) return dedupe(rpc.data.map((item) => normalize(item, item.source || "student_calendar", item.event_type || item.type)));
    } catch (error) { console.warn("Student calendar RPC unavailable:", error.message); }
    console.warn("Student calendar RPC unavailable; using synchronized local calendar data.");
    return dedupe(localRows());
  }

  function dedupe(events) { return Array.from(new Map(events.filter((event) => Number.isFinite(new Date(event.start_at).getTime())).map((event) => [event.id, event])).values()).sort((left, right) => new Date(left.start_at) - new Date(right.start_at)); }
  function registerClasses() { return grade() ? [grade()] : []; }
  function registerSubjects() { return subjects(); }
  function saveLocalEvent(input) { const rows = read("calendarEvents"); const event = { ...input, id: input.id || `local-${Date.now()}`, created_at: input.created_at || new Date().toISOString() }; localStorage.setItem("calendarEvents", JSON.stringify([event, ...rows.filter((row) => row.id !== event.id)])); window.dispatchEvent(new CustomEvent("smart-learning-calendar-updated")); return normalize(event, "local", event.type || "event"); }
  function deleteLocalEvent(id) { localStorage.setItem("calendarEvents", JSON.stringify(read("calendarEvents").filter((row) => row.id !== id))); window.dispatchEvent(new CustomEvent("smart-learning-calendar-updated")); }
  function subscribe(onChange) { const handler = () => onChange(); window.addEventListener("smart-learning-calendar-updated", handler); window.addEventListener("storage", handler); const supabase = client(); let channel; userId().then((user) => { if (!supabase || !user) return; channel = supabase.channel(`student-calendar-${user}`).on("postgres_changes", { event: "*", schema: "public" }, handler).subscribe(); }); return () => { window.removeEventListener("smart-learning-calendar-updated", handler); window.removeEventListener("storage", handler); if (channel && supabase) supabase.removeChannel(channel); }; }
  window.CalendarService = { loadEvents, registerClasses, registerSubjects, saveLocalEvent, deleteLocalEvent, subscribe, studentId: userId, eligible };
})();
