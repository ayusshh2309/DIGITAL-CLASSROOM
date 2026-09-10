(function () {
  const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";

  function isConfigured() {
    return (
      window.supabase &&
      SUPABASE_URL.startsWith("http") &&
      !SUPABASE_URL.includes("YOUR_") &&
      SUPABASE_ANON_KEY &&
      !SUPABASE_ANON_KEY.includes("YOUR_")
    );
  }

  function readJson(storage, key, fallback) {
    try {
      return JSON.parse(storage.getItem(key) || "null") || fallback;
    } catch (error) {
      console.warn(`Could not read ${key}.`, error);
      return fallback;
    }
  }

  function getTeacherData() {
    return (
      readJson(localStorage, "teacherRegistration", null) ||
      readJson(localStorage, "teacherProfile", null) ||
      readJson(localStorage, "teacherData", null) ||
      readJson(sessionStorage, "finalTeacherRegistration", null) ||
      null
    );
  }

  function saveTeacherData(data) {
    const serialized = JSON.stringify(data);
    localStorage.setItem("teacherRegistration", serialized);
    localStorage.setItem("teacherProfile", serialized);
    localStorage.setItem("teacherData", serialized);
    sessionStorage.setItem("finalTeacherRegistration", serialized);
  }

  function getSupabaseClient() {
    if (!isConfigured()) return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  async function saveToSupabase(data) {
    const client = getSupabaseClient();
    if (!client) return { saved: false, reason: "not-configured" };

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) {
      return { saved: false, reason: "not-authenticated" };
    }

    const teacher = {
      id: authData.user.id,
      full_name: data.personal.fullName,
      email: data.personal.email,
      phone: data.personal.phone,
      date_of_birth: data.personal.dob || null,
      gender: data.personal.gender,
      country: data.personal.country,
      state: data.personal.state,
      city: data.personal.city,
      address: data.personal.address,
      profile_photo: data.personal.profilePhoto || null,
      employment_status: data.professional.employmentStatus,
      institution_name: data.professional.institutionName,
      institution_type: data.professional.institutionType,
      experience_years: data.professional.experienceYears || null,
      highest_qualification: data.professional.highestQualification,
      languages: data.professional.languages || [],
      teaching_mode: data.professional.teachingMode,
      grades: data.professional.grades || [],
      streams: data.professional.streams || [],
      teacher_id: data.teacherId,
    };

    const { error: teacherError } = await client
      .from("teachers")
      .upsert(teacher, { onConflict: "id" });

    if (teacherError) throw teacherError;

    const assignments = data.professional.specialistAssignments || [];
    if (assignments.length) {
      const rows = assignments.flatMap((assignment) =>
        (assignment.grades || []).map((grade) => ({
          teacher_id: authData.user.id,
          subject: assignment.subject,
          grade: String(grade),
        })),
      );
      const { error: subjectsError } = await client
        .from("teacher_subjects")
        .upsert(rows, { onConflict: "teacher_id,subject,grade" });
      if (subjectsError) throw subjectsError;
    }

    return { saved: true };
  }

  window.TeacherData = {
    getTeacherData,
    saveTeacherData,
    getSupabaseClient,
    saveToSupabase,
  };
})();
