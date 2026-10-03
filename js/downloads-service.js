(function () {
  const STORAGE_BUCKETS = new Set(["pdfs", "videos", "photos", "documents"]);
  const STREAM_LABELS = {
    science_pcm: "Science (PCM)",
    science_pcb: "Science (PCB)",
    commerce: "Commerce",
    arts_humanities: "Arts / Humanities",
  };
  let registeredTeacherAssignments = new Map();
  let registeredTeacherSubjects = new Map();
  let registeredTeacherClasses = [];

  function getClient() {
    const client = window.SmartLearningSupabase?.getClient?.();
    if (!client || !window.SmartLearningSupabase?.isConfigured?.()) {
      throw new Error("Supabase is unavailable. Please try again later.");
    }
    return client;
  }

  function normalizeGrade(value) {
    return String(value ?? "").replace(/^class\s+/i, "").trim();
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return "0 KB";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function detectFileType(fileName, mimeType = "") {
    const name = String(fileName || "").toLowerCase();
    const mime = String(mimeType || "").toLowerCase();
    if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
    if (mime.includes("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return "Video";
    if (mime.includes("image") || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return "Image";
    if (mime.includes("presentation") || /\.(ppt|pptx)$/i.test(name)) return "Presentation";
    if (mime.includes("sheet") || /\.(xlsx|xls|csv)$/i.test(name)) return "Document";
    if (mime.includes("document") || /\.(doc|docx|txt|rtf)$/i.test(name)) return "Document";
    if (/\.(zip|rar|7z)$/i.test(name)) return "Archive";
    return "Other";
  }

  function normalizeFileType(value, fileName, mimeType) {
    const type = String(value || "").trim().toLowerCase();
    const types = {
      pdf: "PDF",
      video: "Video",
      image: "Image",
      photo: "Image",
      presentation: "Presentation",
      document: "Document",
      link: "Link",
      archive: "Archive",
    };
    return types[type] || detectFileType(fileName, mimeType);
  }

  function materialTypeLabel(value) {
    return ({
      pdf: "PDF",
      video: "Video",
      photo: "Photo",
      image: "Photo",
      document: "Document",
    })[String(value || "").trim().toLowerCase()] || "Document";
  }

  function detectCategory(fileName, type) {
    const name = String(fileName || "").toLowerCase();
    if (name.includes("syllabus")) return "Syllabus";
    if (name.includes("assignment") || name.includes("homework")) return "Assignments";
    if (name.includes("question") || name.includes("paper")) return "Question Papers";
    if (name.includes("notes") || name.includes("note")) return "Notes";
    if (type === "Presentation") return "Presentations";
    if (type === "Video") return "Videos";
    if (type === "Image") return "Images";
    return "Documents";
  }

  function normalizeRecord(item, index = 0, teacherMaterial = false) {
    const relation = Array.isArray(item.subjects) ? item.subjects[0] : item.subjects;
    const fileName = item.file_name || item.title || `Material ${index + 1}`;
    const materialType = String(item.material_type || "").trim().toLowerCase();
    const fileType = teacherMaterial && ["photo", "image"].includes(materialType)
      ? "Photo"
      : normalizeFileType(materialType || item.file_type || item.type, fileName, item.mime_type);
    const createdAt = item.created_at || item.uploaded_at || null;
    const parsedFileSize = item.file_size == null || item.file_size === "" ? null : Number(item.file_size);
    const fileSize = teacherMaterial
      ? (Number.isFinite(parsedFileSize) ? parsedFileSize : null)
      : (Number.isFinite(parsedFileSize) ? parsedFileSize : 0);
    const grade = normalizeGrade(item.grade);
    const stream = String(item.stream || "").trim().toLowerCase();
    const classLabel = grade
      ? `Grade ${grade}${stream ? ` — ${STREAM_LABELS[stream] || stream}` : ""}`
      : "";
    const classFilter = `${grade}|${stream}`;
    return {
      ...item,
      id: item.id == null ? "" : String(item.id),
      teacher_id: item.teacher_id || "",
      file_name: fileName,
      file_type: fileType,
      type: fileType,
      category: teacherMaterial
        ? materialTypeLabel(materialType)
        : item.category || detectCategory(fileName, fileType),
      material_type: materialType,
      grade,
      class_grade: teacherMaterial ? classLabel : normalizeGrade(item.grade ?? item.class_grade ?? ""),
      ...(teacherMaterial ? { class_filter: classFilter } : {}),
      stream,
      subject: teacherMaterial
        ? registeredTeacherSubjects.get(String(item.subject_id)) || relation?.name || ""
        : item.subject || item.subject_name || relation?.name || "",
      description: item.description || "",
      file_size: fileSize,
      size_bytes: fileSize,
      download_count: Number((teacherMaterial ? item.download_count : item.download_count || item.downloads) || 0) || 0,
      downloads: Number(item.download_count || 0) || 0,
      created_at: createdAt,
      uploaded_at: createdAt,
      file_path: item.file_path || "",
      storage_path: item.file_path || "",
      storage_bucket: item.storage_bucket || "",
      mime_type: item.mime_type || "",
    };
  }

  function setRegisteredTeachingScope(groups) {
    const assignments = new Map();
    const subjectsById = new Map();
    const classes = [];
    (groups || []).forEach((group) => {
      const grade = normalizeGrade(group.grade);
      if (!grade) return;
      const stream = Number(grade) >= 11 ? String(group.stream || "").trim().toLowerCase() : "";
      const key = `${grade}|${stream}`;
      assignments.set(key, new Set());
      classes.push({
        key,
        label: `Grade ${grade}${stream ? ` — ${STREAM_LABELS[stream] || stream}` : ""}`,
      });
      (group.subjects || []).forEach((subject) => {
        const name = subject?.name || subject?.subject || "";
        if (name) {
          assignments.get(key).add(String(name).trim());
          if (subject?.id != null) subjectsById.set(String(subject.id), String(name).trim());
        }
      });
    });
    registeredTeacherAssignments = assignments;
    registeredTeacherSubjects = subjectsById;
    registeredTeacherClasses = classes.sort((left, right) => {
      const [leftGrade, leftStream] = left.key.split("|");
      const [rightGrade, rightStream] = right.key.split("|");
      return Number(leftGrade) - Number(rightGrade) || leftStream.localeCompare(rightStream);
    });
  }

  function getTeacherAssignments() {
    return Object.fromEntries(
      [...registeredTeacherAssignments.entries()]
        .sort(([left], [right]) => Number(left.split("|")[0]) - Number(right.split("|")[0]))
        .map(([key, subjects]) => [key, [...subjects].sort()]),
    );
  }

  function getRegisteredClasses() {
    return [...new Set(registeredTeacherClasses.map((item) => item.key.split("|")[0]))]
      .sort((left, right) => Number(left) - Number(right));
  }

  function getRegisteredClassOptions() {
    return registeredTeacherClasses.map((item) => ({ ...item }));
  }

  function getRegisteredSubjects(classGrade) {
    const grade = normalizeGrade(classGrade);
    return [...registeredTeacherAssignments.entries()]
      .filter(([key]) => key.split("|")[0] === grade)
      .flatMap(([, subjects]) => [...subjects])
      .filter((subject, index, all) => all.indexOf(subject) === index)
      .sort();
  }

  async function getCurrentTeacher() {
    const client = getClient();
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error("Sign in with your teacher account to access downloads.");
    console.log("Authenticated user:", data.user.id);
    if (!window.TeacherData?.loadCurrentTeacherProfile) {
      throw new Error("Teacher profile validation is unavailable.");
    }
    let current;
    try {
      current = await window.TeacherData.loadCurrentTeacherProfile();
    } catch (teacherError) {
      console.error("Teacher lookup error:", teacherError);
      throw teacherError;
    }
    if (String(current.user.id) !== String(data.user.id)) {
      throw new Error("Authenticated teacher changed while loading downloads.");
    }
    console.log("Teacher ID:", current.profile.id);
    return { client, user: data.user, profile: current.profile };
  }

  async function getAuthenticatedStudent() {
    const client = getClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) throw new Error("Sign in with your student account to access downloads.");

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id, user_id, grade, stream")
      .eq("user_id", authData.user.id)
      .single();
    if (studentError) throw studentError;
    if (!student || String(student.user_id) !== String(authData.user.id)) {
      throw new Error("Your authenticated account is not linked to a student registration.");
    }
    return { client, user: authData.user, student };
  }

  function isEligibleMaterial(material, student) {
    const grade = normalizeGrade(student?.grade);
    const materialGrade = normalizeGrade(material?.grade ?? material?.class_grade);
    if (!grade || materialGrade !== grade) return false;
    const numericGrade = Number(grade);
    if (numericGrade >= 5 && numericGrade <= 10) return material?.stream == null;
    if (numericGrade === 11 || numericGrade === 12) {
      return String(material?.stream ?? "") === String(student.stream ?? "");
    }
    return false;
  }

  async function fetchStudentMaterials() {
    const { client } = await getAuthenticatedStudent();
    const { data, error } = await client
      .from("materials")
      .select("*, subjects(name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((item, index) => normalizeRecord(item, index));
  }

  async function fetchStudentDownloads(offset = 0, limit = 100) {
    const { client, student } = await getAuthenticatedStudent();
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
    const { data, error, count } = await client
      .from("material_downloads")
      .select(
        "id, material_id, student_id, downloaded_at, created_at, materials(id, teacher_id, title, file_name, description, material_type, grade, stream, file_size, mime_type, subject_id, subjects(name))",
        { count: "exact" },
      )
      .eq("student_id", student.id)
      .order("downloaded_at", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);
    if (error) throw error;
    const records = (data || []).map((row, index) => {
      const material = row.materials ? normalizeRecord(row.materials, index) : null;
      return {
        ...(material || {}),
        id: String(row.id),
        material_id: String(row.material_id),
        student_id: String(row.student_id),
        downloaded_at: row.downloaded_at,
        created_at: row.created_at,
        material,
      };
    });
    records.totalCount = Number(count || 0);
    return records;
  }

  async function getStudentRegistration() {
    return (await getAuthenticatedStudent()).student;
  }

  async function createMaterialSignedUrl(client, material, download = false) {
    const bucket = String(material.storage_bucket || "");
    const path = String(material.file_path || "");
    if (!STORAGE_BUCKETS.has(bucket) || !path) {
      throw new Error("This material does not have a valid file in the approved storage buckets.");
    }
    const options = download
      ? { download: material.file_name || material.title || true }
      : {};
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 120, options);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Supabase did not return a signed file URL.");
    return data.signedUrl;
  }

  async function downloadMaterial(material, onProgress = () => {}) {
    const { client, student } = await getAuthenticatedStudent();
    if (!material?.id) throw new Error("The selected material could not be identified.");
    const { data: record, error: materialError } = await client
      .from("materials")
      .select("id, grade, stream, title, file_name, file_path, storage_bucket")
      .eq("id", material.id)
      .single();
    if (materialError) throw materialError;
    if (!isEligibleMaterial(record, student)) {
      throw new Error("This material is not available for your registered class and stream.");
    }

    const signedUrl = await createMaterialSignedUrl(client, record, true);
    const anchor = document.createElement("a");
    anchor.href = signedUrl;
    anchor.download = record.file_name || record.title || "study-material";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    onProgress(100);

    const { data: download, error: downloadError } = await client
      .from("material_downloads")
      .insert({ material_id: record.id, student_id: student.id })
      .select("id, material_id, student_id, downloaded_at, created_at")
      .single();
    if (downloadError) {
      console.error("The file download started, but its history record could not be saved.", downloadError);
      throw new Error("The file download started, but download history could not be saved. Please try again.");
    }
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return download;
  }

  async function getStudentMaterialUrl(materialId) {
    const { client, student } = await getAuthenticatedStudent();
    const { data: material, error } = await client
      .from("materials")
      .select("id, grade, stream, title, file_name, file_path, storage_bucket")
      .eq("id", materialId)
      .single();
    if (error) throw error;
    if (!isEligibleMaterial(material, student)) {
      throw new Error("This material is not available for your registered class and stream.");
    }
    return createMaterialSignedUrl(client, material);
  }

  async function getTeacherMaterialUrl(materialId, download = false) {
    const { client, profile } = await getCurrentTeacher();
    const { data: material, error } = await client
      .from("materials")
      .select("id, teacher_id, title, file_name, file_path, storage_bucket")
      .eq("id", materialId)
      .eq("teacher_id", profile.id)
      .single();
    if (error) throw error;
    return createMaterialSignedUrl(client, material, download);
  }

  async function fetchFiles(currentTeacher = null) {
    const { client, profile } = currentTeacher || await getCurrentTeacher();
    const { data: materials, error: materialsError } = await client
      .from("materials")
      .select("id, teacher_id, grade, stream, subject_id, title, description, material_type, file_name, file_path, storage_bucket, file_size, mime_type, created_at, updated_at")
      .eq("teacher_id", profile.id)
      .order("created_at", { ascending: false });
    if (materialsError) {
      console.error("Materials query error:", materialsError);
      throw materialsError;
    }

    const supportedMaterials = (materials || []).filter((item) =>
      ["pdf", "video", "photo", "document"].includes(String(item.material_type || "").toLowerCase()),
    );
    const counts = new Map();
    let downloadsAvailable = true;
    let downloadsError = null;
    const materialIds = supportedMaterials.map((item) => String(item.id));
    if (materialIds.length) {
      try {
        for (let index = 0; index < materialIds.length; index += 100) {
          const batch = materialIds.slice(index, index + 100);
          for (let offset = 0; ; offset += 1000) {
            const { data: downloads, error: downloadQueryError } = await client
              .from("material_downloads")
              .select("id, material_id")
              .in("material_id", batch)
              .order("id", { ascending: true })
              .range(offset, offset + 999);
            if (downloadQueryError) throw downloadQueryError;
            (downloads || []).forEach((download) => {
              const id = String(download.material_id);
              counts.set(id, (counts.get(id) || 0) + 1);
            });
            if (!downloads || downloads.length < 1000) break;
          }
        }
      } catch (downloadQueryError) {
        console.error("Download activity query error:", downloadQueryError);
        counts.clear();
        downloadsAvailable = false;
        downloadsError = downloadQueryError;
      }
    }
    const files = supportedMaterials.map((item, index) =>
      normalizeRecord({ ...item, download_count: counts.get(String(item.id)) || 0 }, index, true),
    );
    return { files, downloadsAvailable, downloadsError };
  }

  async function deleteFile(materialId) {
    const { client, profile } = await getCurrentTeacher();
    const { data: material, error: materialError } = await client
      .from("materials")
      .select("id, teacher_id, file_path, storage_bucket")
      .eq("id", materialId)
      .eq("teacher_id", profile.id)
      .single();
    if (materialError) throw materialError;

    if (material.file_path && material.storage_bucket) {
      const { error: storageError } = await client.storage
        .from(material.storage_bucket)
        .remove([material.file_path]);
      if (storageError) throw new Error(`Storage deletion failed: ${storageError.message}`);
    }
    const { error } = await client
      .from("materials")
      .delete()
      .eq("id", material.id)
      .eq("teacher_id", profile.id);
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return true;
  }

  function getStats(files) {
    const records = Array.isArray(files) ? files : [];
    const totalDownloads = records.reduce((sum, item) => sum + item.download_count, 0);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const breakdown = { pdfs: 0, videos: 0, photos: 0, documents: 0 };
    let storageUsed = 0;
    records.forEach((item) => {
      const size = Number(item.file_size) || 0;
      storageUsed += size;
      if (item.material_type === "pdf") breakdown.pdfs += size;
      else if (item.material_type === "video") breakdown.videos += size;
      else if (item.material_type === "photo" || item.material_type === "image") breakdown.photos += size;
      else if (item.material_type === "document") breakdown.documents += size;
    });
    return {
      totalFiles: records.length,
      totalDownloads,
      categories: new Set(records.map((item) => item.material_type).filter(Boolean)).size,
      recentlyAdded: records.filter((item) => item.created_at && new Date(item.created_at).getTime() >= thirtyDaysAgo).length,
      storageUsed,
      breakdown,
    };
  }

  function getTopDownloaded(files) {
    return [...(Array.isArray(files) ? files : [])]
      .sort((left, right) => right.download_count - left.download_count);
  }

  function getFilterOptions(files) {
    const rows = Array.isArray(files) ? files : [];
    return {
      categories: [...new Set(rows.map((file) => file.category).filter(Boolean))].sort(),
      types: [...new Set(rows.map((file) => file.file_type).filter(Boolean))].sort(),
      classes: [...new Set(rows.map((file) => file.class_filter).filter(Boolean))],
      subjects: [...new Set(rows.map((file) => file.subject).filter(Boolean))].sort(),
    };
  }

  function subscribe(listener, teacherId, onError = () => {}) {
    const client = getClient();
    if (!teacherId) throw new Error("An authenticated teacher profile is required for live download updates.");
    const channel = client.channel(`teacher-downloads-${teacherId}`);
    channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "material_downloads",
      }, listener)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "materials",
        filter: `teacher_id=eq.${teacherId}`,
      }, listener)
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Teacher download realtime subscription failed.", error || status);
          onError(error || new Error(status));
        }
      });
    return () => client.removeChannel(channel);
  }

  function subscribeStudent(studentId, listener, onError = () => {}) {
    const client = getClient();
    if (!studentId) throw new Error("An authenticated student profile is required for live download updates.");
    const channel = client.channel(`student-downloads-${studentId}`);
    channel
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "material_downloads",
        filter: `student_id=eq.${studentId}`,
      }, listener)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "materials",
      }, listener)
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Student download realtime subscription failed.", error || status);
          onError(error || new Error(status));
        }
      });
    return () => client.removeChannel(channel);
  }

  window.SmartLearningDownloads = {
    getTeacherAssignments,
    setRegisteredTeachingScope,
    getRegisteredClasses,
    getRegisteredClassOptions,
    getRegisteredSubjects,
    fetchFiles,
    deleteFile,
    getStats,
    getTopDownloaded,
    getFilterOptions,
    fetchStudentMaterials,
    fetchStudentDownloads,
    getStudentRegistration,
    downloadMaterial,
    getStudentMaterialUrl,
    getTeacherMaterialUrl,
    isEligibleMaterial,
    subscribe,
    subscribeStudent,
    detectFileType,
    detectCategory,
    formatBytes,
    formatDate,
    formatDateTime,
    normalizeRecord,
  };
})();
