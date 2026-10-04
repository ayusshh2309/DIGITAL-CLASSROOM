(() => {
  const normalizeStream = (value) => {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[()\s/-]+/g, "_")
      .replace(/_+/g, "_");
    if (normalized === "arts" || normalized === "humanities" || normalized === "arts_humanities") {
      return "arts_humanities";
    }
    return normalized;
  };

  async function getAuthenticatedUser(client) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user?.id) {
      const authError = new Error("Sign in to view your registered curriculum.");
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }
    return data.user;
  }

  async function loadSubjectsForStudent(client, user, student) {
    if (!student || student.user_id !== user.id) {
      throw new Error("No student profile is linked to this account.");
    }
    const grade = Number(student.grade);
    if (!Number.isInteger(grade) || grade < 5 || grade > 12) {
      throw new Error("Your student profile does not have a valid registered grade.");
    }
    const stream = normalizeStream(student.stream);
    if (grade >= 11 && !stream) {
      throw new Error("Your registered Grade 11 or 12 profile is missing its stream.");
    }

    let query = client
      .from("subjects")
      .select("id, name, grades, streams")
      .contains("grades", [grade]);
    if (grade >= 11) query = query.contains("streams", [stream]);

    console.info("[Student Curriculum] Querying registered subjects", {
      userId: user.id,
      grade,
      stream,
      query: {
        table: "subjects",
        gradesContains: [grade],
        ...(grade >= 11 ? { streamsContains: [stream] } : {}),
      },
    });

    const { data, error } = await query;
    if (error) {
      console.error("[Student Curriculum] Subject query failed.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }

    const subjectById = new Map();
    const nameKeys = new Set();
    for (const subject of data || []) {
      const name = String(subject.name || "").trim();
      if (subject.id == null || !name) continue;
      const nameKey = name.toLowerCase();
      if (subjectById.has(String(subject.id)) || nameKeys.has(nameKey)) continue;
      subjectById.set(String(subject.id), { id: subject.id, name });
      nameKeys.add(nameKey);
    }
    const subjects = [...subjectById.values()];
    console.info("[Student Curriculum] Returned subject records", {
      records: subjects,
      count: subjects.length,
    });
    return { user, student, grade, stream, subjects };
  }

  async function loadCurrentStudent(client) {
    const user = await getAuthenticatedUser(client);
    const { data: student, error } = await client
      .from("students")
      .select("id, user_id, grade, stream")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return loadSubjectsForStudent(client, user, student);
  }

  async function loadForStudent(client, student) {
    const user = await getAuthenticatedUser(client);
    return loadSubjectsForStudent(client, user, student);
  }

  window.StudentCurriculum = { loadCurrentStudent, loadForStudent, normalizeStream };
})();
