(() => {
  const state = {
    client: null,
    user: null,
    teacher: null,
    classes: new Map(),
    assignments: new Map(),
    subjectsById: new Map(),
    materials: [],
    type: "all",
    query: "",
    page: 1,
    pageSize: 8,
    editing: null,
    channel: null,
    refreshTimer: null,
    refreshing: false,
    refreshPending: false,
  };

  const $ = (id) => document.getElementById(id);
  const normalizedStream = (stream) => stream || null;
  const assignmentKey = (grade, stream) => `${String(grade)}|${normalizedStream(stream) || ""}`;
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  const toast = (message, kind = "") => {
    const element = document.createElement("div");
    element.className = `toast ${kind}`;
    element.textContent = message;
    $("toastRegion").appendChild(element);
    window.setTimeout(() => element.remove(), 5000);
  };
  const formatSize = (bytes) => {
    if (!bytes) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    let amount = Number(bytes);
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
  };
  const materialTypeName = (type) => ({
    pdf: "PDF",
    video: "Video",
    image: "Image",
  }[String(type || "").toLowerCase()] || "File");
  const materialIcon = (type) => ({
    pdf: "fa-file-pdf",
    video: "fa-circle-play",
    image: "fa-image",
  }[String(type || "").toLowerCase()] || "fa-file-lines");
  const bucketForType = (type) => ({
    pdf: "pdfs",
    video: "videos",
    photo: "photos",
    image: "photos",
    document: "documents",
  })[type];
  const normalizeMaterialType = (type) => ({
    pdf: "pdf",
    video: "video",
    photo: "photo",
    image: "photo",
    document: "document",
  })[String(type ?? "").trim().toLowerCase()] || null;
  const gradeValue = (grade) => String(grade ?? "").replace(/^class\s+/i, "").trim();

  function setLoadError(error) {
    console.error("Unable to load Supabase materials data.", error);
    $("uploadMaterialBtn").disabled = true;
    $("assignmentScopeValue").textContent = "Unable to load your registered teaching scope.";
    $("materialsBody").innerHTML = `<tr><td class="empty-state" colspan="7">Database error: ${escapeHtml(error?.message || "Materials could not be loaded.")} <button class="btn-secondary" type="button" id="retryMaterials">Retry</button></td></tr>`;
    $("retryMaterials")?.addEventListener("click", () => void initialize());
  }

  async function fetchTeachingScope(client, teacherDbId) {
    const [gradeResult, assignmentResult] = await Promise.all([
      client
        .from("teacher_grade_groups")
        .select("grade, stream")
        .eq("teacher_id", teacherDbId),
      client
        .from("teacher_subject_assignments")
        .select("subject_id, grade, stream")
        .eq("teacher_id", teacherDbId),
    ]);
    if (gradeResult.error) throw gradeResult.error;
    if (assignmentResult.error) throw assignmentResult.error;

    const classRows = gradeResult.data || [];
    const assignmentRows = assignmentResult.data || [];
    const registeredKeys = new Set(
      classRows.map((row) => assignmentKey(row.grade, row.stream)),
    );
    const subjectIds = [...new Set(
      assignmentRows
        .filter((row) => registeredKeys.has(assignmentKey(row.grade, row.stream)))
        .map((row) => row.subject_id)
        .filter((id) => id !== null && id !== undefined),
    )];
    let subjects = [];
    if (subjectIds.length) {
      const { data, error } = await client
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);
      if (error) throw error;
      subjects = data || [];
    }

    const subjectMap = new Map(subjects.map((subject) => [String(subject.id), subject]));
    const classes = new Map();
    classRows.forEach((row) => {
      const grade = gradeValue(row.grade);
      if (!grade) return;
      if (!classes.has(grade)) classes.set(grade, new Set());
      classes.get(grade).add(normalizedStream(row.stream));
    });

    const assignments = new Map();
    assignmentRows.forEach((row) => {
      const grade = gradeValue(row.grade);
      const stream = normalizedStream(row.stream);
      const key = assignmentKey(grade, stream);
      if (!classes.has(grade) || !registeredKeys.has(key)) return;
      const subject = subjectMap.get(String(row.subject_id));
      if (!subject?.name) {
        throw new Error(`Registered subject ID ${row.subject_id} is missing from public.subjects.`);
      }
      if (!assignments.has(key)) assignments.set(key, new Map());
      assignments.get(key).set(String(subject.id), subject);
    });

    return { classes, assignments, subjectsById: subjectMap };
  }

  function scopeDescription() {
    return [...state.classes.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([grade, streams]) => {
        const namedStreams = [...streams].filter(Boolean);
        return namedStreams.length
          ? `Class ${grade} (${namedStreams.join(", ")})`
          : `Class ${grade}`;
      })
      .join(" · ");
  }

  function renderScope() {
    const select = $("materialClass");
    const selectedGrade = select.value;
    select.replaceChildren(new Option("Select a class", ""));
    [...state.classes.keys()]
      .sort((left, right) => Number(left) - Number(right))
      .forEach((grade) => select.add(new Option(`Class ${grade}`, grade)));
    if (state.classes.has(selectedGrade)) select.value = selectedGrade;
    $("assignmentScopeValue").textContent = scopeDescription() || "No registered classes found.";
    const classFilter = $("classFilter");
    const previousFilter = classFilter.value;
    classFilter.replaceChildren(new Option("All classes", ""));
    [...state.classes.keys()]
      .sort((left, right) => Number(left) - Number(right))
      .forEach((grade) => classFilter.add(new Option(`Class ${grade}`, grade)));
    if (state.classes.has(previousFilter)) classFilter.value = previousFilter;
    $("uploadMaterialBtn").disabled = state.classes.size === 0;
    if (!state.classes.size) {
      $("assignmentScopeValue").textContent = "No registered classes found.";
    }
  }

  function renderStreams(preferredStream = null) {
    const grade = $("materialClass").value;
    const streamSelect = $("materialStream");
    const streamField = $("materialStreamField");
    const streams = [...(state.classes.get(grade) || new Set())];
    streamSelect.replaceChildren(new Option("Select a stream", ""));
    streams.forEach((stream) => {
      streamSelect.add(new Option(stream || "General / no stream", stream || ""));
    });
    streamField.hidden = !grade || streams.length <= 1 && !streams[0];
    streamSelect.required = streams.some(Boolean) && streams.length > 1;
    if (preferredStream !== null) {
      streamSelect.value = preferredStream || "";
    } else if (streams.length === 1) {
      streamSelect.value = streams[0] || "";
    }
    renderSubjects();
  }

  function renderSubjects(preferredSubjectId = "") {
    const grade = $("materialClass").value;
    const stream = normalizedStream($("materialStream").value);
    const subjectSelect = $("materialSubject");
    subjectSelect.replaceChildren(new Option("Select a subject", ""));
    const subjects = state.assignments.get(assignmentKey(grade, stream));
    [...(subjects?.values() || [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((subject) => subjectSelect.add(new Option(subject.name, String(subject.id))));
    subjectSelect.disabled = !grade || !subjects?.size;
    if (preferredSubjectId && subjects?.has(String(preferredSubjectId))) {
      subjectSelect.value = String(preferredSubjectId);
    }
    $("assignmentMessage").textContent = !grade
      ? "Select a class to load your assigned subjects."
      : subjects?.size
        ? "Only subjects assigned to your selected class and stream are available."
        : "No subjects are registered for this class and stream.";
  }

  async function signedMaterial(item) {
    const path = item.file_path;
    const bucket = item.storage_bucket || (path ? "teacher_resources" : null);
    let fileUrl = "";
    if (path && bucket && !/^https?:\/\//i.test(path)) {
      try {
        const { data, error } = await state.client.storage
          .from(bucket)
          .createSignedUrl(path, 3600);
        if (!error) fileUrl = data?.signedUrl || fileUrl;
        else console.warn("Could not create material URL.", error);
      } catch (error) {
        console.warn("Could not create material URL.", error);
      }
    }
    return { ...item, subject: state.subjectsById.get(String(item.subject_id))?.name || "", file_url: fileUrl };
  }

  function filteredMaterials() {
    const classFilter = $("classFilter").value;
    const subjectFilter = $("subjectFilter").value;
    const query = state.query.toLowerCase();
    const filtered = state.materials.filter((item) => {
      const grade = gradeValue(item.grade);
      const subject = state.subjectsById.get(String(item.subject_id))?.name || "";
      const storedType = String(item.material_type || "").toLowerCase();
      const type = storedType === "photo" ? "image" : storedType;
      const searchable = `${item.title} ${item.description || ""} ${grade} ${subject} ${type} ${item.file_name || ""}`.toLowerCase();
      return (!classFilter || classFilter === grade) &&
        (!subjectFilter || subjectFilter === String(item.subject_id)) &&
        (state.type === "all" || state.type === type) &&
        (!query || searchable.includes(query));
    });
    const sort = $("sortMaterials").value;
    return filtered.sort((left, right) => {
      if (sort === "az") return String(left.title).localeCompare(String(right.title));
      if (sort === "za") return String(right.title).localeCompare(String(left.title));
      const leftDate = new Date(left.created_at || 0).getTime();
      const rightDate = new Date(right.created_at || 0).getTime();
      return sort === "oldest" ? leftDate - rightDate : rightDate - leftDate;
    });
  }

  function render() {
    const all = filteredMaterials();
    const start = (state.page - 1) * state.pageSize;
    const visible = all.slice(start, start + state.pageSize);
    $("materialsBody").innerHTML = visible.length
      ? visible.map((item) => {
        const storedType = String(item.material_type || "").toLowerCase();
        const type = storedType === "photo" ? "image" : storedType;
        const subject = state.subjectsById.get(String(item.subject_id))?.name || "-";
        const grade = gradeValue(item.grade) || "-";
        const fileUrl = item.file_url || item.external_url || "";
        const displayName = item.file_name || item.title || "Untitled material";
        const preview = (type === "image" || type === "video" && item.thumbnail_url) && (type === "video" ? item.thumbnail_url : fileUrl)
          ? `<img src="${escapeHtml(type === "video" ? item.thumbnail_url : fileUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">`
          : `<i class="fa-solid ${materialIcon(type)}"></i>`;
        return `<tr data-material-id="${escapeHtml(item.id)}"><td><a class="material-link" href="${escapeHtml(fileUrl || "#")}" ${fileUrl ? 'target="_blank" rel="noopener"' : 'aria-disabled="true"'}><span class="material-thumb type-${escapeHtml(type)}">${preview}</span><span class="material-name"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(displayName)}</small></span></a></td><td><span class="badge-type type-${escapeHtml(type)}"><i class="fa-solid ${materialIcon(type)}"></i> ${escapeHtml(materialTypeName(type))}</span></td><td>Class ${escapeHtml(grade)}${item.stream ? ` · ${escapeHtml(item.stream)}` : ""}</td><td>${escapeHtml(subject)}</td><td><span class="table-value-icon"><i class="fa-regular fa-calendar"></i> ${item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</span></td><td><span class="table-value-icon"><i class="fa-solid fa-database"></i> ${formatSize(item.file_size ?? item.size)}</span></td><td><span class="material-actions"><button class="material-action" type="button" data-edit="${escapeHtml(item.id)}" title="Edit details"><i class="fa-solid fa-pen"></i></button>${fileUrl ? `<a class="material-action" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener" title="Open"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ""}<button class="material-action material-delete-action" type="button" data-delete="${escapeHtml(item.id)}" title="Delete"><i class="fa-solid fa-trash-can"></i></button></span></td></tr>`;
      }).join("")
      : '<tr><td class="empty-stat" colspan="7">No materials found for the selected filters.</td></tr>';

    $("paginationSummary").textContent = all.length
      ? `Showing ${start + 1} to ${Math.min(start + state.pageSize, all.length)} of ${all.length} materials`
      : "No materials found";
    const pages = Math.ceil(all.length / state.pageSize);
    $("paginationControls").innerHTML = Array.from({ length: pages }, (_, index) =>
      `<button class="page-btn ${index + 1 === state.page ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`,
    ).join("");

    const types = [null, "video", "pdf", "image"];
    ["statTotal", "statVideos", "statPdfs", "statImages"].forEach((id, index) => {
      $(id).textContent = types[index]
        ? state.materials.filter((item) => {
          const materialType = String(item.material_type || "").toLowerCase();
          return (materialType === "photo" ? "image" : materialType) === types[index];
        }).length
        : state.materials.length;
    });
    $("statFolders").textContent = "0";
    const totalBytes = state.materials.reduce((sum, item) => sum + Number(item.file_size || 0), 0);
    const storagePercent = Math.min(100, Math.round((totalBytes / (10 * 1024 * 1024 * 1024)) * 100));
    $("storageUsed").textContent = formatSize(totalBytes);
    $("storagePercent").textContent = `${storagePercent}%`;
    $("storageRing").style.background = `conic-gradient(#6157ef ${storagePercent}%, #dfe4f4 ${storagePercent}% 100%)`;
    $("storageVideos").textContent = formatSize(state.materials.filter((item) => item.storage_bucket === "videos").reduce((sum, item) => sum + Number(item.file_size || 0), 0));
    $("storagePdfs").textContent = formatSize(state.materials.filter((item) => item.storage_bucket === "pdfs").reduce((sum, item) => sum + Number(item.file_size || 0), 0));
    $("storageImages").textContent = formatSize(state.materials.filter((item) => item.storage_bucket === "photos").reduce((sum, item) => sum + Number(item.file_size || 0), 0));
    $("storageOthers").textContent = "0 B";
  }

  async function loadMaterials() {
    const { data, error } = await state.client
      .from("materials")
      .select("*")
      .eq("teacher_id", state.teacher.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.materials = await Promise.all((data || []).map(signedMaterial));
    const subjects = new Map();
    state.assignments.forEach((rows) => rows.forEach((subject) => subjects.set(String(subject.id), subject.name)));
    const filter = $("subjectFilter");
    const previous = filter.value;
    filter.replaceChildren(new Option("All subjects", ""));
    [...subjects.entries()].sort((left, right) => left[1].localeCompare(right[1])).forEach(([id, name]) => {
      filter.add(new Option(name, id));
    });
    if (subjects.has(previous)) filter.value = previous;
    render();
  }

  async function loadCurrentScope() {
    const current = await window.TeacherData.loadCurrentTeacherProfile();
    if (String(current.user.id) !== String(state.user.id) || String(current.profile.id) !== String(state.teacher.id)) {
      throw new Error("Your authenticated teacher profile changed. Reload the page to continue.");
    }
    const scope = await fetchTeachingScope(state.client, state.teacher.id);
    const selectedGrade = gradeValue($("materialClass").value);
    const selectedStream = normalizedStream($("materialStream").value);
    const selectedSubjectId = String($("materialSubject").value);
    state.classes = scope.classes;
    state.assignments = scope.assignments;
    state.subjectsById = scope.subjectsById;
    renderScope();
    $("materialClass").value = selectedGrade;
    renderStreams(selectedStream);
    renderSubjects(selectedSubjectId);
    if (!scope.classes.has(gradeValue($("materialClass").value))) {
      throw new Error("You are not registered for the selected grade.");
    }
    const grade = gradeValue($("materialClass").value);
    const stream = normalizedStream($("materialStream").value);
    const allowedStreams = scope.classes.get(grade);
    if (!allowedStreams.has(stream)) {
      throw new Error("You are not registered for the selected stream.");
    }
    const subjectId = String($("materialSubject").value);
    const allowedSubjects = scope.assignments.get(assignmentKey(grade, stream));
    if (!allowedSubjects?.has(subjectId)) {
      throw new Error("You are not registered to teach this subject for this grade and stream.");
    }
    return { grade, stream, subject: allowedSubjects.get(subjectId) };
  }

  function safeFileName(name) {
    const leafName = String(name || "file").split(/[\\/]/).pop() || "file";
    return leafName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "file";
  }

  function validateFile(type, file) {
    if (!file) throw new Error("Choose a file to upload.");
    if (file.size > 25 * 1024 * 1024) throw new Error("File is too large. The maximum size is 25 MB.");
    const extension = String(file.name).split(".").pop().toLowerCase();
    if (type === "pdf" && (file.type !== "application/pdf" || extension !== "pdf")) {
      throw new Error("Unsupported file type. Choose a PDF file.");
    }
    if (type === "video" && (!file.type.startsWith("video/") || !["mp4", "webm", "mov"].includes(extension))) {
      throw new Error("Unsupported file type. Choose an MP4, WebM, or MOV video.");
    }
    if (type === "image" && (!file.type.startsWith("image/") || !["jpg", "jpeg", "png", "webp"].includes(extension))) {
      throw new Error("Unsupported file type. Choose a JPG, PNG, or WebP image.");
    }
    if (!bucketForType(type)) throw new Error("Unsupported material type.");
  }

  function setUploadMode(material = null) {
    state.editing = material;
    const editing = Boolean(material);
    $("materialModalTitle").textContent = editing ? "Edit material details" : "Upload material";
    $("submitMaterial").textContent = editing ? "Save changes" : "Save material";
    $("materialType").disabled = editing;
    $("materialFile").disabled = editing;
    $("fileField").hidden = editing;
    $("materialTitle").value = material?.title || "";
    $("materialDescription").value = material?.description || "";
    $("materialType").value = material?.material_type || material?.type || "";
    $("materialClass").value = material ? gradeValue(material.grade) : "";
    renderStreams(material ? material.stream || "" : null);
    renderSubjects(material?.subject_id || "");
    $("materialModal").hidden = false;
  }

  function closeModal() {
    $("materialModal").hidden = true;
    state.editing = null;
    $("materialForm").reset();
    $("materialType").disabled = false;
    $("materialFile").disabled = false;
    $("fileField").hidden = false;
    $("materialStreamField").hidden = true;
    $("materialStream").required = false;
    $("materialSubject").replaceChildren(new Option("Select a subject", ""));
    $("materialSubject").disabled = true;
  }

  async function uploadMaterial(event) {
    event.preventDefault();
    const button = $("submitMaterial");
    button.disabled = true;
    const oldButtonText = button.textContent;
    button.textContent = state.editing ? "Saving..." : "Uploading...";
    let uploadedPath = null;
    let uploadedBucket = null;
    try {
      const selected = await loadCurrentScope();
      const grade = Number(selected.grade);
      if (!Number.isInteger(grade) || grade < 5 || grade > 12) {
        throw new Error("Choose a valid grade from 5 to 12.");
      }
      const title = $("materialTitle").value.trim();
      if (!title) throw new Error("Enter a material title.");
      const description = $("materialDescription").value.trim();

      if (state.editing) {
        const { data, error } = await state.client
          .from("materials")
          .update({
            title,
            description,
            grade,
            stream: selected.stream,
            subject_id: selected.subject.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", state.editing.id)
          .eq("teacher_id", state.teacher.id)
          .select("*")
          .single();
        if (error) throw error;
        const updated = await signedMaterial(data);
        state.materials = state.materials.map((item) => String(item.id) === String(updated.id) ? updated : item);
        closeModal();
        render();
        toast("Material details updated.", "success");
        return;
      }

      const type = $("materialType").value;
      const normalizedMaterialType = normalizeMaterialType(type);
      if (!normalizedMaterialType) throw new Error("Choose a supported material type.");
      const file = $("materialFile").files[0];
      validateFile(type, file);
      const bucket = bucketForType(type);
      const uniqueId = window.crypto.randomUUID();
      const path = `${state.teacher.id}/${grade}/${selected.subject.id}/${uniqueId}-${safeFileName(file.name)}`;
      const { error: uploadError } = await state.client.storage
        .from(bucket)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
      uploadedPath = path;
      uploadedBucket = bucket;

      const timestamp = new Date().toISOString();
      const payload = {
        teacher_id: state.teacher.id,
        grade,
        stream: selected.stream,
        subject_id: selected.subject.id,
        title,
        description: description || null,
        material_type: normalizedMaterialType,
        file_name: file.name,
        file_path: path,
        storage_bucket: bucket,
        file_size: file.size,
        mime_type: file.type || null,
        updated_at: timestamp,
      };
      const { data, error } = await state.client
        .from("materials")
        .insert(payload)
        .select("*")
        .single();
      if (error) {
        try {
          const { error: cleanupError } = await state.client.storage.from(bucket).remove([path]);
          if (cleanupError) console.error("Uploaded file rollback failed.", cleanupError);
        } catch (cleanupError) {
          console.error("Uploaded file rollback failed.", cleanupError);
        }
        uploadedPath = null;
        throw new Error(`Material record could not be created: ${error.message}`);
      }

      state.materials.unshift(await signedMaterial(data));
      closeModal();
      state.page = 1;
      render();
      toast("Material uploaded successfully.", "success");
    } catch (error) {
      console.error("Material operation failed.", error);
      if (uploadedPath && uploadedBucket) {
        try {
          const { error: cleanupError } = await state.client.storage.from(uploadedBucket).remove([uploadedPath]);
          if (cleanupError) console.error("Uploaded file rollback failed.", cleanupError);
        } catch (cleanupError) {
          console.error("Uploaded file rollback failed.", cleanupError);
        }
      }
      toast(error?.message || "Material could not be saved.", "error");
    } finally {
      button.disabled = false;
      button.textContent = oldButtonText;
    }
  }

  async function removeMaterial(id) {
    if (!window.confirm("Delete this material and its stored file?")) return;
    const material = state.materials.find((item) => String(item.id) === String(id));
    if (!material) return;
    try {
      const bucket = material.storage_bucket || (material.file_path ? "teacher_resources" : null);
      if (material.file_path && bucket) {
        const { error: storageError } = await state.client.storage
          .from(bucket)
          .remove([material.file_path]);
        if (storageError) throw new Error(`Storage deletion failed: ${storageError.message}`);
      }
      const { error } = await state.client
        .from("materials")
        .delete()
        .eq("id", material.id)
        .eq("teacher_id", state.teacher.id);
      if (error) throw error;
      state.materials = state.materials.filter((item) => String(item.id) !== String(id));
      render();
      toast("Material deleted.", "success");
    } catch (error) {
      console.error("Material deletion failed.", error);
      toast(error?.message || "Could not delete material.", "error");
    }
  }

  function openMaterial(id) {
    const item = state.materials.find((material) => String(material.id) === String(id));
    const url = item?.file_url;
    if (url) window.open(url, "_blank", "noopener");
  }

  async function refreshMaterials() {
    if (state.refreshing) {
      state.refreshPending = true;
      return;
    }
    state.refreshing = true;
    try {
      const selectedGrade = gradeValue($("materialClass").value);
      const selectedStream = normalizedStream($("materialStream").value);
      const scope = await fetchTeachingScope(state.client, state.teacher.id);
      state.classes = scope.classes;
      state.assignments = scope.assignments;
      state.subjectsById = scope.subjectsById;
      renderScope();
      $("materialClass").value = selectedGrade;
      renderStreams(selectedStream);
      await loadMaterials();
    } catch (error) {
      console.error("Realtime materials refresh failed.", error);
      toast(error?.message || "Materials could not be refreshed.", "error");
    } finally {
      state.refreshing = false;
      if (state.refreshPending) {
        state.refreshPending = false;
        void refreshMaterials();
      }
    }
  }

  function subscribeRealtime() {
    const channel = state.client.channel(`teacher-materials-${state.teacher.id}`);
    ["materials", "teacher_grade_groups", "teacher_subject_assignments"].forEach((table) => {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter: `teacher_id=eq.${state.teacher.id}`,
      }, () => void refreshMaterials());
    });
    state.channel = channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("Materials Realtime subscription failed.", status);
      }
    });
  }

  function setupEvents() {
    $("uploadMaterialBtn").addEventListener("click", () => setUploadMode());
    $("newFolderBtn").addEventListener("click", () => toast("Folders are not supported by the materials database.", "error"));
    $("closeMaterialModal").addEventListener("click", closeModal);
    $("cancelMaterialModal").addEventListener("click", closeModal);
    $("materialClass").addEventListener("change", () => renderStreams());
    $("materialStream").addEventListener("change", () => renderSubjects());
    $("materialForm").addEventListener("submit", uploadMaterial);
    $("materialFile").addEventListener("change", (event) => {
      $("fileName").textContent = event.target.files[0]?.name || "No file chosen";
    });
    ["materialSearch", "classFilter", "subjectFilter", "sortMaterials"].forEach((id) => {
      const element = $(id);
      element.addEventListener(id === "materialSearch" ? "input" : "change", () => {
        state.query = $("materialSearch").value.trim();
        state.page = 1;
        render();
      });
    });
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      state.type = tab.dataset.type;
      state.page = 1;
      render();
    }));
    $("classFilter").addEventListener("change", () => {
      const grade = $("classFilter").value;
      $("subjectFilter").value = "";
      const validSubjects = new Map();
      state.assignments.forEach((subjects, key) => {
        if (key.startsWith(`${grade}|`)) subjects.forEach((subject) => validSubjects.set(String(subject.id), subject.name));
      });
      const filter = $("subjectFilter");
      filter.replaceChildren(new Option("All subjects", ""));
      [...validSubjects.entries()].sort((left, right) => left[1].localeCompare(right[1])).forEach(([id, name]) => filter.add(new Option(name, id)));
      state.page = 1;
      render();
    });
    $("materialsBody").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete]");
      const editButton = event.target.closest("[data-edit]");
      const openButton = event.target.closest("[data-download]");
      if (deleteButton) void removeMaterial(deleteButton.dataset.delete);
      if (editButton) {
        const item = state.materials.find((material) => String(material.id) === String(editButton.dataset.edit));
        if (item) setUploadMode(item);
      }
      if (openButton) openMaterial(openButton.dataset.download);
    });
    $("paginationControls").addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button) return;
      state.page = Number(button.dataset.page);
      render();
    });
  }

  async function initialize() {
    $("uploadMaterialBtn").disabled = true;
    try {
      const current = await window.TeacherData.loadCurrentTeacherProfile();
      state.client = current.client;
      state.user = current.user;
      state.teacher = current.profile;
      const scope = await fetchTeachingScope(state.client, state.teacher.id);
      state.classes = scope.classes;
      state.assignments = scope.assignments;
      state.subjectsById = scope.subjectsById;
      renderScope();
      await loadMaterials();
      if (!state.channel) subscribeRealtime();
      if (!state.refreshTimer) {
        state.refreshTimer = window.setInterval(() => void refreshMaterials(), 30000);
      }
    } catch (error) {
      console.error("Materials page initialization failed.", error);
      setLoadError(error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupEvents();
    void initialize();
  });
  window.addEventListener("beforeunload", () => {
    if (state.channel) state.client?.removeChannel(state.channel);
    window.clearTimeout(state.refreshTimer);
  }, { once: true });
})();