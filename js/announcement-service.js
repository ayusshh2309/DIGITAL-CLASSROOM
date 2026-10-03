(() => {
  const TYPES = ["Exam", "Material", "Reminder", "Assignment", "Notice"];
  const STATUSES = ["draft", "scheduled", "published", "archived"];
  const ANNOUNCEMENT_FIELDS = "id, teacher_id, title, message, type, grade, stream, subject_id, status, publish_at, published_at, created_at, updated_at";

  function getClient() {
    const client = window.TeacherData?.getSupabaseClient?.()
      || window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  async function getTeacherContext() {
    const client = getClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) {
      console.error("Announcements auth error:", authError);
      throw authError;
    }
    const user = authData?.user;
    console.log("Announcement auth user:", user?.id);
    if (!user) throw new Error("Your session has expired. Please sign in again.");

    const { data: teacher, error: teacherError } = await client
      .from("teachers")
      .select("id, user_id")
      .eq("user_id", user.id)
      .single();
    if (teacherError) {
      console.error("Announcements teacher error:", teacherError);
      throw teacherError;
    }
    if (!teacher?.id || String(teacher.user_id) !== String(user.id)) {
      throw new Error("No teacher profile is linked to this account.");
    }
    console.log("Announcement teacher ID:", teacher.id);
    return { client, user, teacher };
  }

  async function loadScope(context) {
    const groups = await window.TeacherData.loadRegisteredTeachingScope(
      context.client,
      context.teacher.id,
    );
    return groups.map((group) => ({
      ...group,
      grade: Number(group.grade),
      stream: Number(group.grade) >= 11 ? String(group.stream || "").trim().toLowerCase() : null,
      subjects: Array.isArray(group.subjects) ? group.subjects : [],
    }));
  }

  async function loadAnnouncements(context) {
    const { data, error } = await context.client
      .from("announcements")
      .select(ANNOUNCEMENT_FIELDS)
      .eq("teacher_id", context.teacher.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Announcements query error:", error);
      throw error;
    }

    const announcements = data || [];
    const subjectIds = [...new Set(announcements.map((item) => item.subject_id).filter(Boolean).map(String))];
    let subjectsById = new Map();
    if (subjectIds.length) {
      const { data: subjects, error: subjectsError } = await context.client
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);
      if (subjectsError) {
        console.error("Announcements subject query error:", subjectsError);
      } else {
        subjectsById = new Map((subjects || []).map((subject) => [String(subject.id), subject.name]));
      }
    }

    const publishedIds = announcements
      .filter((item) => item.status === "published")
      .map((item) => item.id);
    let recipientsByAnnouncement = new Map();
    let recipientsAvailable = true;
    if (publishedIds.length) {
      const { data: recipients, error: recipientsError } = await context.client
        .from("announcement_recipients")
        .select("id, announcement_id, student_id, read_at, created_at")
        .in("announcement_id", publishedIds);
      if (recipientsError) {
        console.error("Announcements recipient statistics error:", recipientsError);
        recipientsAvailable = false;
      } else {
        (recipients || []).forEach((recipient) => {
          const key = String(recipient.announcement_id);
          if (!recipientsByAnnouncement.has(key)) recipientsByAnnouncement.set(key, []);
          recipientsByAnnouncement.get(key).push(recipient);
        });
      }
    }

    return {
      announcements: announcements.map((item) => ({
        ...item,
        grade: Number(item.grade),
        stream: Number(item.grade) >= 11 ? String(item.stream || "").trim().toLowerCase() : null,
        status: String(item.status || "").toLowerCase(),
        subject: item.subject_id ? subjectsById.get(String(item.subject_id)) || "" : "",
        recipients: recipientsByAnnouncement.get(String(item.id)) || [],
      })),
      recipientsAvailable,
    };
  }

  function normalizeClass(grade, stream) {
    const value = Number(grade);
    if (!Number.isInteger(value) || value < 1 || value > 12) {
      throw new Error("Choose a registered class.");
    }
    return {
      grade: value,
      stream: value >= 11 ? String(stream || "").trim().toLowerCase() : null,
    };
  }

  function findGroup(groups, grade, stream) {
    const target = normalizeClass(grade, stream);
    return groups.find((group) => Number(group.grade) === target.grade
      && (target.grade < 11 || String(group.stream || "").toLowerCase() === target.stream));
  }

  function validateScope(groups, input) {
    const target = normalizeClass(input.grade, input.stream);
    const group = findGroup(groups, target.grade, target.stream);
    if (!group) throw new Error("This class and stream are not in your registered teaching scope.");
    const subjectId = input.subject_id || null;
    if (subjectId && !group.subjects.some((subject) => String(subject.id) === String(subjectId))) {
      throw new Error("This subject is not in your registered teaching scope for the selected class.");
    }
    return { ...target, subjectId };
  }

  async function createRecipients(context, announcement) {
    let query = context.client
      .from("students")
      .select("id")
      .eq("grade", announcement.grade);
    query = announcement.grade >= 11
      ? query.eq("stream", announcement.stream)
      : query.is("stream", null);
    const { data: students, error: studentsError } = await query;
    if (studentsError) throw studentsError;
    if (!students?.length) return;

    const { data: existing, error: existingError } = await context.client
      .from("announcement_recipients")
      .select("student_id")
      .eq("announcement_id", announcement.id)
      .in("student_id", students.map((student) => student.id));
    if (existingError) throw existingError;
    const existingIds = new Set((existing || []).map((row) => String(row.student_id)));
    const rows = students
      .filter((student) => !existingIds.has(String(student.id)))
      .map((student) => ({ announcement_id: announcement.id, student_id: student.id }));
    for (let index = 0; index < rows.length; index += 500) {
      const { error } = await context.client
        .from("announcement_recipients")
        .upsert(rows.slice(index, index + 500), {
          onConflict: "announcement_id,student_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    }
  }

  async function saveAnnouncement(groups, input, existing = null) {
    const context = await getTeacherContext();
    const scope = validateScope(groups, input);
    const status = String(input.status || "").toLowerCase();
    if (!STATUSES.includes(status)) throw new Error("Choose a valid announcement status.");
    if (!TYPES.includes(input.type)) throw new Error("Choose a valid announcement type.");

    const now = new Date().toISOString();
    let publishAt = null;
    if (status === "scheduled") {
      const date = new Date(input.publish_at);
      if (!input.publish_at || Number.isNaN(date.getTime()) || date <= new Date()) {
        throw new Error("Choose a future date and time for the scheduled announcement.");
      }
      publishAt = date.toISOString();
    }
    const payload = {
      teacher_id: context.teacher.id,
      title: String(input.title || "").trim(),
      message: String(input.message || "").trim(),
      type: input.type,
      grade: scope.grade,
      stream: scope.stream,
      subject_id: scope.subjectId,
      status,
      publish_at: publishAt,
      published_at: status === "published"
        ? existing?.published_at || now
        : null,
      updated_at: now,
    };
    if (!payload.title || !payload.message) throw new Error("Title and message are required.");

    let query = existing?.id
      ? context.client.from("announcements").update(payload)
        .eq("id", existing.id).eq("teacher_id", context.teacher.id)
      : context.client.from("announcements").insert(payload);
    const { data: announcement, error } = await query
      .select(ANNOUNCEMENT_FIELDS)
      .single();
    if (error) {
      console.error("Announcements save error:", error);
      throw error;
    }
    if (status === "published") {
      try {
        await createRecipients(context, announcement);
      } catch (recipientError) {
        console.error("Announcement was saved but recipients could not be assigned.", recipientError);
        throw new Error(`Announcement was saved, but recipients could not be assigned: ${recipientError.message}`);
      }
    }
    return announcement;
  }

  async function createAnnouncement(input) {
    const context = await getTeacherContext();
    const scope = validateScope(input.groups, input);
    const status = String(input.status || "").toLowerCase();
    if (!["draft", "scheduled", "published"].includes(status)) {
      throw new Error("Choose a valid publishing option.");
    }
    if (!TYPES.includes(input.type)) throw new Error("Choose a valid announcement type.");

    const title = String(input.title || "").trim();
    const message = String(input.message || "").trim();
    if (!title || title.length > 160) throw new Error("Title must be between 1 and 160 characters.");
    if (!message || message.length > 5000) throw new Error("Message must be between 1 and 5,000 characters.");
    if (!scope.subjectId) throw new Error("Choose a subject for this announcement.");

    let publishAt = null;
    if (status === "scheduled") {
      const scheduledDate = new Date(input.publish_at);
      if (!input.publish_at || Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        throw new Error("Choose a future date and time.");
      }
      publishAt = scheduledDate.toISOString();
    }

    const { data, error } = await context.client.rpc("create_teacher_announcement", {
      p_title: title,
      p_message: message,
      p_type: input.type,
      p_grade: scope.grade,
      p_stream: scope.stream,
      p_subject_id: scope.subjectId,
      p_status: status,
      p_publish_at: publishAt,
    });
    if (error) {
      console.error("Announcement creation error:", error);
      throw error;
    }
    const announcement = Array.isArray(data) ? data[0] : data;
    if (!announcement?.id) throw new Error("The announcement was not returned after saving.");
    return announcement;
  }

  async function deleteAnnouncement(id) {
    const context = await getTeacherContext();
    const { error } = await context.client.rpc("delete_teacher_announcement", {
      requested_announcement_id: id,
    });
    if (error) throw error;
  }

  function subscribe(context, onChange, onError) {
    const channel = context.client
      .channel(`teacher-announcements-${context.teacher.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "announcements",
        filter: `teacher_id=eq.${context.teacher.id}`,
      }, onChange)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "announcement_recipients",
      }, onChange)
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Announcements realtime subscription error:", error || status);
          onError?.(error || new Error(status));
        }
      });
    return () => context.client.removeChannel(channel);
  }

  window.AnnouncementService = {
    TYPES,
    getTeacherContext,
    loadScope,
    loadAnnouncements,
    saveAnnouncement,
    createAnnouncement,
    deleteAnnouncement,
    subscribe,
  };
})();
