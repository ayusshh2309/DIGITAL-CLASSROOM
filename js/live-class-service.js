(() => {
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  const normalizeStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (["attended", "completed", "done", "finished"].includes(normalized)) return "Attended";
    if (["live", "in_progress", "in progress", "ongoing"].includes(normalized)) return "Live";
    if (["cancelled", "canceled"].includes(normalized)) return "Cancelled";
    return "Scheduled";
  };

  const now = () => new Date().toISOString();

  const normalize = (item = {}) => {
    const startValue =
      item.start_at ||
      item.start_time ||
      item.class_date && item.start_time ? `${item.class_date}T${item.start_time}` : null;
    const startDate = startValue ? new Date(startValue) : null;
    const gradeValue = item.grade ?? item.class_grade ?? item.classId ?? "";
    const durationMinutes = Number(item.duration_minutes ?? item.duration ?? item.durationMinutes ?? 60) || 60;
    const title = item.title || item.class_title || item.topic || "Live class";
    const subject = item.subject || item.subject_name || item.subjectName || "";
    const meetingUrl = item.meeting_url || item.meetingLink || item.link || "";
    const teacherId = String(item.teacher_id || "");

    return {
      ...item,
      id: String(item.id || `live-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      teacher_id: teacherId,
      title,
      grade: gradeValue === "" ? "" : String(gradeValue),
      class_grade: String(item.class_grade ?? gradeValue ?? ""),
      stream: String(item.stream || item.class_stream || ""),
      subject,
      topic: item.topic || item.description || item.chapter || "",
      meeting_url: meetingUrl,
      start_at: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
      duration_minutes: durationMinutes,
      status: normalizeStatus(item.status),
      created_at: item.created_at || now(),
    };
  };

  const isVisible = (item, reference = Date.now()) => {
    if (!item || !item.start_at) return false;
    const start = new Date(item.start_at).getTime();
    return Number.isFinite(start) && reference < start + WINDOW_MS;
  };

  async function getTeacherContext() {
    const client = window.SmartLearningSupabase?.getClient?.() || window.TeacherData?.getSupabaseClient?.();
    if (!client) return { client: null, user: null, teacher: null };

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData?.user) {
      return { client, user: null, teacher: null };
    }

    try {
      const teacherProfile = await window.TeacherData?.loadCurrentTeacherProfile?.();
      if (teacherProfile?.profile) {
        return { client, user: authData.user, teacher: teacherProfile.profile };
      }
    } catch (error) {
      console.warn("Unable to resolve current teacher profile for live classes.", error);
    }

    const { data: teacherData, error: teacherError } = await client
      .from("teachers")
      .select("id, user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (teacherError) {
      console.warn("Could not resolve teacher row for live classes.", teacherError.message);
      return { client, user: authData.user, teacher: null };
    }

    return { client, user: authData.user, teacher: teacherData };
  }

  async function load() {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !teacher) return [];

    const identityCandidates = [teacher.id, user?.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const { data, error } = await client
        .from("live_classes")
        .select("*")
        .eq("teacher_id", teacherId)
        .order("class_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (!error) {
        return (data || []).map((item) => normalize(item)).filter((item) => identityCandidates.includes(item.teacher_id) && isVisible(item));
      }

      const message = String(error.message || "");
      if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates/i.test(message)) {
        console.warn("Could not load live classes from Supabase:", error.message);
        return [];
      }
    }

    return [];
  }

  function buildInsertAttempts(record) {
    const createdAt = now();
    const modern = {
      teacher_id: record.teacher_id,
      grade: Number(record.grade ?? 0) || null,
      stream: record.stream || null,
      subject_id: record.subject_id || null,
      subject: record.subject || record.title || "",
      title: record.title,
      chapter: record.chapter || null,
      topic: record.topic || record.title,
      description: record.description || null,
      class_date: record.class_date || (record.start_at ? new Date(record.start_at).toISOString().slice(0, 10) : null),
      start_time: record.start_time || (record.start_at ? new Date(record.start_at).toISOString().slice(11, 16) : null),
      duration_minutes: Number(record.duration_minutes || 60),
      meeting_url: record.meeting_url || "",
      status: "scheduled",
      created_at: createdAt,
      updated_at: createdAt,
    };

    const legacy = {
      teacher_id: record.teacher_id,
      title: record.title,
      class_grade: String(record.grade || record.class_grade || ""),
      subject: record.subject || record.title || "",
      topic: record.topic || record.description || record.title || "",
      description: record.description || null,
      start_at: record.start_at || record.class_date || new Date().toISOString(),
      duration_minutes: Number(record.duration_minutes || 60),
      meeting_url: record.meeting_url || "",
      status: "Scheduled",
      created_at: createdAt,
      updated_at: createdAt,
    };

    return [modern, legacy];
  }

  async function schedule(input) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !teacher) {
      throw new Error("No authenticated teacher was found for this live class.");
    }

    const identityCandidates = [teacher.id, user?.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const record = normalize({ ...input, teacher_id: teacherId, status: "Scheduled", created_at: now() });
      const attempts = buildInsertAttempts(record);

      for (const payload of attempts) {
        try {
          const { data, error } = await client.from("live_classes").insert(payload).select().single();
          if (!error) return normalize(data || payload);
          const message = String(error.message || "");
          if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|foreign key/i.test(message)) {
            throw error;
          }
        } catch (error) {
          const message = String(error?.message || "");
          if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|foreign key/i.test(message)) {
            throw error;
          }
        }
      }
    }

    throw new Error("Could not save the live class. Please verify the live_classes schema and teacher permissions.");
  }

  async function markAttended(id) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !teacher) return null;

    const identityCandidates = [teacher.id, user?.id].filter(Boolean);
    const attemptedStatuses = ["completed", "Attended"];

    for (const teacherId of identityCandidates) {
      for (const status of attemptedStatuses) {
        try {
          const { data, error } = await client
            .from("live_classes")
            .update({ status, attended_at: now() })
            .eq("id", id)
            .eq("teacher_id", teacherId)
            .select()
            .single();

          if (!error) return normalize(data || {});
          const message = String(error.message || "");
          if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|status/i.test(message)) {
            throw error;
          }
        } catch (error) {
          const message = String(error?.message || "");
          if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|status/i.test(message)) {
            throw error;
          }
        }
      }
    }

    return null;
  }

  function subscribe(onChange) {
    const handler = () => onChange();
    window.addEventListener("smart-learning-live-classes-updated", handler);
    window.addEventListener("storage", handler);

    let channel = null;
    getTeacherContext().then(({ client, teacher }) => {
      if (!client || !teacher) return;
      channel = client
        .channel(`live-classes-${teacher.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "live_classes",
          filter: `teacher_id=eq.${teacher.id}`,
        }, handler)
        .subscribe();
    });

    return () => {
      window.removeEventListener("smart-learning-live-classes-updated", handler);
      window.removeEventListener("storage", handler);
      if (channel) {
        window.TeacherData?.getSupabaseClient?.()?.removeChannel(channel);
      }
    };
  }

  window.LiveClassService = {
    load,
    schedule,
    markAttended,
    subscribe,
    isVisible,
    WINDOW_MS,
    normalize,
  };
})();
