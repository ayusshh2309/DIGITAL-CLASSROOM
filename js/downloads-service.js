(function () {
  const STORAGE_KEY = "smartLearningDownloadsFiles";
  const MATERIALS_KEY_PREFIX = "teacherMaterials:";
  const OFFLINE_DB_NAME = "smartLearningDownloadsOffline";
  const OFFLINE_DB_VERSION = 1;
  const OFFLINE_STORE = "files";
  const DOWNLOAD_META_KEY = "smartLearningStudentDownloads";
  const DEFAULT_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn(`Unable to read local data for ${key}:`, error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function safeNumber(value, defaultValue = 0) {
    const numeric = Number(value ?? defaultValue);
    return Number.isFinite(numeric) ? numeric : defaultValue;
  }

  function toTitleCase(value) {
    return String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function getTeacherRecord() {
    return (
      readJson("teacherRegistration", null) ||
      readJson("teacherProfile", null) ||
      readJson("teacherData", null) ||
      readJson("finalTeacherRegistration", null) ||
      null
    );
  }

  function teacherId() {
    const teacher = getTeacherRecord();
    return (
      teacher?.id ||
      teacher?.teacher_id ||
      teacher?.user_id ||
      teacher?.personal?.userId ||
      "local-teacher"
    );
  }

  function normalizeGrade(value) {
    const grade = String(value ?? "").replace(/^class\s+/i, "").trim();
    return grade || "";
  }

  function getTeacherAssignments() {
    const record = getTeacherRecord();
    const professional = record?.professional || {};
    const map = new Map();
    const addAssignment = (grade, subject) => {
      if (!grade || !subject) return;
      const key = normalizeGrade(grade);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(String(subject).trim());
    };

    const assignmentList =
      professional.specialistAssignments ||
      professional.specialist_assignments ||
      [];

    assignmentList.forEach((assignment) => {
      const grades = Array.isArray(assignment.grades)
        ? assignment.grades
        : [assignment.grade || assignment.class_grade];
      grades.forEach((grade) => addAssignment(grade, assignment.subject));
    });

    if (assignmentList.length === 0) {
      const grades = professional.grades || professional.selected_grades || [];
      const subjects = professional.subjects || professional.selected_subjects || [];
      grades.forEach((grade) => {
        if (Array.isArray(subjects) && subjects.length) {
          subjects.forEach((subject) => addAssignment(grade, subject));
        }
      });
    }

    const finalMap = {};
    Array.from(map.entries())
      .sort(([left], [right]) => Number(left) - Number(right))
      .forEach(([grade, subjects]) => {
        finalMap[grade] = Array.from(subjects).sort();
      });
    return finalMap;
  }

  function getRegisteredClasses() {
    const assignments = getTeacherAssignments();
    return Object.keys(assignments).sort((left, right) => Number(left) - Number(right));
  }

  function getRegisteredSubjects(classGrade) {
    const assignments = getTeacherAssignments();
    const direct = assignments[classGrade] || assignments[String(classGrade).replace(/^class\s+/i, "")] || [];
    return Array.from(new Set(direct)).sort();
  }

  function detectFileType(fileName, mimeType) {
    const name = String(fileName || "").toLowerCase();
    const type = String(mimeType || "").toLowerCase();

    if (type.includes("pdf") || name.endsWith(".pdf")) return "PDF";
    if (type.includes("video") || /\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return "Video";
    if (type.includes("image") || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return "Image";
    if (type.includes("presentation") || /\.(ppt|pptx)$/i.test(name)) return "Presentation";
    if (type.includes("sheet") || /\.(xlsx|xls|csv)$/i.test(name)) return "Document";
    if (type.includes("document") || /\.(doc|docx|txt|rtf)$/i.test(name)) return "Document";
    if (/\.(zip|rar|7z)$/i.test(name)) return "Archive";
    return "Other";
  }

  function detectCategory(fileName, detectedType) {
    const lowerName = String(fileName || "").toLowerCase();
    if (lowerName.includes("syllabus")) return "Syllabus";
    if (lowerName.includes("assignment") || lowerName.includes("homework")) return "Assignments";
    if (lowerName.includes("question") || lowerName.includes("paper")) return "Question Papers";
    if (lowerName.includes("notes") || lowerName.includes("note")) return "Notes";
    if (lowerName.includes("presentation") || lowerName.includes("ppt") || detectedType === "Presentation") return "Presentations";
    if (lowerName.includes("video") || detectedType === "Video") return "Videos";
    if (lowerName.includes("image") || detectedType === "Image") return "Images";
    if (lowerName.includes("worksheet") || lowerName.includes("template")) return "Documents";
    return "Documents";
  }

  function formatBytes(bytes) {
    const value = safeNumber(bytes, 0);
    if (!value) return "0 KB";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function formatDate(dateValue) {
    const date = new Date(dateValue || new Date());
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(dateValue) {
    const date = new Date(dateValue || new Date());
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function sanitizeName(value) {
    return String(value || "untitled-file")
      .replace(/[^a-zA-Z0-9._-\s]/g, "-")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function normalizeRecord(item, index = 0) {
    const fileName = item.file_name || item.name || item.title || `resource-${index + 1}`;
    const type = item.file_type || item.type || detectFileType(fileName, item.mime_type || item.content_type || "");
    const createdAt = item.created_at || item.uploaded_at || new Date().toISOString();
    const classGrade = normalizeGrade(item.class_grade || item.class || item.grade || "");
    const subject = item.subject || item.subject_name || "";
    const record = {
      id: String(item.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      teacher_id: item.teacher_id || teacherId(),
      file_name: fileName,
      file_type: type,
      type,
      category: item.category || detectCategory(fileName, type),
      class_grade: classGrade,
      subject,
      stream: item.stream || "",
      description: item.description || item.details || item.sub || "",
      visibility: item.visibility || "Class",
      file_size: safeNumber(item.file_size || item.size_bytes || item.size || 0),
      size_bytes: safeNumber(item.size_bytes || item.file_size || item.size || 0),
      download_count: safeNumber(item.download_count || item.downloads || 0),
      downloads: safeNumber(item.download_count || item.downloads || 0),
      created_at: createdAt,
      uploaded_at: createdAt,
      file_url: item.file_url || item.url || item.link || "",
      storage_path: item.storage_path || item.path || "",
      mime_type: item.mime_type || item.content_type || "",
      is_material_synced: Boolean(item.is_material_synced || item.sync_to_materials),
      updated_at: item.updated_at || createdAt,
      source_material_id: item.source_material_id || null,
    };

    return record;
  }

  function getLocalRecords() {
    const rows = readJson(STORAGE_KEY, []);
    return Array.isArray(rows) ? rows.map((item, index) => normalizeRecord(item, index)) : [];
  }

  function getLocalMaterials() {
    const materialKeys = [...new Set([
      `${MATERIALS_KEY_PREFIX}${teacherId()}`,
      `${MATERIALS_KEY_PREFIX}local-teacher`,
    ])];
    return materialKeys.flatMap((key) => {
      const rows = readJson(key, []);
      return Array.isArray(rows)
        ? rows.map((item, index) =>
          normalizeRecord(
            {
              ...item,
              file_name: item.file_name || item.title || item.name || `material-${index + 1}`,
              file_type: item.file_type || item.material_type || item.type || detectFileType(item.file_name || item.name || "", item.mime_type || item.content_type || ""),
              category: item.category || detectCategory(item.file_name || item.name || "", item.file_type || item.material_type || item.type || "Document"),
              class_grade: normalizeGrade(item.class_grade || item.class || item.grade || ""),
              subject: item.subject || item.subject_name || "",
              description: item.description || item.details || "",
              size_bytes: safeNumber(item.size_bytes || item.file_size || item.size || 0),
              file_size: safeNumber(item.file_size || item.size_bytes || item.size || 0),
              download_count: safeNumber(item.download_count || item.downloads || 0),
              visibility: item.visibility || "Class",
              created_at: item.created_at || item.uploaded_at || new Date().toISOString(),
              uploaded_at: item.uploaded_at || item.created_at || new Date().toISOString(),
            },
            index,
          ),
        )
        : [];
    });
  }

  function setLocalRecords(rows) {
    writeJson(STORAGE_KEY, rows.map((row) => normalizeRecord(row)));
  }

  function mergeDownloadRecords(downloads, materials) {
    const map = new Map();
    [...downloads, ...materials].forEach((record) => {
      const key = String(record.source_download_id || record.id);
      const normalized = normalizeRecord(record);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, normalized);
      } else {
        map.set(key, { ...existing, ...normalized, id: existing.id || normalized.id });
      }
    });

    return Array.from(map.values()).sort(
      (left, right) =>
        new Date(right.created_at || right.uploaded_at || 0).getTime() - new Date(left.created_at || left.uploaded_at || 0).getTime(),
    );
  }

  function getMaterialLocalKey() {
    return `${MATERIALS_KEY_PREFIX}${teacherId()}`;
  }

  function getMaterialLocalKeys() {
    return [...new Set([getMaterialLocalKey(), `${MATERIALS_KEY_PREFIX}local-teacher`])];
  }

  function syncLocalMaterials(record) {
    const normalized = normalizeRecord({
      ...record,
      title: record.file_name,
      name: record.file_name,
      material_type: record.file_type,
      file_type: record.file_type,
      file_url: record.file_url,
      file_size: record.size_bytes,
      created_at: record.created_at,
      subject: record.subject,
      class_grade: record.class_grade,
      description: record.description,
      teacher_id: record.teacher_id,
      sync_to_materials: true,
    });

    getMaterialLocalKeys().forEach((storageKey) => {
      const current = readJson(storageKey, []);
      const next = Array.isArray(current) ? current : [];
      const index = next.findIndex((item) => String(item.id) === String(record.id));
      if (index >= 0) next[index] = normalized;
      else next.unshift(normalized);
      writeJson(storageKey, next);
    });
  }

  function syncLocalMaterialRemoval(recordId) {
    getMaterialLocalKeys().forEach((storageKey) => {
      const current = readJson(storageKey, []);
      writeJson(
        storageKey,
        (Array.isArray(current) ? current : []).filter((item) => String(item.id) !== String(recordId)),
      );
    });
  }

  function compareValues(left, right) {
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function getClient() {
    return window.SmartLearningSupabase?.getClient?.() || null;
  }

  function getStudentProfile() {
    return window.StudentData?.getStudentProfile?.() || readJson("studentProfile", {}) || {};
  }

  function studentGrade(profile = getStudentProfile()) {
    return normalizeGrade(profile.grade || profile.class_grade || profile.class || profile.academic?.grade || profile.academic?.class || "");
  }

  function studentStream(profile = getStudentProfile()) {
    return String(profile.stream || profile.academic?.stream || "").trim();
  }

  function studentSubjects(profile = getStudentProfile()) {
    const values = profile.eligible_subjects || profile.subjects || profile.selectedSubjects || profile.academic?.subjects || [];
    return (Array.isArray(values) ? values : String(values).split(",")).map((value) => String(value).trim()).filter(Boolean);
  }

  function isEligibleMaterial(material, profile = getStudentProfile()) {
    const grade = studentGrade(profile);
    const stream = studentStream(profile);
    const subjects = studentSubjects(profile).map((value) => value.toLowerCase());
    const materialGrade = normalizeGrade(material.class_grade || material.grade || "");
    const materialStream = String(material.stream || "").trim();
    const subject = String(material.subject || material.subject_name || "").trim().toLowerCase();
    return (!grade || !materialGrade || materialGrade === grade) &&
      (!materialStream || !stream || materialStream.toLowerCase() === stream.toLowerCase()) &&
      (!subjects.length || subjects.includes(subject));
  }

  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("Offline storage is not supported by this browser."));
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OFFLINE_STORE)) request.result.createObjectStore(OFFLINE_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
    });
  }

  async function offlineGet(key) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(OFFLINE_STORE, "readonly").objectStore(OFFLINE_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function offlinePut(value) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(OFFLINE_STORE, "readwrite").objectStore(OFFLINE_STORE).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async function offlineDelete(key) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(OFFLINE_STORE, "readwrite").objectStore(OFFLINE_STORE).delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function readDownloadMetadata() {
    const rows = readJson(DOWNLOAD_META_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function writeDownloadMetadata(rows) {
    writeJson(DOWNLOAD_META_KEY, rows);
  }

  async function getOfflineDownload(materialId) {
    const key = String(materialId);
    const local = await offlineGet(key).catch(() => null);
    return local ? { ...local, offline_available: true, status: "completed" } : null;
  }

  async function getOfflineDownloads() {
    const rows = readDownloadMetadata();
    const valid = [];
    for (const row of rows) {
      if (await getOfflineDownload(row.material_id)) valid.push({ ...row, offline_available: true, status: "completed" });
    }
    writeDownloadMetadata(valid);
    return valid.sort((left, right) => new Date(right.downloaded_at || 0) - new Date(left.downloaded_at || 0));
  }

  async function getAuthenticatedStudent() {
    const client = getClient();
    if (client && isSupabaseConfigured()) {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (data?.user) return { client, user: data.user };
    }
    const profile = getStudentProfile();
    return { client: null, user: profile.student_id || profile.id ? { id: profile.student_id || profile.id } : null };
  }

  async function fetchStudentMaterials() {
    const { client, user } = await getAuthenticatedStudent();
    if (client && user?.id) {
      const { data, error } = await client.rpc("get_student_materials", { requested_student_id: user.id });
      if (!error && Array.isArray(data)) return data.map((item, index) => normalizeRecord(item, index));
      if (error) console.warn("Student material access check failed:", error.message);
    }
    return getLocalMaterials().filter((item) => isEligibleMaterial(item));
  }

  async function fetchStudentDownloads() {
    const { client, user } = await getAuthenticatedStudent();
    const local = await getOfflineDownloads();
    if (!client || !user?.id) return local;
    const { data, error } = await client
      .from("material_downloads")
      .select("*")
      .eq("student_id", user.id)
      .order("downloaded_at", { ascending: false });
    if (error) {
      console.warn("Unable to sync student download history:", error.message);
      return local;
    }
    const remote = (data || []).map((item) => ({ ...item, ...(local.find((row) => String(row.material_id) === String(item.material_id)) || {}) }));
    return [...remote, ...local.filter((row) => !remote.some((item) => String(item.material_id) === String(row.material_id)))];
  }

  async function downloadMaterial(material, onProgress = () => {}) {
    const record = normalizeRecord(material);
    if (!record.file_url && !record.storage_path) throw new Error("This material is online-only and has no downloadable file.");
    if (String(record.file_type).toLowerCase() === "link") throw new Error("External links are available online only.");
    const existing = await getOfflineDownload(record.id);
    if (existing) return existing;
    if (!navigator.onLine) throw new Error("Connect to the internet to download this material.");
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage + record.size_bytes > estimate.quota) throw new Error("There is not enough device storage for this file.");

    const url = publicUrlFromRecord(record);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const total = Number(response.headers.get("content-length")) || record.size_bytes || 0;
    let received = 0;
    let blob;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
        received += next.value.byteLength;
        onProgress(total ? Math.round((received / total) * 100) : 0);
      }
      blob = new Blob(chunks, { type: record.mime_type || response.headers.get("content-type") || "application/octet-stream" });
    } else {
      blob = await response.blob();
      onProgress(100);
    }
    const downloadedAt = new Date().toISOString();
    const metadata = {
      student_id: (await getAuthenticatedStudent()).user?.id || null,
      material_id: record.id,
      file_name: record.file_name,
      file_type: record.file_type,
      file_size: blob.size,
      downloaded_at: downloadedAt,
      offline_available: true,
      local_storage_key: String(record.id),
      status: "completed",
      material_metadata: { subject: record.subject, class_grade: record.class_grade, stream: record.stream || "" },
    };
    await offlinePut({ key: String(record.id), blob, metadata });
    const metadataRows = readDownloadMetadata().filter((row) => String(row.material_id) !== String(record.id));
    writeDownloadMetadata([metadata, ...metadataRows]);

    const { client, user } = await getAuthenticatedStudent();
    if (client && user?.id) {
      const { error } = await client.from("material_downloads").upsert({ material_id: record.id, student_id: user.id, downloaded_at: downloadedAt }, { onConflict: "material_id,student_id" });
      if (error) console.warn("Download metadata sync failed:", error.message);
    }
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return metadata;
  }

  async function openDownloadedMaterial(materialId) {
    const local = await getOfflineDownload(materialId);
    if (!local) throw new Error("This material is not available offline.");
    return URL.createObjectURL(local.blob);
  }

  async function removeStudentDownload(materialId) {
    await offlineDelete(String(materialId));
    writeDownloadMetadata(readDownloadMetadata().filter((row) => String(row.material_id) !== String(materialId)));
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
  }

  function isSupabaseConfigured() {
    return Boolean(window.SmartLearningSupabase?.isConfigured?.());
  }

  function publicUrlFromRecord(record) {
    if (record.file_url) return record.file_url;
    return record.storage_path ? record.storage_path : "";
  }

  async function fetchFiles() {
    const client = getClient();
    if (!client || !isSupabaseConfigured()) {
      return mergeDownloadRecords(getLocalRecords(), getLocalMaterials());
    }

    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        return mergeDownloadRecords(getLocalRecords(), getLocalMaterials());
      }

      const [downloadsResponse, materialsResponse] = await Promise.all([
        client
          .from("downloads_files")
          .select("*")
          .eq("teacher_id", userData.user.id)
          .order("created_at", { ascending: false }),
        client
          .from("materials")
          .select("*")
          .eq("teacher_id", userData.user.id)
          .order("created_at", { ascending: false }),
      ]);

      const downloads = downloadsResponse.error
        ? []
        : (downloadsResponse.data || []).map((item, index) => normalizeRecord(item, index));
      const materials = materialsResponse.error
        ? []
        : (materialsResponse.data || []).map((item, index) => normalizeRecord(item, index));

      return mergeDownloadRecords(downloads, materials);
    } catch (error) {
      console.warn("Unable to fetch remote downloads:", error);
      return mergeDownloadRecords(getLocalRecords(), getLocalMaterials());
    }
  }

  async function uploadFile(file, metadata = {}) {
    const parsed = {
      file_name: metadata.file_name || file?.name || "Untitled File",
      file_type: metadata.file_type || detectFileType(file?.name || metadata.file_name || "", file?.type || ""),
      category: metadata.category || detectCategory(metadata.file_name || file?.name || "", metadata.file_type),
      class_grade: normalizeGrade(metadata.class_grade || ""),
      subject: metadata.subject || "",
      description: metadata.description || "",
      visibility: metadata.visibility || "Class",
      sync_to_materials: Boolean(metadata.sync_to_materials),
    };

    if (!file && !metadata.file_url) {
      throw new Error("No file selected for upload.");
    }

    const validExtensions = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "avi", "mkv", "zip", "rar"];
    const extension = String(parsed.file_name.split(".").pop() || "").toLowerCase();
    if (!validExtensions.includes(extension)) {
      throw new Error("This file type is not supported. Please upload a PDF, document, image, video, or presentation.");
    }

    const fileSize = safeNumber(file?.size || metadata.size_bytes || 0, 0);
    if (fileSize > 100 * 1024 * 1024) {
      throw new Error("File size exceeds 100 MB. Please choose a smaller file.");
    }

    if (!parsed.class_grade || !parsed.subject) {
      throw new Error("Please select a registered class and subject before uploading.");
    }

    const client = getClient();
    const currentTeacherId = teacherId();
    const now = new Date().toISOString();

    if (client && isSupabaseConfigured()) {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("Your teacher session is not active. Sign in again and try uploading the file.");
      }

      const storagePath = `teacher-resources/${userData.user.id}/${Date.now()}-${sanitizeName(parsed.file_name)}`;
      const uploadResult = file
        ? await client.storage.from("teacher_resources").upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" })
        : { data: null, error: null };

      if (uploadResult.error) {
        throw new Error(uploadResult.error.message || "Storage upload failed.");
      }

      const publicUrl = client.storage.from("teacher_resources").getPublicUrl(storagePath).data.publicUrl;
      const record = normalizeRecord({
        id: metadata.id || (crypto.randomUUID ? crypto.randomUUID() : `dl-${Date.now()}`),
        teacher_id: userData.user.id,
        file_name: parsed.file_name,
        file_type: parsed.file_type,
        type: parsed.file_type,
        category: parsed.category,
        class_grade: parsed.class_grade,
        subject: parsed.subject,
        description: parsed.description,
        visibility: parsed.visibility,
        size_bytes: fileSize,
        download_count: 0,
        downloads: 0,
        created_at: now,
        uploaded_at: now,
        file_url: publicUrl,
        storage_path: storagePath,
        mime_type: file?.type || "application/octet-stream",
        is_material_synced: Boolean(parsed.sync_to_materials),
      });

      const { error: insertError } = await client.from("downloads_files").upsert(record, { onConflict: "id" });
      if (insertError) {
        throw new Error(insertError.message || "Could not save file metadata.");
      }

      if (parsed.sync_to_materials) {
        const materialRecord = {
          id: record.id,
          teacher_id: userData.user.id,
          title: record.file_name,
          name: record.file_name,
          type: record.file_type.toLowerCase(),
          material_type: record.file_type.toLowerCase(),
          class_grade: record.class_grade,
          subject: record.subject,
          description: record.description,
          file_url: record.file_url,
          file_name: record.file_name,
          file_size: record.size_bytes,
          size: record.size_bytes,
          created_at: record.created_at,
          uploaded_at: record.created_at,
          storage_path: record.storage_path,
          source_download_id: record.id,
        };

        const { error: materialError } = await client.from("materials").upsert(materialRecord, { onConflict: "id" });
        if (materialError) {
          console.warn("Material sync warning:", materialError.message);
        }
      }

      return record;
    }

    const dataUrl = file ? await fileToDataUrl(file) : metadata.file_url || "";
    const record = normalizeRecord({
      id: metadata.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      teacher_id: currentTeacherId,
      file_name: parsed.file_name,
      file_type: parsed.file_type,
      type: parsed.file_type,
      category: parsed.category,
      class_grade: parsed.class_grade,
      subject: parsed.subject,
      description: parsed.description,
      visibility: parsed.visibility,
      size_bytes: fileSize,
      download_count: 0,
      downloads: 0,
      created_at: now,
      uploaded_at: now,
      file_url: dataUrl || metadata.file_url || "",
      storage_path: `local:${currentTeacherId}/${sanitizeName(parsed.file_name)}`,
      mime_type: file?.type || "application/octet-stream",
      is_material_synced: parsed.sync_to_materials,
    });

    const records = getLocalRecords();
    records.unshift(record);
    setLocalRecords(records);

    if (parsed.sync_to_materials) {
      syncLocalMaterials(record);
    }

    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return record;
  }

  async function updateFile(recordId, changes = {}) {
    const client = getClient();
    const nextValues = {
      ...changes,
      updated_at: new Date().toISOString(),
    };

    if (client && isSupabaseConfigured()) {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("You must be signed in to update file metadata.");
      }

      const { data, error } = await client
        .from("downloads_files")
        .update(nextValues)
        .eq("id", recordId)
        .eq("teacher_id", userData.user.id)
        .select();

      if (error) throw error;
      return (data || [])[0] || null;
    }

    const rows = getLocalRecords();
    const index = rows.findIndex((item) => String(item.id) === String(recordId));
    if (index === -1) return null;
    rows[index] = normalizeRecord({ ...rows[index], ...changes, updated_at: new Date().toISOString() });
    setLocalRecords(rows);
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return rows[index];
  }

  async function deleteFile(recordId) {
    const client = getClient();

    if (client && isSupabaseConfigured()) {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("Your teacher session is no longer active.");
      }

      const record = (await fetchFiles()).find((item) => String(item.id) === String(recordId));
      if (record?.storage_path) {
        try {
          await client.storage.from("teacher_resources").remove([record.storage_path]);
        } catch (storageError) {
          console.warn("Storage cleanup warning:", storageError);
        }
      }

      const { error } = await client
        .from("downloads_files")
        .delete()
        .eq("id", recordId)
        .eq("teacher_id", userData.user.id);

      if (error) throw error;

      try {
        await client.from("materials").delete().eq("source_download_id", recordId).eq("teacher_id", userData.user.id);
      } catch (materialError) {
        console.warn("Material metadata cleanup warning:", materialError);
      }

      window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
      return true;
    }

    const rows = getLocalRecords();
    const remaining = rows.filter((item) => String(item.id) !== String(recordId));
    setLocalRecords(remaining);
    syncLocalMaterialRemoval(recordId);
    window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    return true;
  }

  async function trackDownload(record) {
    const safeRecord = normalizeRecord(record);
    const client = getClient();
    const nextCount = safeRecord.download_count + 1;

    if (client && isSupabaseConfigured()) {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("Your teacher session is no longer active.");
      }

      const { error } = await client
        .from("downloads_files")
        .update({ download_count: nextCount, updated_at: new Date().toISOString() })
        .eq("id", safeRecord.id)
        .eq("teacher_id", userData.user.id);

      if (error) throw error;
      window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
      return nextCount;
    }

    const rows = getLocalRecords();
    const index = rows.findIndex((item) => String(item.id) === String(safeRecord.id));
    if (index >= 0) {
      rows[index].download_count = nextCount;
      rows[index].downloads = nextCount;
      rows[index].updated_at = new Date().toISOString();
      setLocalRecords(rows);
      window.dispatchEvent(new CustomEvent("smart-learning-downloads-updated"));
    }
    return nextCount;
  }

  function getStats(files) {
    const records = Array.isArray(files) ? files.map((file) => normalizeRecord(file)) : [];
    const totalFiles = records.length;
    const totalDownloads = records.reduce((sum, item) => sum + safeNumber(item.download_count || item.downloads || 0), 0);
    const categories = new Set(records.map((item) => item.category).filter(Boolean)).size;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentlyAdded = records.filter((item) => {
      const created = new Date(item.created_at || item.uploaded_at || Date.now()).getTime();
      return created >= thirtyDaysAgo;
    }).length;
    const storageUsed = records.reduce((sum, item) => sum + safeNumber(item.size_bytes || item.file_size || 0), 0);

    const breakdown = {
      documents: 0,
      videos: 0,
      images: 0,
      presentations: 0,
      other: 0,
    };

    records.forEach((item) => {
      const type = String(item.file_type || item.type || "Other").toLowerCase();
      const size = safeNumber(item.size_bytes || item.file_size || 0);
      if (["pdf", "document", "doc", "docx", "txt", "xls", "xlsx", "csv"].includes(type)) breakdown.documents += size;
      else if (["video", "mp4", "mov", "avi", "mkv", "webm"].includes(type)) breakdown.videos += size;
      else if (["image", "png", "jpg", "jpeg", "gif", "webp", "svg"].includes(type)) breakdown.images += size;
      else if (["presentation", "ppt", "pptx"].includes(type)) breakdown.presentations += size;
      else breakdown.other += size;
    });

    return {
      totalFiles,
      totalDownloads,
      categories,
      recentlyAdded,
      storageUsed,
      storageLimit: DEFAULT_STORAGE_LIMIT_BYTES,
      breakdown,
    };
  }

  function getTopDownloaded(files) {
    return [...(Array.isArray(files) ? files : [])]
      .map((file) => normalizeRecord(file))
      .sort((left, right) => safeNumber(right.download_count || right.downloads) - safeNumber(left.download_count || left.downloads))
      .slice(0, 5);
  }

  function subscribe(listener) {
    const client = getClient();

    if (client && isSupabaseConfigured()) {
      const channelName = `downloads-${teacherId()}`;
      const channel = client.channel(channelName);

      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "downloads_files",
            filter: `teacher_id=eq.${teacherId()}`,
          },
          () => listener(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "materials",
            filter: `teacher_id=eq.${teacherId()}`,
          },
          () => listener(),
        )
        .subscribe();

      return () => channel.unsubscribe();
    }

    const handler = () => listener();
    window.addEventListener("smart-learning-downloads-updated", handler);
    return () => window.removeEventListener("smart-learning-downloads-updated", handler);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }

  function getFilterOptions(files) {
    const rows = (Array.isArray(files) ? files : []).map((file) => normalizeRecord(file));
    return {
      categories: Array.from(new Set(rows.map((file) => file.category).filter(Boolean))).sort(),
      types: Array.from(new Set(rows.map((file) => file.file_type).filter(Boolean))).sort(),
      classes: Array.from(new Set(rows.map((file) => file.class_grade).filter(Boolean))).sort((left, right) => Number(left || 0) - Number(right || 0)),
      subjects: Array.from(new Set(rows.map((file) => file.subject).filter(Boolean))).sort(),
    };
  }

  const api = {
    teacherId,
    getTeacherAssignments,
    getRegisteredClasses,
    getRegisteredSubjects,
    fetchFiles,
    uploadFile,
    updateFile,
    deleteFile,
    trackDownload,
    getStats,
    getTopDownloaded,
    getFilterOptions,
    fetchStudentMaterials,
    fetchStudentDownloads,
    downloadMaterial,
    openDownloadedMaterial,
    removeStudentDownload,
    getOfflineDownloads,
    isEligibleMaterial,
    subscribe,
    detectFileType,
    detectCategory,
    formatBytes,
    formatDate,
    formatDateTime,
    normalizeRecord,
    makeLocalDemoDownload: () => {
      const record = normalizeRecord({
        id: `demo-${Date.now()}`,
        teacher_id: teacherId(),
        file_name: "Demo resource.pdf",
        file_type: "PDF",
        category: "Notes",
        class_grade: getRegisteredClasses()[0] || "9",
        subject: getRegisteredSubjects(getRegisteredClasses()[0] || "9")[0] || "Mathematics",
        description: "Demo file created for testing.",
        visibility: "Class",
        size_bytes: 2 * 1024 * 1024,
        download_count: 0,
        created_at: new Date().toISOString(),
        uploaded_at: new Date().toISOString(),
        file_url: "",
      });
      const rows = getLocalRecords();
      rows.unshift(record);
      setLocalRecords(rows);
      return record;
    },
  };

  window.SmartLearningDownloads = api;
})();
