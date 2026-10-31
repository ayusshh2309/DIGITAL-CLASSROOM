(() => {
  const PAGE_SIZE = 1000;
  const normalizeStream = (value) => String(value ?? "").trim().toLowerCase();
  const classKey = (grade, stream) =>
    `${Number(grade)}|${Number(grade) >= 11 ? normalizeStream(stream) : ""}`;

  function getClient() {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  async function getUser(client = getClient()) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user?.id) {
      throw Object.assign(new Error("Sign in to continue."), {
        code: "AUTH_REQUIRED",
      });
    }
    return data.user;
  }

  async function readAll(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await createQuery()
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  function isEligible(subject, grade, stream) {
    const normalizedGrade = Number(grade);
    if (!Array.isArray(subject.grades) || !subject.grades.includes(normalizedGrade)) {
      return false;
    }
    if (normalizedGrade < 11) return true;
    return Boolean(
      stream &&
      Array.isArray(subject.streams) &&
      subject.streams.some((value) => normalizeStream(value) === normalizeStream(stream)),
    );
  }

  async function getEligibleSubjects(grade, stream = null, client = getClient()) {
    const normalizedGrade = Number(grade);
    if (!Number.isInteger(normalizedGrade) || normalizedGrade < 5 || normalizedGrade > 12) {
      throw new Error("Select a valid grade between 5 and 12.");
    }
    if (normalizedGrade >= 11 && !String(stream || "").trim()) {
      throw new Error("Select a stream for Grades 11 and 12.");
    }
    const { data, error } = await client.rpc("get_eligible_subjects", {
      requested_grade: normalizedGrade,
      requested_stream: normalizedGrade >= 11 ? String(stream).trim() : null,
    });
    if (error) throw error;
    return (data || [])
      .filter((subject) => subject.name)
      .map(({ id, name, grades, streams }) => ({ id, name, grades, streams }));
  }

  async function getAvailableStreams(grade, client = getClient()) {
    const normalizedGrade = Number(grade);
    if (!Number.isInteger(normalizedGrade) || normalizedGrade < 11 || normalizedGrade > 12) {
      return [];
    }
    const { data, error } = await client.rpc("get_eligible_streams", {
      requested_grade: normalizedGrade,
    });
    if (error) throw error;
    return [...new Set((data || []).map((row) => String(row.stream || "").trim()).filter(Boolean))];
  }

  async function getTeacherProfile(client = getClient()) {
    const user = await getUser(client);
    const { data, error } = await client
      .from("teachers")
      .select("id, user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("No teacher profile is linked to this account.");
    return { client, user, profile: data };
  }

  async function getTeacherGradeGroups(client = getClient(), teacherId = null) {
    const teacher = await getTeacherProfile(client);
    if (teacherId && String(teacherId) !== String(teacher.profile.id)) {
      throw new Error("The requested teacher profile does not belong to this account.");
    }
    return readAll(() => client
      .from("teacher_grade_groups")
      .select("id, teacher_id, grade, stream, teach_all_subjects")
      .eq("teacher_id", teacher.profile.id)
      .order("grade", { ascending: true })
      .order("stream", { ascending: true }));
  }

  async function getTeacherAssignedSubjects(
    grade,
    stream = null,
    client = getClient(),
    teacherId = null,
  ) {
    const teacher = await getTeacherProfile(client);
    if (teacherId && String(teacherId) !== String(teacher.profile.id)) {
      throw new Error("The requested teacher profile does not belong to this account.");
    }
    const normalizedGrade = Number(grade);
    const assignments = await readAll(() => {
      let query = client
        .from("teacher_subject_assignments")
        .select("id, teacher_id, subject_id, grade, stream")
        .eq("teacher_id", teacher.profile.id)
        .eq("grade", normalizedGrade);
      query = normalizedGrade >= 11
        ? query.eq("stream", String(stream || "").trim())
        : query.is("stream", null);
      return query.order("id", { ascending: true });
    });
    const group = (await getTeacherGradeGroups(client, teacher.profile.id))
      .find((row) => classKey(row.grade, row.stream) === classKey(normalizedGrade, stream));
    if (!group) return [];
    const eligible = await getEligibleSubjects(normalizedGrade, stream, client);
    const eligibleById = new Map(eligible.map((subject) => [String(subject.id), subject]));
    const assigned = assignments
      .map((assignment) => eligibleById.get(String(assignment.subject_id)))
      .filter(Boolean);
    if (!group.teach_all_subjects) return assigned;
    const allEligible = await getEligibleSubjects(normalizedGrade, stream, client);
    return [...new Map(
      [...assigned, ...allEligible].map((subject) => [String(subject.id), subject]),
    ).values()];
  }

  async function getTeacherTeachingScope(client = getClient(), teacherId = null) {
    const { profile } = await getTeacherProfile(client);
    if (teacherId && String(teacherId) !== String(profile.id)) {
      throw new Error("The requested teacher profile does not belong to this account.");
    }
    const [groups, assignments] = await Promise.all([
      readAll(() => client
        .from("teacher_grade_groups")
        .select("id, teacher_id, grade, stream, teach_all_subjects")
        .eq("teacher_id", profile.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true })),
      readAll(() => client
        .from("teacher_subject_assignments")
        .select("id, teacher_id, subject_id, grade, stream")
        .eq("teacher_id", profile.id)
        .order("grade", { ascending: true })
        .order("stream", { ascending: true })),
    ]);
    const normalizedGroups = groups.map((group) => ({
      ...group,
      grade: Number(group.grade),
      stream: Number(group.grade) >= 11 ? normalizeStream(group.stream) : null,
      teachAllSubjects: Boolean(group.teach_all_subjects),
      subjects: [],
    }));
    const groupByKey = new Map(
      normalizedGroups.map((group) => [classKey(group.grade, group.stream), group]),
    );
    const assignmentIds = [...new Set(
      assignments.map((row) => row.subject_id).filter((id) => id != null).map(String),
    )];
    const catalog = assignmentIds.length || normalizedGroups.some((group) => group.teachAllSubjects)
      ? await readAll(() => {
          let query = client.from("subjects").select("id, name, grades, streams");
          if (assignmentIds.length && !normalizedGroups.some((group) => group.teachAllSubjects)) {
            query = query.in("id", assignmentIds);
          }
          return query.order("name", { ascending: true });
        })
      : [];
    const subjectsById = new Map(catalog.map((subject) => [String(subject.id), subject]));
    for (const assignment of assignments) {
      const group = groupByKey.get(classKey(assignment.grade, assignment.stream));
      const subject = subjectsById.get(String(assignment.subject_id));
      if (
        group &&
        subject &&
        isEligible(subject, group.grade, group.stream) &&
        !group.subjects.some((item) => String(item.id) === String(subject.id))
      ) {
        group.subjects.push({ id: subject.id, name: subject.name });
      }
    }
    for (const group of normalizedGroups.filter((row) => row.teachAllSubjects)) {
      const eligible = catalog.filter((subject) =>
        isEligible(subject, group.grade, group.stream),
      );
      group.subjects = [...new Map(
        [...group.subjects, ...eligible].map((subject) => [
          String(subject.id),
          { id: subject.id, name: subject.name },
        ]),
      ).values()];
    }
    return normalizedGroups;
  }

  async function getStudentProfile(client = getClient()) {
    const user = await getUser(client);
    const { data, error } = await client
      .from("students")
      .select("id, user_id, grade, stream")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No student profile is linked to this account.");
    return { client, user, profile: data };
  }

  async function getStudentSubjects(client = getClient(), expectedProfile = null) {
    const { user, profile } = await getStudentProfile(client);
    if (
      expectedProfile &&
      String(expectedProfile.user_id) !== String(user.id)
    ) {
      throw new Error("The requested student profile does not belong to this account.");
    }
    const grade = Number(profile.grade);
    const stream = grade >= 11 ? normalizeStream(profile.stream) : null;
    if (!Number.isInteger(grade) || grade < 5 || grade > 12) {
      throw new Error("Your student profile does not have a valid registered grade.");
    }
    if (grade >= 11 && !stream) {
      throw new Error("Your registered Grade 11 or 12 profile is missing its stream.");
    }
    const assignments = await readAll(() => {
      let query = client
        .from("teacher_subject_assignments")
        .select("id, teacher_id, subject_id, grade, stream")
        .eq("grade", grade);
      query = grade >= 11
        ? query.eq("stream", stream)
        : query.is("stream", null);
      return query.order("id", { ascending: true });
    });
    const subjectIds = [...new Set(
      assignments.map((row) => row.subject_id).filter((id) => id != null).map(String),
    )];
    if (!subjectIds.length) return { user, student: profile, grade, stream, subjects: [] };
    const subjects = [];
    for (let offset = 0; offset < subjectIds.length; offset += PAGE_SIZE) {
      const ids = subjectIds.slice(offset, offset + PAGE_SIZE);
      subjects.push(...await readAll(() => client
        .from("subjects")
        .select("id, name, grades, streams")
        .in("id", ids)
        .order("name", { ascending: true })));
    }
    const eligibleById = new Map(
      subjects
        .filter((subject) => isEligible(subject, grade, stream))
        .map((subject) => [String(subject.id), subject]),
    );
    const result = [...new Set(subjectIds)]
      .map((id) => eligibleById.get(id))
      .filter(Boolean)
      .map(({ id, name, grades, streams }) => ({ id, name, grades, streams }));
    return { user, student: profile, grade, stream, subjects: result };
  }

  async function validateSubjectEligibility(grade, stream, subjectId, client = getClient()) {
    const eligible = await getEligibleSubjects(grade, stream, client);
    return eligible.some((subject) => String(subject.id) === String(subjectId));
  }

  window.SubjectService = {
    getClient,
    getUser,
    getEligibleSubjects,
    getAvailableStreams,
    getTeacherProfile,
    getTeacherGradeGroups,
    getTeacherAssignedSubjects,
    getTeacherTeachingScope,
    getStudentProfile,
    getStudentSubjects,
    validateSubjectEligibility,
    normalizeStream,
    streamQueryValues: (value) => [String(value ?? "").trim()].filter(Boolean),
    isEligible,
  };
})();
