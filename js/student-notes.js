(() => {
  const allowedTypes = new Set(["pdf", "image", "document", "link"]);
  const state = { notes: [], student: null, channel: null };
  const $ = (id) => document.getElementById(id);

  function client() {
    return window.TeacherData?.getSupabaseClient?.() || window.SmartLearningSupabase?.getClient?.();
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }

  function typeOf(note) {
    return String(note.material_type || note.type || "document").toLowerCase().replace("application/", "");
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
      const type = typeOf(note);
      const action = type === "link" ? "Open Link" : type === "document" ? "Open" : "View";
      return `<article class="note-card"><div class="note-top"><div class="note-icon ${classFor(note.subject)}">${iconFor(note.subject)}</div><button class="note-menu" data-menu="${escape(note.id)}">⋮</button></div><h3 class="note-title">${escape(note.title || "Untitled Note")}</h3><p class="note-meta">${escape(note.subject || "General")}${note.chapter ? ` • ${escape(note.chapter)}` : ""}${note.teacher_name ? ` • ${escape(note.teacher_name)}` : ""}</p><div class="note-bottom"><span class="file-type">${escape(type.toUpperCase())}</span><span class="file-size">${escape(formatSize(note.file_size))}</span></div><div class="note-actions"><button class="note-btn view-btn" data-view="${escape(note.id)}">${action}</button><button class="note-btn download-btn" data-download="${escape(note.id)}">↓ Download</button></div></article>`;
    }).join("") : '<div class="empty-state"><div class="empty-icon">📚</div><h3>No Notes Available</h3><p>Your teacher has not uploaded any notes yet.</p></div>';
  }

  function renderSidePanels() {
    const recent = [...state.notes].sort((left, right) => dateOf(right) - dateOf(left)).slice(0, 5);
    $("recentNotesList").innerHTML = recent.length ? recent.map((note) => `<div class="recent-note" data-view="${escape(note.id)}"><div class="recent-icon ${classFor(note.subject)}">${iconFor(note.subject)}</div><div class="recent-info"><h4>${escape(note.title || "Untitled Note")}</h4><p>${escape(note.subject || "General")} • ${dateOf(note).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p></div></div>`).join("") : '<p style="font-size:11px;color:#74819a">No recent notes.</p>';
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
    const current = $("subjectFilter").value;
    const subjects = [...new Set(state.notes.map((note) => note.subject).filter(Boolean))].sort();
    $("subjectFilter").innerHTML = '<option value="all">All Subjects</option>' + subjects.map((subject) => `<option value="${escape(subject)}">${escape(subject)}</option>`).join("");
    $("subjectFilter").value = [...$("subjectFilter").options].some((option) => option.value === current) ? current : "all";
    renderRegistrationContext();
  }

  function renderRegistrationContext() {
    const profile = state.student || {};
    const grade = String(profile.classGrade || profile.class_grade || profile.grade || "");
    const stream = String(profile.stream || profile.classStream || "");
    if (!grade || !$("registrationContext") || !$("registrationContextText")) return;
    const streamLabels = { science_pcm: "Science (PCM)", science_pcb: "Science (PCB)", commerce: "Commerce", arts: "Arts / Humanities", arts_humanities: "Arts / Humanities" };
    const streamText = stream ? ` - ${streamLabels[stream.toLowerCase()] || stream}` : "";
    $("registrationContextText").textContent = `Grade ${grade}${streamText}`;
    $("registrationContext").hidden = false;
  }

  async function loadNotes() {
    const supabase = client();
    if (!supabase) throw new Error("Supabase is unavailable.");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("Sign in with your student account to view notes.");
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, user_id, grade, stream")
      .eq("user_id", user.id)
      .single();
    if (studentError) throw studentError;
    state.student = student;
    const materialsResponse = await supabase.rpc("get_student_materials", { requested_student_id: user.id });
    if (materialsResponse.error) throw materialsResponse.error;
    const { data } = materialsResponse;
    state.notes = (data || []).filter((note) => allowedTypes.has(typeOf(note)));
    render();
    subscribe(supabase, student.id);
  }

  function subscribe(supabase, studentId) {
    state.channel?.unsubscribe();
    state.channel = supabase.channel(`student-notes-${studentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, loadNotes)
      .subscribe();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("subjectFilter").addEventListener("change", render);
    $("sortFilter").addEventListener("change", render);
    $("notesGrid").addEventListener("click", handleAction);
    $("recentNotesList").addEventListener("click", handleAction);
    loadNotes().catch((error) => {
      console.error("Notes are unavailable.", error);
      state.notes = [];
      render();
      window.alert(error.message || "Unable to load your notes.");
    });
  });

  async function handleAction(event) {
    const action = event.target.closest("[data-view], [data-download], [data-menu]");
    if (!action) return;
    const id = action.dataset.view || action.dataset.download || action.dataset.menu;
    const note = state.notes.find((item) => String(item.id) === String(id));
    if (!note) return;
    if (action.hasAttribute("data-menu")) return alert(`${note.title}\n\nSubject: ${note.subject || "General"}`);
    try {
      if (action.hasAttribute("data-download")) {
        await window.SmartLearningDownloads.downloadMaterial(note);
        return;
      }
      const preview = window.open("about:blank", "_blank");
      if (!preview) throw new Error("Allow pop-ups to preview this material.");
      preview.opener = null;
      const url = await window.SmartLearningDownloads.getStudentMaterialUrl(note.id);
      preview.location.href = url;
    } catch (error) {
      console.error("Unable to open the selected material.", error);
      window.alert(error.message || "Unable to open this material.");
    }
  }
})();