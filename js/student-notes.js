(() => {
  const allowedTypes = new Set(["pdf", "image", "document", "link"]);
  const state = { notes: [], student: null, channel: null };
  const $ = (id) => document.getElementById(id);
  const profileKeys = ["studentProfile", "studentData", "finalStudentRegistration"];

  function readProfile() {
    for (const key of profileKeys) {
      try {
        const profile = JSON.parse(localStorage.getItem(key) || "null");
        if (profile) return profile;
      } catch (error) {
        console.warn(`Could not read ${key}.`, error);
      }
    }
    return {};
  }

  function registeredSubjects(profile) {
    const direct = profile.registeredSubjects || profile.registered_subjects || profile.subjects;
    if (Array.isArray(direct) && direct.length) return direct.map((subject) => String(subject));

    const grade = String(profile.classGrade || profile.class_grade || profile.grade || "");
    const stream = String(profile.stream || profile.classStream || "").toLowerCase();
    const gradeSubjects = {
      "5": ["English", "Mathematics", "EVS", "Hindi"],
      "6": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "7": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "8": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "9": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
      "10": ["English", "Mathematics", "Science", "Social Science", "Hindi"],
    };
    const streamSubjects = {
      science_pcm: ["Physics", "Chemistry", "Mathematics"],
      science_pcb: ["Physics", "Chemistry", "Biology"],
      commerce: ["Accountancy", "Business Studies", "Economics"],
      arts: ["History", "Political Science", "Geography", "Sociology"],
      arts_humanities: ["History", "Political Science", "Geography", "Psychology"],
    };
    return grade === "11" || grade === "12"
      ? [...(streamSubjects[stream] || []), "English", "Computer Science", "Physical Education"]
      : (gradeSubjects[grade] || []);
  }

  function client() {
    return window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.();
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }

  function typeOf(note) {
    return String(note.material_type || note.type || "document").toLowerCase().replace("application/", "");
  }

  function urlOf(note) {
    return note.external_url || note.file_url || "";
  }

  function dateOf(note) {
    return new Date(note.uploaded_at || note.updated_at || note.created_at || 0);
  }

  function formatSize(size) {
    if (!size) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let value = Number(size);
    let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
    return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function iconFor(subject) {
    const value = String(subject || "").toLowerCase();
    if (value.includes("physics")) return "⚛";
    if (value.includes("chemistry")) return "⚗";
    if (value.includes("math")) return "Σ";
    if (value.includes("english")) return "📖";
    if (value.includes("biology")) return "🧬";
    return "📄";
  }

  function classFor(subject) {
    const value = String(subject || "").toLowerCase();
    if (value.includes("physics")) return "purple";
    if (value.includes("chemistry")) return "green";
    if (value.includes("math")) return "orange";
    if (value.includes("english")) return "blue";
    return "blue";
  }

  function filteredNotes() {
    const subject = $("subjectFilter").value;
    const notes = state.notes.filter((note) => subject === "all" || note.subject === subject);
    const sort = $("sortFilter").value;
    return notes.sort((left, right) => {
      if (sort === "oldest") return dateOf(left) - dateOf(right);
      if (sort === "name") return String(left.title || "").localeCompare(String(right.title || ""));
      if (sort === "za") return String(right.title || "").localeCompare(String(left.title || ""));
      return dateOf(right) - dateOf(left);
    });
  }

  function renderNotes(notes) {
    $("notesGrid").innerHTML = notes.length ? notes.map((note) => {
      const url = urlOf(note);
      const type = typeOf(note);
      const action = type === "link" ? "Open Link" : type === "document" ? "Open" : "View";
      return `<article class="note-card"><div class="note-top"><div class="note-icon ${classFor(note.subject)}">${iconFor(note.subject)}</div><button class="note-menu" data-menu="${escape(note.material_id || note.id)}">⋮</button></div><h3 class="note-title">${escape(note.title || "Untitled Note")}</h3><p class="note-meta">${escape(note.subject || "General")}${note.chapter ? ` • ${escape(note.chapter)}` : ""}${note.teacher_name ? ` • ${escape(note.teacher_name)}` : ""}</p><div class="note-bottom"><span class="file-type">${escape(type.toUpperCase())}</span><span class="file-size">${escape(formatSize(note.file_size))}</span></div><div class="note-actions"><button class="note-btn view-btn" data-view="${escape(note.material_id || note.id)}">${action}</button><button class="note-btn download-btn" data-download="${escape(note.material_id || note.id)}">↓ Download</button></div></article>`;
    }).join("") : '<div class="empty-state"><div class="empty-icon">📚</div><h3>No Notes Available</h3><p>Your teacher has not uploaded any notes yet.</p></div>';
  }

  function renderSidePanels() {
    const recent = [...state.notes].sort((left, right) => dateOf(right) - dateOf(left)).slice(0, 5);
    $("recentNotesList").innerHTML = recent.length ? recent.map((note) => `<div class="recent-note" data-view="${escape(note.material_id || note.id)}"><div class="recent-icon ${classFor(note.subject)}">${iconFor(note.subject)}</div><div class="recent-info"><h4>${escape(note.title || "Untitled Note")}</h4><p>${escape(note.subject || "General")} • ${dateOf(note).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p></div></div>`).join("") : '<p style="font-size:11px;color:#74819a">No recent notes.</p>';
    const counts = [...state.notes.reduce((map, note) => map.set(note.subject || "Other", (map.get(note.subject || "Other") || 0) + 1), new Map())].sort((left, right) => right[1] - left[1]);
    const max = counts[0]?.[1] || 1;
    $("subjectProgress").innerHTML = counts.length ? counts.slice(0, 6).map(([subject, count]) => `<div class="subject-progress"><div class="subject-row"><span>${escape(subject)}</span><span>${count}</span></div><div class="progress-track"><div class="progress-bar" style="width:${Math.round((count / max) * 100)}%;background:#5b35df"></div></div></div>`).join("") : '<p style="font-size:11px;color:#74819a">No subject data available.</p>';
  }

  function render() {
    const notes = filteredNotes();
    renderNotes(notes);
    renderSidePanels();
    $("totalNotes").textContent = state.notes.length;
    $("subjectsCovered").textContent = new Set(state.notes.map((note) => note.subject).filter(Boolean)).size;
    $("recentNotes").textContent = state.notes.filter((note) => Date.now() - dateOf(note).getTime() <= 7 * 86400000).length;
    $("downloadedNotes").textContent = state.notes.filter((note) => Number(note.download_count || 0) > 0).length;
    const current = $("subjectFilter").value;
    const subjects = [...new Set([...registeredSubjects(state.student || {}), ...state.notes.map((note) => note.subject).filter(Boolean)])].sort();
    $("subjectFilter").innerHTML = '<option value="all">All Subjects</option>' + subjects.map((subject) => `<option value="${escape(subject)}">${escape(subject)}</option>`).join("");
    $("subjectFilter").value = [...$("subjectFilter").options].some((option) => option.value === current) ? current : "all";
  }

  async function loadNotes() {
    const supabase = client();
    state.student = readProfile();
    if (!supabase) { render(); return; }
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { render(); return; }
    state.student = { ...state.student, student_id: user.id };
    const { data, error } = await supabase.rpc("get_student_materials", { requested_student_id: user.id });
    if (error) { console.warn("Could not load authorized notes.", error); render(); return; }
    state.notes = (data || []).filter((note) => allowedTypes.has(typeOf(note)));
    render();
    subscribe(supabase, user.id);
  }

  function subscribe(supabase, studentId) {
    state.channel?.unsubscribe();
    state.channel = supabase.channel(`student-notes-${studentId}`).on("postgres_changes", { event: "*", schema: "public", table: "materials" }, loadNotes).subscribe();
  }

  async function trackDownload(note) {
    const supabase = client();
    const { error } = await supabase.from("material_downloads").insert({ material_id: note.material_id || note.id });
    if (error) console.warn("Download tracking failed.", error);
    note.download_count = Number(note.download_count || 0) + 1;
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("subjectFilter").addEventListener("change", render);
    $("sortFilter").addEventListener("change", render);
    $("notesGrid").addEventListener("click", handleAction);
    $("recentNotesList").addEventListener("click", handleAction);
    loadNotes().catch((error) => { console.warn("Notes are unavailable.", error); state.notes = []; render(); });
  });

  async function handleAction(event) {
    const id = event.target.closest("[data-view], [data-download], [data-menu]")?.dataset.view || event.target.closest("[data-download]")?.dataset.download || event.target.closest("[data-menu]")?.dataset.menu;
    const note = state.notes.find((item) => String(item.material_id || item.id) === String(id));
    if (!note) return;
    if (event.target.closest("[data-menu]")) return alert(`${note.title}\n\nSubject: ${note.subject || "General"}`);
    if (event.target.closest("[data-download]")) { await trackDownload(note); const link = document.createElement("a"); link.href = urlOf(note); link.download = note.file_name || note.title || "material"; link.target = "_blank"; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove(); return; }
    if (urlOf(note)) window.open(urlOf(note), "_blank", "noopener,noreferrer");
  }
})();