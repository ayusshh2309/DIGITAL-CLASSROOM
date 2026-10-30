(() => {
  const LIVE_CLASS_FIELDS = [
    "id",
    "teacher_id",
    "title",
    "class_grade",
    "subject",
    "topic",
    "grade",
    "stream",
    "subject_id",
    "description",
    "chapter",
    "class_date",
    "start_time",
    "end_time",
    "start_at",
    "end_at",
    "duration_minutes",
    "meeting_platform",
    "status",
    "publication_status",
    "created_at",
    "updated_at",
    "subjects(id, name)",
  ].join(", ");

  const normalizeStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (["attended", "completed", "done", "finished"].includes(normalized)) return "Completed";
    if (["live", "live now", "in_progress", "in progress", "ongoing"].includes(normalized)) return "Live";
    if (normalized === "missed") return "Missed";
    if (["cancelled", "canceled"].includes(normalized)) return "Cancelled";
    return "Scheduled";
  };

  const now = () => new Date().toISOString();

  const normalize = (item = {}) => {
    const subjectRelation = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
    const startValue = item.start_at ||
      (item.class_date && item.start_time ? `${item.class_date}T${item.start_time}` : null);
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

    const identityCandidates = [teacher.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const { data, error } = await client
        .from("live_classes")
        .select(LIVE_CLASS_FIELDS)
        .eq("teacher_id", teacherId)
        .order("class_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (!error) {
        return (data || []).map((item) => normalize(item)).filter((item) => identityCandidates.includes(item.teacher_id));
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
      class_grade: String(record.grade ?? ""),
      stream: record.stream || null,
      subject_id: subjectId,
      subject: record.subject_name || record.subject || "",
      title: record.title,
      chapter: record.chapter || null,
      topic: record.topic || record.title,
      description: record.description || null,
      class_date: record.class_date || (record.start_at ? new Date(record.start_at).toISOString().slice(0, 10) : null),
      start_time: record.start_time || (record.start_at ? new Date(record.start_at).toISOString().slice(11, 16) : null),
      end_time: record.end_time || null,
      duration_minutes: Number(record.duration_minutes || 60),
      meeting_platform: record.meeting_platform || null,
      meeting_url: record.meeting_url || "",
      status: "scheduled",
      publication_status: record.publication_status || "published",
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  async function schedule(input) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !teacher) {
      throw new Error("No authenticated teacher was found for this live class.");
    }

    const identityCandidates = [teacher.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const record = normalize({ ...input, teacher_id: teacherId, status: "Scheduled", created_at: now() });
      const payload = buildInsertPayload(record);
      const { data, error } = await client
        .from("live_classes")
        .insert(payload)
        .select(LIVE_CLASS_FIELDS)
        .single();
      if (!error) return normalize(data || payload);
      if (!/column .* does not exist|Unknown column|does not exist|invalid input syntax|not null|violates|foreign key/i.test(error.message || "")) {
        throw error;
      }
    }

    throw new Error("Could not save the live class. Please verify the live_classes schema and teacher permissions.");
  }

  async function updateStatus(id, nextStatus, allowedStatuses) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !user) {
      throw Object.assign(new Error("Authentication is required."), { code: "AUTH_REQUIRED" });
    }
    if (!teacher) {
      throw Object.assign(new Error("Teacher profile could not be found."), { code: "TEACHER_UNAVAILABLE" });
    }
    if (id === null || id === undefined || String(id).trim() === "") {
      throw new Error("A live class ID is required.");
    }

    const identityCandidates = [teacher.id].filter(Boolean);
    for (const teacherId of identityCandidates) {
      const { data: liveClass, error: lookupError } = await client
        .from("live_classes")
        .select("status")
        .eq("id", id)
        .eq("teacher_id", teacherId)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (!liveClass) continue;

      const currentStatus = String(liveClass.status || "").trim().toLowerCase();
      if (!allowedStatuses.includes(currentStatus)) {
        const invalidTransition = new Error(`This class cannot be changed from ${normalizeStatus(currentStatus)} to ${nextStatus}.`);
        invalidTransition.code = "INVALID_CLASS_TRANSITION";
        throw invalidTransition;
      }

      const { data, error } = await client
        .from("live_classes")
        .update({ status: nextStatus, updated_at: now() })
        .eq("id", id)
        .eq("teacher_id", teacherId)
        .eq("status", liveClass.status)
        .select(LIVE_CLASS_FIELDS)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        const changedError = new Error("This live class changed before the update could be saved. Refresh and try again.");
        changedError.code = "LIVE_CLASS_CHANGED";
        throw changedError;
      }
      return normalize(data);
    }

    const notFoundError = new Error("Live class not found or you do not have permission to update it.");
    notFoundError.code = "LIVE_CLASS_NOT_FOUND";
    throw notFoundError;
  }

  async function startClass(id) {
    return updateStatus(id, "live", ["scheduled"]);
  }

  async function endClass(id) {
    return updateStatus(id, "completed", ["live"]);
  }

  async function publishClass(id) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !user || !teacher) {
      throw Object.assign(new Error("An authenticated teacher account is required."), {
        code: "AUTH_REQUIRED",
      });
    }

    const { data: liveClass, error: lookupError } = await client
      .from("live_classes")
      .select("publication_status")
      .eq("id", id)
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!liveClass) throw new Error("Live class not found or access denied.");
    if (liveClass.publication_status !== "draft") {
      throw new Error("Only draft classes can be published.");
    }

    const { data, error } = await client
      .from("live_classes")
      .update({ publication_status: "published", updated_at: now() })
      .eq("id", id)
      .eq("teacher_id", teacher.id)
      .eq("publication_status", "draft")
      .select(LIVE_CLASS_FIELDS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The draft changed before it could be published. Refresh and try again.");
    return normalize(data);
  }

  async function cancelClass(id) {
    return updateStatus(id, "cancelled", ["scheduled", "live"]);
  }

  async function rescheduleClass(id, schedule) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !user || !teacher) {
      throw Object.assign(new Error("An authenticated teacher account is required."), {
        code: "AUTH_REQUIRED",
      });
    }

    const classDate = String(schedule?.class_date || "");
    const startTime = String(schedule?.start_time || "");
    const endTime = String(schedule?.end_time || "");
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(classDate)
      ? new Date(`${classDate}T00:00:00.000Z`)
      : null;
    if (
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== classDate ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      endTime <= startTime
    ) {
      throw new Error("Choose a valid date, start time, and later end time.");
    }

    const { data: current, error: lookupError } = await client
      .from("live_classes")
      .select("status, publication_status")
      .eq("id", id)
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!current) throw new Error("Live class not found or access denied.");
    if (current.publication_status !== "published" || current.status !== "scheduled") {
      throw new Error("Only published, scheduled classes can be rescheduled.");
    }

    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const durationMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
    const { data, error } = await client
      .from("live_classes")
      .update({
        class_date: classDate,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        updated_at: now(),
      })
      .eq("id", id)
      .eq("teacher_id", teacher.id)
      .eq("status", "scheduled")
      .eq("publication_status", "published")
      .select(LIVE_CLASS_FIELDS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The class changed before the new schedule was saved. Refresh and retry.");
    return normalize(data);
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

  async function getMeetingUrl(liveClassId) {
    const { client, user, teacher } = await getTeacherContext();
    if (!client || !user || !teacher) {
      throw Object.assign(new Error("An authenticated teacher account is required."), {
        code: "AUTH_REQUIRED",
      });
    }
    const { data, error } = await client.rpc("get_teacher_live_class_meeting_url", {
      requested_class_id: liveClassId,
    });
    if (error) throw error;
    return data;
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
          table: "live_class_updates",
          filter: `teacher_id=eq.${teacher.id}`,
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
    startClass,
    endClass,
    publishClass,
    cancelClass,
    rescheduleClass,
    deleteLiveClass,
    getMeetingUrl,
    subscribe,
    normalize,
  };
})();
