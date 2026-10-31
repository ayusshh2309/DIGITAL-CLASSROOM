(() => {
  const SUPPORTED_MATERIAL_TYPES = ["pdf", "photo", "image", "document"];
  const STORAGE_BUCKETS = new Set(["pdfs", "photos", "documents"]);
  const SIGNED_URL_EXPIRY_SECONDS = 3600;
  const TARGET_MATERIAL_ID = "e993b7b1-9e78-4ad3-9eca-850961878003";
  const REFRESH_INTERVAL_MS = 60_000;
  const state = {
    client: null,
    student: null,
    notes: [],
    channel: null,
    refreshTimer: null,
    refreshInterval: null,
    subscribedGrade: null,
    refreshQueued: false,
    loading: false,
    initialized: false,
  };
  const $ = (id) => document.getElementById(id);

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character]);
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function materialKind(material) {
    const type = normalize(material.material_type);
    if (type === "pdf") return "pdf";
    if (type === "photo" || type === "image") return "image";
    if (type === "document") return "document";
    return null;
  }

  function noteDate(note) {
    const date = new Date(note.created_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(date) {
    if (!date) return "Date unavailable";
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatSize(size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes < 0) return "Size unavailable";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  function iconFor(note) {
    const kind = materialKind(note);
    if (kind === "pdf") return "fa-file-pdf";
    if (kind === "image") return "fa-image";
    return "fa-file-lines";
  }

  function colorFor(subject) {
    const value = normalize(subject);
    if (value.includes("physics")) return "purple";
    if (value.includes("chemistry")) return "green";
    if (value.includes("math") || value.includes("account")) return "orange";
    if (value.includes("english")) return "blue";
    return "blue";
  }

  function filteredNotes() {
    const subject = $("subjectFilter").value;
    const kind = $("typeFilter").value;
    const search = normalize($("notesSearch").value);
    const notes = state.notes.filter((note) => {
      if (subject !== "all" && String(note.subject_id) !== subject) return false;
      if (kind !== "all" && materialKind(note) !== kind) return false;
      if (!search) return true;
      return [note.title, note.subject_name, note.file_name]
        .some((value) => normalize(value).includes(search));
    });
    const sort = $("sortFilter").value;
    notes.sort((left, right) => {
      if (sort === "oldest") {
        return (noteDate(left)?.getTime() || 0) - (noteDate(right)?.getTime() || 0);
      }
      if (sort === "name") {
        return String(left.title || "").localeCompare(String(right.title || ""));
      }
      if (sort === "za") {
        return String(right.title || "").localeCompare(String(left.title || ""));
      }
      return (noteDate(right)?.getTime() || 0) - (noteDate(left)?.getTime() || 0);
    });
    return notes;
  }

  function emptyMessage() {
    const hasFilters =
      $("subjectFilter").value !== "all" ||
      $("typeFilter").value !== "all" ||
      $("notesSearch").value.trim();
    if (hasFilters) {
      return `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></div><h3>No matching materials</h3><p>Try changing your search or filters.</p></div>`;
    }
    return `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-book-open" aria-hidden="true"></i></div><h3>No study materials</h3><p>No study materials have been uploaded for your registered subjects yet.</p></div>`;
  }

  function renderNotes(notes) {
    if (!notes.length) {
      $("notesGrid").innerHTML = emptyMessage();
      return;
    }
    $("notesGrid").innerHTML = notes.map((note) => {
      const kind = materialKind(note);
      const label = kind === "image" ? "Photo" : kind.toUpperCase();
      const actions = kind === "document"
        ? `<button class="note-btn download-btn" type="button" data-view="${escape(note.id)}" data-material-action="download">Download</button>`
        : `<button class="note-btn view-btn" type="button" data-view="${escape(note.id)}" data-material-action="preview">${kind === "pdf" ? "View PDF" : "View Photo"}</button>
          <button class="note-btn download-btn" type="button" data-view="${escape(note.id)}" data-material-action="download">Download</button>`;
      return `<article class="note-card">
        <div class="note-top">
          <div class="note-icon ${colorFor(note.subject_name)}" aria-hidden="true"><i class="fa-solid ${iconFor(note)}"></i></div>
          <span class="file-type">${label}</span>
        </div>
        <h3 class="note-title">${escape(note.title || "Untitled Note")}</h3>
        <p class="note-meta">${escape(note.subject_name)}${note.teacher_name ? ` • ${escape(note.teacher_name)}` : ""}<br>${escape(formatDate(noteDate(note)))}</p>
        <div class="note-bottom"><span class="file-type">${escape(note.file_name)}</span><span class="file-size">${escape(formatSize(note.file_size))}</span></div>
        <div class="note-actions">${actions}</div>
      </article>`;
    }).join("");
  }

  function renderRecentNotes() {
    const recent = [...state.notes]
      .sort((left, right) => (noteDate(right)?.getTime() || 0) - (noteDate(left)?.getTime() || 0))
      .slice(0, 5);
    $("recentNotesList").innerHTML = recent.length
      ? recent.map((note) => `<button class="recent-note subject-filter-button" type="button" data-view="${escape(note.id)}" data-material-action="${materialKind(note) === "document" ? "download" : "preview"}" aria-label="${materialKind(note) === "document" ? "Download" : "Open"} ${escape(note.title || "study material")}">
          <span class="recent-icon ${colorFor(note.subject_name)}" aria-hidden="true"><i class="fa-solid ${iconFor(note)}"></i></span>
          <span class="recent-info"><span class="recent-title">${escape(note.title || "Untitled Note")}</span><span class="recent-meta">${escape(note.subject_name)} • ${escape(formatDate(noteDate(note)))}</span></span>
        </button>`).join("")
      : '<p style="font-size:11px;color:#74819a">No recent notes.</p>';
  }

  function renderSubjects() {
    const counts = new Map();
    for (const note of state.notes) {
      const key = String(note.subject_id);
      const current = counts.get(key) || {
        id: key,
        name: note.subject_name,
        count: 0,
      };
      current.count += 1;
      counts.set(key, current);
    }
    const subjects = [...counts.values()].sort((left, right) =>
      right.count - left.count || left.name.localeCompare(right.name),
    );
    const maximum = subjects[0]?.count || 1;
    $("subjectProgress").innerHTML = subjects.length
      ? subjects.map((subject) => `<button class="subject-progress subject-filter-button" type="button" data-subject="${escape(subject.id)}" aria-label="Filter by ${escape(subject.name)}">
          <span class="subject-row"><span>${escape(subject.name)}</span><span>${subject.count}</span></span>
          <span class="progress-track"><span class="progress-bar" style="display:block;width:${Math.round((subject.count / maximum) * 100)}%;background:#5b35df"></span></span>
        </button>`).join("")
      : '<p style="font-size:11px;color:#74819a">No subject data available.</p>';
  }

  function renderRegistrationContext() {
    const student = state.student;
    if (!student) return;
    const stream = String(student.stream || "").trim();
    const labels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts_humanities: "Arts / Humanities",
    };
    const normalizedStream = stream.toLowerCase().replace(/[()\s/-]+/g, "_").replace(/_+/g, "_");
    const streamLabel = stream ? ` · ${labels[normalizedStream] || stream}` : "";
    $("registrationContextText").textContent =
      `Grade ${student.grade}${streamLabel}`;
    $("registrationContext").hidden = false;
  }

  function renderSubjectFilter() {
    const select = $("subjectFilter");
    const selected = select.value;
    const subjects = new Map();
    for (const note of state.notes) {
      subjects.set(String(note.subject_id), note.subject_name);
    }
    select.innerHTML = `<option value="all">All Subjects</option>${[...subjects]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`)
      .join("")}`;
    select.value = subjects.has(selected) ? selected : "all";
  }

  function render() {
    renderSubjectFilter();
    renderNotes(filteredNotes());
    renderRecentNotes();
    renderSubjects();
    $("totalNotes").textContent = String(state.notes.length);
    $("subjectsCovered").textContent = String(
      new Set(state.notes.map((note) => String(note.subject_id))).size,
    );
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    $("recentNotes").textContent = String(
      state.notes.filter((note) => {
        const timestamp = noteDate(note)?.getTime();
        return timestamp != null && timestamp >= sevenDaysAgo && timestamp <= now;
      }).length,
    );
    renderRegistrationContext();
  }

  function showStatus(message, kind = "info", retry = false) {
    const status = $("notesStatus");
    status.dataset.state = kind;
    status.innerHTML = `${escape(message)}${retry ? ' <button type="button" id="retryNotes">Try again</button>' : ""}`;
  }

  function displayLoadError(error) {
    console.error("Student Notes could not be loaded.", error);
    state.notes = [];
    if (error?.code === "AUTH_REQUIRED") {
      window.location.assign("../teacher_registration/login.html");
      return;
    }
    const message = error?.code === "STUDENT_PROFILE_MISSING"
      ? "No student profile is linked to this account. Contact your school administrator."
      : error?.message || "We could not load your authorized study materials. Please try again.";
    $("notesGrid").innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i></div><h3>Notes could not be loaded</h3><p>${escape(message)}</p><button class="note-btn view-btn" type="button" id="retryNotesInline">Try again</button></div>`;
    $("recentNotesList").innerHTML = '<p style="font-size:11px;color:#74819a">Notes are unavailable.</p>';
    $("subjectProgress").innerHTML = '<p style="font-size:11px;color:#74819a">Notes are unavailable.</p>';
    $("totalNotes").textContent = "—";
    $("subjectsCovered").textContent = "—";
    $("recentNotes").textContent = "—";
    showStatus("The notes list could not be refreshed.", "error");
  }

  function normalizeMaterial(row) {
    const relation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    const subjectId = row.subject_id ?? relation?.id;
    if (subjectId == null || !String(relation?.name || "").trim()) {
      throw new Error(
        `The authorized material ${row.id} has no readable related subject. Check the subjects SELECT policy and materials.subject_id relationship.`,
      );
    }
    const kind = materialKind(row);
    if (
      !kind ||
      !String(row.storage_bucket || "").trim() ||
      !row.file_path ||
      !row.id
    ) {
      return null;
    }
    return {
      id: String(row.id),
      grade: row.grade,
      stream: row.stream,
      subject_id: String(subjectId),
      subject_name: String(relation.name).trim(),
      title: String(row.title || "Untitled Note"),
      material_type: row.material_type,
      file_name: String(row.file_name || row.title || "study-material"),
      file_path: String(row.file_path),
      storage_bucket: String(row.storage_bucket),
      file_size: row.file_size,
      created_at: row.created_at,
    };
  }

  function createMaterialsQuery(student, includeSubject, materialId) {
    const fields = "id, grade, stream, subject_id, title, material_type, file_name, file_path, storage_bucket, file_size, created_at";
    let query = state.client
      .from("materials")
      .select(includeSubject ? `${fields}, subjects(id, name)` : fields)
      .eq("grade", String(student.grade))
      .in("subject_id", student.subjectIds)
      .in("material_type", SUPPORTED_MATERIAL_TYPES);
    if (materialId != null) query = query.eq("id", materialId);
    if (Number(student.grade) <= 10) query = query.is("stream", null);
    else query = query.eq("stream", student.stream);
    return query
      .order("created_at", { ascending: false });
  }

  function isRelationshipError(error) {
    return error?.code === "PGRST200" || error?.code === "PGRST201";
  }

  async function fetchSubjectNames(rows) {
    const subjectIds = [...new Set(rows.map((row) => row.subject_id).filter((id) => id != null))];
    if (!subjectIds.length) return new Map();
    const { data, error } = await state.client
      .from("subjects")
      .select("id, name")
      .in("id", subjectIds);
    if (error) throw error;
    return new Map((data || []).map((subject) => [String(subject.id), subject]));
  }

  async function fetchAuthorizedMaterials(materialId = null) {
    const student = state.student;
    if (!student) throw new Error("The registered student profile has not been loaded.");
    if (!student.subjectIds.length) return [];
    try {
      let { data, error } = await createMaterialsQuery(student, true, materialId);
      let usedSeparateSubjectQuery = false;
      if (error && isRelationshipError(error)) {
        ({ data, error } = await createMaterialsQuery(student, false, materialId));
        if (error) throw error;
        usedSeparateSubjectQuery = true;
      } else if (error) {
        throw error;
      }

      const rows = data || [];
      if (materialId == null) {
        console.info("Student Notes material lookup completed.", {
          returnedRows: rows.length,
        });
      }
      const unresolvedRows = usedSeparateSubjectQuery
        ? rows
        : rows.filter((row) => {
            const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
            return !subject?.name;
          });
      const subjectNames = unresolvedRows.length
        ? await fetchSubjectNames(unresolvedRows)
        : new Map();
      const normalizedRows = rows.map((row) => {
        if (usedSeparateSubjectQuery || !row.subjects) {
          row.subjects = subjectNames.get(String(row.subject_id)) || null;
        }
        return normalizeMaterial(row);
      });
      return [...new Map(
        normalizedRows.filter(Boolean).map((material) => [material.id, material]),
      ).values()];
    } catch (error) {
      console.error("Student Notes material lookup failed.", error);
      throw error;
    }
  }

  async function checkTargetMaterialVisibility(notes) {
    const subjectIds = state.student?.subjectIds || [];
    if (!subjectIds.length) {
      console.info("Student Notes target material is not in an assigned subject.", {
        materialId: TARGET_MATERIAL_ID,
      });
      return;
    }
    let query;
    try {
      query = await state.client
        .from("materials")
        .select("id, grade, stream, material_type, storage_bucket, file_path")
        .eq("id", TARGET_MATERIAL_ID)
        .in("subject_id", subjectIds)
        .maybeSingle();
    } catch (error) {
      console.error("Student Notes target material lookup failed.", {
        materialId: TARGET_MATERIAL_ID,
        error,
      });
      return;
    }
    if (query.error) {
      console.error("Student Notes target material lookup failed.", {
        materialId: TARGET_MATERIAL_ID,
        error: query.error,
      });
      return;
    }

    const material = query.data;
    const student = state.student;
    if (!material) {
      console.info("Student Notes target material check.", {
        materialId: TARGET_MATERIAL_ID,
        returnedByAuthenticatedRlsQuery: false,
        note: "The row is not visible to this authenticated student (or does not exist).",
      });
      return;
    }

    const failedPageFilters = [];
    if (String(material.grade) !== String(student.grade)) {
      failedPageFilters.push("grade");
    }
    if (
      Number(student.grade) <= 10
        ? material.stream != null
        : String(material.stream || "") !== String(student.stream || "")
    ) {
      failedPageFilters.push("stream");
    }
    if (!SUPPORTED_MATERIAL_TYPES.includes(String(material.material_type))) {
      failedPageFilters.push("material type");
    }
    if (!material.storage_bucket || !material.file_path) {
      failedPageFilters.push("file metadata");
    }
    console.info("Student Notes target material check.", {
      materialId: TARGET_MATERIAL_ID,
      returnedByAuthenticatedRlsQuery: true,
      includedInNotes: notes.some((note) => note.id === TARGET_MATERIAL_ID),
      failedPageFilters,
      studentGrade: student.grade,
      studentStream: student.stream,
      materialGrade: material.grade,
      materialStream: material.stream,
      materialType: material.material_type,
    });
  }

  async function loadCurrentStudent() {
    try {
      const curriculum = await window.SubjectService.getStudentSubjects(state.client);
      state.student = {
        ...curriculum.student,
        grade: curriculum.grade,
        subjects: curriculum.subjects,
        subjectIds: curriculum.subjects.map((subject) => subject.id),
        user: curriculum.user,
      };
    } catch (error) {
      console.error("Student Notes curriculum lookup failed.", error);
      throw error;
    }
  }

  async function loadNotes() {
    if (!state.client) throw new Error("Supabase is unavailable.");
    if (state.loading) {
      state.refreshQueued = true;
      return;
    }
    state.loading = true;
    try {
      showStatus("Loading your study materials...");
      await loadCurrentStudent();
      state.notes = await fetchAuthorizedMaterials();
      void checkTargetMaterialVisibility(state.notes);
      render();
      showStatus("");
    } finally {
      state.loading = false;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        window.setTimeout(() => {
          loadNotes().catch(displayLoadError);
        }, 0);
      }
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      loadNotes().catch(displayLoadError);
    }, 250);
  }

  function subscribeToMaterials() {
    const grade = String(state.student?.grade || "");
    if (state.channel && state.subscribedGrade !== grade) {
      void state.client.removeChannel(state.channel);
      state.channel = null;
    }
    if (!state.channel) {
      state.channel = state.client
        .channel(`student-notes-materials`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "materials",
            filter: `grade=eq.${grade}`,
          },
          (payload) => {
            const student = state.student;
            const changed = payload.new?.id ? payload.new : payload.old;
            const changedStream = String(changed?.stream || "").trim().toLowerCase();
            const studentStream = String(student?.stream || "").trim().toLowerCase();
            if (
              Number(student?.grade) >= 11 &&
              changedStream &&
              changedStream !== studentStream
            ) {
              return;
            }
            scheduleRefresh();
          },
        )
        .subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            state.subscribedGrade = grade;
            showStatus("Notes update automatically when materials change.");
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            console.error("Student Notes Realtime subscription failed.", {
              status,
              error,
            });
            showStatus("Live updates are unavailable. Notes will refresh periodically.");
          }
        });
    }
    window.clearInterval(state.refreshInterval);
    state.refreshInterval = window.setInterval(() => {
      loadNotes().catch(displayLoadError);
    }, REFRESH_INTERVAL_MS);
  }

  async function fetchSelectedMaterial(id) {
    const currentUserId = state.student?.user?.id;
    if (!state.client || !currentUserId) {
      throw new Error("Your registered student access could not be verified.");
    }
    await loadCurrentStudent();
    if (state.student.user.id !== currentUserId) {
      throw new Error("Your signed-in student account changed. Sign in again to continue.");
    }
    const [material] = await fetchAuthorizedMaterials(id);
    if (!material) {
      throw new Error("This study material is no longer available to your account.");
    }
    return material;
  }

  async function getMaterialUrl(material) {
    const bucket = String(material.storage_bucket || "").trim();
    const path = String(material.file_path || "");
    if (!STORAGE_BUCKETS.has(bucket) || !path || path.startsWith("/") || /^https?:\/\//i.test(path)) {
      throw new Error("This material has invalid Storage bucket or file path metadata.");
    }

    const storage = state.client.storage.from(bucket);
    const fileName = material.file_name || material.title || "study-material";
    try {
      const { data } = storage.getPublicUrl(path);
      const publicUrl = data?.publicUrl;
      if (publicUrl) {
        const response = await window.fetch(publicUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        if (response.ok) {
          if (material.download) {
            const result = storage.getPublicUrl(path, { download: fileName });
            if (result.data?.publicUrl) return result.data.publicUrl;
          } else {
            return publicUrl;
          }
        }
      }
    } catch (error) {
      console.info("Public material URL is unavailable; trying a signed URL.", error);
    }

    const options = material.download ? { download: fileName } : {};
    const { data, error } = await storage
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS, options);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("A secure file link could not be created.");
    return data.signedUrl;
  }

  function materialAccessError(error) {
    const message = String(error?.message || "");
    if (/object not found|not found/i.test(message) || String(error?.statusCode) === "404") {
      return "This file is missing from its stored Storage location. Ask your teacher to upload it again.";
    }
    if (/permission|not authorized|unauthorized|row-level security/i.test(message)) {
      return "You do not have permission to access this file. Confirm that it is published for your registered class.";
    }
    return `This file could not be opened. ${message || "Check Storage access and try again."}`;
  }

  async function handleMaterialAction(event) {
    const control = event.target.closest("[data-view]");
    if (!control) return;
    const noteId = control.dataset.view;
    if (!noteId) return;
    const action = control.dataset.materialAction || "preview";
    const preview = action === "preview" ? window.open("about:blank", "_blank") : null;
    if (preview) preview.opener = null;
    try {
      if (action === "preview" && !preview) {
        throw new Error("Allow pop-ups to preview this material.");
      }
      control.disabled = true;
      showStatus(action === "download" ? "Preparing your download..." : "Preparing preview...");
      const material = await fetchSelectedMaterial(noteId);
      if (action === "preview" && materialKind(material) === "document") {
        throw new Error("Preview is not supported for this document type. Use Download instead.");
      }
      const url = await getMaterialUrl({
        ...material,
        download: action === "download",
      });
      if (action === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = material.file_name || material.title || "study-material";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        showStatus("Your download has started.");
      } else {
        preview.location.replace(url);
        showStatus("");
      }
    } catch (error) {
      console.error("Unable to access the selected study material.", error);
      if (preview && !preview.closed) preview.close();
      if (error?.code === "AUTH_REQUIRED") {
        window.location.assign("../teacher_registration/login.html");
        return;
      }
      showStatus(
        error?.message === "This study material is no longer available to your account."
          ? error.message
          : materialAccessError(error),
        "error",
      );
    } finally {
      control.disabled = false;
    }
  }

  function selectSubject(subjectId) {
    $("subjectFilter").value = subjectId || "all";
    renderNotes(filteredNotes());
    $("notesGrid").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cleanup() {
    window.clearTimeout(state.refreshTimer);
    window.clearInterval(state.refreshInterval);
    if (state.channel) {
      void state.client.removeChannel(state.channel);
      state.channel = null;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (state.initialized) return;
    state.initialized = true;
    state.client =
      window.SmartLearningSupabase?.getClient?.() || null;
    $("subjectFilter").addEventListener("change", render);
    $("typeFilter").addEventListener("change", render);
    $("sortFilter").addEventListener("change", render);
    $("notesSearch").addEventListener("input", render);
    $("notesGrid").addEventListener("click", (event) => {
      if (event.target.closest("#retryNotesInline")) {
        loadNotes().then(subscribeToMaterials).catch(displayLoadError);
        return;
      }
      void handleMaterialAction(event);
    });
    $("recentNotesList").addEventListener("click", (event) => {
      void handleMaterialAction(event);
    });
    $("subjectProgress").addEventListener("click", (event) => {
      const subject = event.target.closest("[data-subject]");
      if (subject) selectSubject(subject.dataset.subject);
    });
    $("viewAllRecent").addEventListener("click", (event) => {
      event.preventDefault();
      $("subjectFilter").value = "all";
      $("typeFilter").value = "all";
      $("notesSearch").value = "";
      $("sortFilter").value = "newest";
      render();
    });
    $("notesStatus").addEventListener("click", (event) => {
      if (event.target.closest("#retryNotes")) {
        loadNotes().then(subscribeToMaterials).catch(displayLoadError);
      }
    });
    window.addEventListener("pagehide", cleanup, { once: true });

    if (!state.client) {
      displayLoadError(new Error("Supabase is not configured for this page."));
      return;
    }
    loadNotes()
      .then(subscribeToMaterials)
      .catch(displayLoadError);
  });
})();
