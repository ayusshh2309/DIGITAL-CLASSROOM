(() => {
  const STORAGE_KEY = "smartLearningLiveClasses";
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  const readLocal = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const writeLocal = (records) => localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  const now = () => new Date().toISOString();
  const teacherId = () => window.AttendanceService?.teacherId?.() || "local-teacher";

  const normalize = (item) => {
    const start = item.start_at || item.start_time || item.scheduled_at || item.datetime;
    const startDate = start ? new Date(start) : null;
    const attended = Boolean(item.attended_at) || ["attended", "completed", "previous"].includes(String(item.status || "").toLowerCase());
    return {
      ...item,
      id: String(item.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      teacher_id: String(item.teacher_id || teacherId()),
      title: item.title || item.topic || "Live class",
      class_grade: String(item.class_grade || item.grade || item.class || ""),
      subject: item.subject || "",
      topic: item.topic || item.description || "",
      start_at: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
      status: attended ? "Attended" : "Scheduled",
      attended_at: item.attended_at || null,
      created_at: item.created_at || now(),
    };
  };

  const isVisible = (item, reference = Date.now()) => {
    const start = new Date(item.start_at).getTime();
    return Number.isFinite(start) && reference < start + WINDOW_MS;
  };

  async function clientAndUser() {
    const client = window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.();
    if (!client) return { client: null, user: null };
    const { data } = await client.auth.getUser();
    return { client, user: data?.user || null };
  }

  async function load() {
    const { client, user } = await clientAndUser();
    if (client && user) {
      const { data, error } = await client.from("live_classes").select("*").eq("teacher_id", user.id).order("start_at", { ascending: true });
      if (!error) return (data || []).map(normalize).filter(isVisible);
      console.warn("Could not load live classes from Supabase:", error.message);
    }
    return readLocal().map(normalize).filter((item) => item.teacher_id === teacherId() && isVisible(item));
  }

  async function schedule(input) {
    const record = normalize({ ...input, teacher_id: teacherId(), status: "Scheduled", created_at: now() });
    const { client, user } = await clientAndUser();
    if (client && user) {
      const payload = {
        teacher_id: user.id,
        title: record.title,
        class_grade: record.class_grade,
        subject: record.subject,
        topic: record.topic,
        start_at: record.start_at,
        status: record.status,
        attended_at: record.attended_at,
        created_at: record.created_at,
      };
      const { data, error } = await client.from("live_classes").insert(payload).select().single();
      if (!error) return normalize(data);
      console.warn("Could not save live class to Supabase; using local storage:", error.message);
    }
    const records = readLocal().filter((item) => item.id !== record.id);
    writeLocal([record, ...records]);
    window.dispatchEvent(new CustomEvent("smart-learning-live-classes-updated"));
    return record;
  }

  async function markAttended(id) {
    const attendedAt = now();
    const { client, user } = await clientAndUser();
    if (client && user) {
      const { data, error } = await client.from("live_classes").update({ status: "Attended", attended_at: attendedAt }).eq("id", id).eq("teacher_id", user.id).select().single();
      if (!error) return normalize(data);
      console.warn("Could not mark live class attended in Supabase:", error.message);
    }
    const records = readLocal().map((item) => item.id === id ? { ...item, status: "Attended", attended_at: attendedAt } : item);
    writeLocal(records);
    window.dispatchEvent(new CustomEvent("smart-learning-live-classes-updated"));
    return normalize(records.find((item) => item.id === id) || {});
  }

  function subscribe(onChange) {
    const handler = () => onChange();
    window.addEventListener("smart-learning-live-classes-updated", handler);
    window.addEventListener("storage", handler);
    let channel = null;
    clientAndUser().then(({ client, user }) => {
      if (!client || !user) return;
      channel = client.channel(`live-classes-${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "live_classes", filter: `teacher_id=eq.${user.id}` }, handler).subscribe();
    });
    return () => {
      window.removeEventListener("smart-learning-live-classes-updated", handler);
      window.removeEventListener("storage", handler);
      if (channel) window.TeacherData?.getSupabaseClient?.()?.removeChannel(channel);
    };
  }

  window.LiveClassService = { load, schedule, markAttended, subscribe, isVisible, WINDOW_MS };
})();
