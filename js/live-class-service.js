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
    const subjectRelation = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
    const startValue =
      item.start_at ||
      item.start_time ||
      item.class_date && item.start_time ? `${item.class_date}T${item.start_time}` : null;
    const startDate = startValue ? new Date(startValue) : null;
    const gradeValue = item.grade ?? item.class_grade ?? item.classId ?? "";
    const durationMinutes = Number(item.duration_minutes ?? item.duration ?? item.durationMinutes ?? 60) || 60;
    const title = item.title || item.class_title || item.topic || "Live class";
    const subject = subjectRelation?.name || item.subject_name || item.subjectName || "";
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
      subject_name: subject,
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
        .select("*, subjects(id, name)")
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

  function buildInsertPayload(record) {
    const createdAt = now();
    const subjectId = record.subject_id;
    if (subjectId === null || subjectId === undefined || String(subjectId).trim() === "") {
      throw new Error("A registered subject ID is required to schedule a live class.");
    }

    return {
      teacher_id: record.teacher_id,
      grade: Number(record.grade ?? 0) || null,
      stream: record.stream || null,
      subject_id: subjectId,
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
  }

  async function schedule(input) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !teacher) {
      throw new Error("No authenticated teacher was found for this live class.");
    }

    const identityCandidates = [teacher.id, user?.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const record = normalize({ ...input, teacher_id: teacherId, status: "Scheduled", created_at: now() });
      const payload = buildInsertPayload(record);
      const { data, error } = await client
        .from("live_classes")
        .insert(payload)
        .select("*, subjects(id, name)")
        .single();
      if (!error) return normalize(data || payload);
      if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|foreign key/i.test(error.message || "")) {
        throw error;
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
      const { data: liveClass, error: lookupError } = await client
        .from("live_classes")
        .select("class_date, start_time, duration_minutes")
        .eq("id", id)
        .eq("teacher_id", teacherId)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (!liveClass) continue;

      const startsAt = liveClass.class_date && liveClass.start_time
        ? new Date(`${liveClass.class_date}T${liveClass.start_time}`)
        : null;
      if (!startsAt || Number.isNaN(startsAt.getTime())) {
        throw new Error("The scheduled start time for this class could not be determined.");
      }

      const durationMinutes = Number(liveClass.duration_minutes) || 60;
      const endsAt = startsAt.getTime() + durationMinutes * 60_000;
      if (Date.now() < endsAt) {
        const classNotFinishedError = new Error(
          "Please take the class first. You can mark attendance after the scheduled class duration has ended.",
        );
        classNotFinishedError.code = "CLASS_NOT_FINISHED";
        throw classNotFinishedError;
      }

      for (const status of attemptedStatuses) {
        try {
          const { data, error } = await client
            .from("live_classes")
            .update({ status, attended_at: now() })
            .eq("id", id)
            .eq("teacher_id", teacherId)
            .select("*, subjects(id, name)")
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

  async function deleteLiveClass(liveClassId) {
    if (liveClassId === null || liveClassId === undefined || String(liveClassId).trim() === "") {
      throw new Error("A live class ID is required for deletion.");
    }
    const client = window.SmartLearningSupabase?.getClient?.() || window.TeacherData?.getSupabaseClient?.();
    if (!client) throw new Error("Supabase is not configured.");

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user?.id) {
      const authenticationError = new Error("Authentication is required.");
      authenticationError.code = "AUTH_REQUIRED";
      throw authenticationError;
    }

    const { data: teacher, error: teacherError } = await client
      .from("teachers")
      .select("id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (teacherError) throw teacherError;
    if (!teacher?.id) {
      const profileError = new Error("Teacher profile could not be found.");
      profileError.code = "TEACHER_UNAVAILABLE";
      throw profileError;
    }

    const { data: liveClass, error: lookupError } = await client
      .from("live_classes")
      .select("id")
      .eq("id", liveClassId)
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!liveClass) {
      const notFoundError = new Error("Live class not found or you do not have permission to delete it.");
      notFoundError.code = "LIVE_CLASS_NOT_FOUND";
      throw notFoundError;
    }

    const { data: deletedClass, error: deleteError } = await client
      .from("live_classes")
      .delete()
      .eq("id", liveClass.id)
      .eq("teacher_id", teacher.id)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deletedClass) {
      const notDeletedError = new Error("Live class was not deleted. It may have already been removed.");
      notDeletedError.code = "LIVE_CLASS_NOT_DELETED";
      throw notDeletedError;
    }
    return deletedClass;
  }

  function subscribe(onChange, onError = () => {}) {
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
        }, handler)
        .subscribe((status, error) => {
          if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
            const realtimeError = error || new Error(`Live class realtime subscription failed: ${status}`);
            console.error("Live class realtime subscription failed.", realtimeError);
            onError(realtimeError);
          }
        });
    }).catch((error) => {
      console.error("Could not initialize live class realtime subscription.", error);
      onError(error);
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
    deleteLiveClass,
    subscribe,
    isVisible,
    WINDOW_MS,
    normalize,
  };
})();
