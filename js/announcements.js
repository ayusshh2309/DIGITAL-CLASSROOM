(() => {
  const state = {
    announcements: [],
    groups: [],
    context: null,
    query: "",
    grade: "",
    type: "",
    status: "",
    sort: "newest",
    page: 1,
    pageSize: 7,
    editing: null,
    recipientsAvailable: true,
    stopRealtime: () => {},
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
  const statusLabel = (value) => value.charAt(0).toUpperCase() + value.slice(1);
  const dateLabel = (value) => value
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
    : "—";
  const classKey = (grade, stream) => `${grade}|${stream || ""}`;
  const formatClass = (grade, stream) => grade
    ? `Class ${grade}${Number(grade) >= 11 && stream ? ` · ${stream.replaceAll("_", " ")}` : ""}`
    : "—";

  function toast(message, isError = false) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    if (isError) node.style.background = "#b63b4a";
    $("announcementToastRoot").replaceChildren(node);
    window.setTimeout(() => node.remove(), 5000);
  }

  function recipientsFor(item) {
    return Array.isArray(item.recipients) ? item.recipients : [];
  }

  function readCounts(item) {
    const recipients = recipientsFor(item);
    return {
      total: recipients.length,
      read: recipients.filter((recipient) => recipient.read_at).length,
    };
  }

  function populateClasses() {
    const groups = state.groups;
    $("classFilter").innerHTML = `<option value="">All registered classes</option>${groups.map((group) => {
      const key = classKey(group.grade, group.stream);
      return `<option value="${escapeHtml(key)}">${escapeHtml(formatClass(group.grade, group.stream))}</option>`;
    }).join("")}`;
  }

  function populateTypes() {
    $("typeFilter").innerHTML = `<option value="">All types</option>${AnnouncementService.TYPES
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}`;
  }

  async function load() {
    const result = await AnnouncementService.loadAnnouncements(state.context);
    state.announcements = result.announcements;
    state.recipientsAvailable = result.recipientsAvailable;
    renderAll();
  }

  function filtered() {
    return state.announcements
      .filter((item) => {
        const text = `${item.title} ${item.message} ${item.subject}`.toLowerCase();
        const group = state.groups.find((entry) => Number(entry.grade) === Number(item.grade)
          && (Number(entry.grade) < 11 || String(entry.stream || "") === String(item.stream || "")));
        const itemClass = group ? classKey(group.grade, group.stream) : classKey(item.grade, item.stream);
        return (!state.query || text.includes(state.query))
          && (!state.grade || itemClass === state.grade)
          && (!state.type || item.type === state.type)
          && (!state.status || item.status === state.status);
      })
      .sort((left, right) => state.sort === "oldest"
        ? new Date(left.created_at) - new Date(right.created_at)
        : new Date(right.created_at) - new Date(left.created_at));
  }

  function renderSummary() {
    const published = state.announcements.filter((item) => item.status === "published");
    const now = new Date();
    const sentThisMonth = published.filter((item) => {
      if (!item.published_at) return false;
      const date = new Date(item.published_at);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const reach = published.reduce((sum, item) => sum + readCounts(item).total, 0);
    const reads = published.reduce((sum, item) => sum + readCounts(item).read, 0);
    $("statTotalAnnouncements").textContent = String(state.announcements.length);
    $("statSentThisMonth").textContent = String(sentThisMonth);
    $("statTotalReach").textContent = state.recipientsAvailable ? String(reach) : "—";
    $("statAvgReadRate").textContent = !state.recipientsAvailable || reach === 0
      ? "—"
      : `${Math.round((reads / reach) * 100)}%`;
  }

  function renderTable() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const visible = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    $("announcementsTableBody").innerHTML = visible.length
      ? visible.map((item) => {
          const counts = readCounts(item);
          const readRate = counts.total ? `${Math.round((counts.read / counts.total) * 100)}%` : "—";
          const date = item.status === "scheduled" ? item.publish_at : item.published_at || item.created_at;
          return `<tr>
            <td><div class="announcement-title">${escapeHtml(item.title)}</div><div class="announcement-message">${escapeHtml(item.message)}</div></td>
            <td>${escapeHtml(formatClass(item.grade, item.stream))}<br><small>${escapeHtml(item.subject || "All registered subjects")}</small></td>
            <td><span class="badge ${escapeHtml(item.type.toLowerCase())}">${escapeHtml(item.type)}</span></td>
            <td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span><br><small>${dateLabel(date)}</small></td>
            <td>${readRate}<br><small>${state.recipientsAvailable ? `${counts.read}/${counts.total} opened` : "Read data unavailable"}</small></td>
            <td><div class="row-actions">
              <button class="icon-button" data-action="view" data-id="${escapeHtml(item.id)}" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="icon-button" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="icon-button" data-action="delete" data-id="${escapeHtml(item.id)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="6"><div class="empty"><i class="fa-solid fa-bullhorn"></i>${state.announcements.length
        ? "No announcements match these filters."
        : "No announcements yet. Create your first announcement."}</div></td></tr>`;
    $("paginationText").textContent = rows.length
      ? `Showing ${(state.page - 1) * state.pageSize + 1}-${Math.min(state.page * state.pageSize, rows.length)} of ${rows.length} announcements`
      : "Showing 0 announcements";
    $("pageButtons").innerHTML = Array.from({ length: pages }, (_, index) => index + 1)
      .map((page) => `<button class="${page === state.page ? "active" : ""}" data-page="${page}">${page}</button>`)
      .join("");
  }

  function renderChart() {
    const counts = Object.fromEntries(AnnouncementService.TYPES.map((type) => [
      type,
      state.announcements.filter((item) => item.type === type).length,
    ]));
    const max = Math.max(1, ...Object.values(counts));
    $("overviewChart").innerHTML = Object.entries(counts).map(([type, count]) =>
      `<div class="chart-row"><span>${escapeHtml(type)}</span><div class="track"><div class="fill" style="width:${(count / max) * 100}%"></div></div><strong>${count}</strong></div>`,
    ).join("");
  }

  function renderDrafts() {
    const drafts = state.announcements.filter((item) => item.status === "draft").slice(0, 4);
    $("draftList").innerHTML = drafts.length
      ? drafts.map((item) => `<div class="draft">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(formatClass(item.grade, item.stream))} · ${dateLabel(item.updated_at)}</small>
          <button class="history-action" data-draft="${escapeHtml(item.id)}" style="border:0;background:transparent;color:#087f8a;font-weight:800;cursor:pointer;margin-top:7px">Continue editing</button>
        </div>`).join("")
      : '<div class="empty"><i class="fa-solid fa-file-circle-plus"></i>No drafts yet.</div>';
  }

  function renderAll() {
    renderSummary();
    renderTable();
    renderChart();
    renderDrafts();
  }

  function setFormSubjects(grade, stream, selectedId = "") {
    const group = state.groups.find((item) => Number(item.grade) === Number(grade)
      && (Number(item.grade) < 11 || String(item.stream || "") === String(stream || "")));
    const subjects = group?.subjects || [];
    $("formSubject").innerHTML = `<option value="">All registered subjects</option>${subjects.map((subject) =>
      `<option value="${escapeHtml(subject.id)}" ${String(subject.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(subject.name)}</option>`,
    ).join("")}`;
  }

  function localDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openModal(item = null) {
    state.editing = item;
    const grade = item?.grade ?? state.groups[0]?.grade ?? "";
    const stream = item?.stream ?? "";
    const groupKeyValue = classKey(grade, stream);
    const selectedStatus = item?.status || "draft";
    $("announcementModalRoot").innerHTML = `<div class="modal-backdrop">
      <form class="modal" id="announcementForm">
        <div class="modal-head">
          <div><span class="page-eyebrow"><i class="fa-solid fa-pen-to-square"></i> ${item ? "Edit announcement" : "New announcement"}</span>
            <h2 style="margin-top:7px">${item ? "Update announcement" : "Create announcement"}</h2>
          </div>
          <button type="button" class="icon-button" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-grid">
          <div class="form-field full"><label>Title *</label><input name="title" required value="${escapeHtml(item?.title || "")}" placeholder="Announcement title"></div>
          <div class="form-field full"><label>Message *</label><textarea name="message" required rows="5" placeholder="Write your announcement...">${escapeHtml(item?.message || "")}</textarea></div>
          <div class="form-field"><label>Type *</label><select name="type" required>${AnnouncementService.TYPES.map((type) =>
            `<option value="${escapeHtml(type)}" ${type === (item?.type || "Notice") ? "selected" : ""}>${escapeHtml(type)}</option>`,
          ).join("")}</select></div>
          <div class="form-field"><label>Class / Grade *</label><select name="class_key" id="formGrade" required>${state.groups.map((group) => {
            const key = classKey(group.grade, group.stream);
            return `<option value="${escapeHtml(key)}" ${key === groupKeyValue ? "selected" : ""}>${escapeHtml(formatClass(group.grade, group.stream))}</option>`;
          }).join("")}</select></div>
          <div class="form-field"><label>Subject</label><select name="subject_id" id="formSubject"></select></div>
          <div class="form-field"><label>Schedule</label><select name="status">
            <option value="published" ${selectedStatus === "published" ? "selected" : ""}>Publish now</option>
            <option value="draft" ${selectedStatus === "draft" ? "selected" : ""}>Save as draft</option>
            <option value="scheduled" ${selectedStatus === "scheduled" ? "selected" : ""}>Schedule for later</option>
            <option value="archived" ${selectedStatus === "archived" ? "selected" : ""}>Archive</option>
          </select></div>
          <div class="form-field"><label>Scheduled time</label><input name="publish_at" type="datetime-local" value="${localDateTime(item?.publish_at)}"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="ann-button" data-close>Cancel</button>
          <button class="ann-button primary" type="submit"><i class="fa-solid fa-paper-plane"></i> Save announcement</button>
        </div>
      </form>
    </div>`;

    const gradeSelect = $("formGrade");
    const selectedGroup = state.groups.find((group) => classKey(group.grade, group.stream) === gradeSelect.value);
    setFormSubjects(selectedGroup?.grade, selectedGroup?.stream, item?.subject_id || "");
    gradeSelect.addEventListener("change", () => {
      const group = state.groups.find((candidate) => classKey(candidate.grade, candidate.stream) === gradeSelect.value);
      setFormSubjects(group?.grade, group?.stream);
    });
    $("announcementForm").addEventListener("submit", submitForm);
    $("announcementModalRoot").addEventListener("click", (event) => {
      if (event.target.closest("[data-close]") || event.target.classList.contains("modal-backdrop")) {
        $("announcementModalRoot").replaceChildren();
      }
    });
  }

  async function submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const selectedGroup = state.groups.find((group) => classKey(group.grade, group.stream) === data.class_key);
    if (!selectedGroup) {
      toast("Choose a class in your registered teaching scope.", true);
      return;
    }
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const announcement = await AnnouncementService.saveAnnouncement(state.groups, {
        title: data.title,
        message: data.message,
        type: data.type,
        grade: selectedGroup.grade,
        stream: selectedGroup.stream,
        subject_id: data.subject_id || null,
        status: data.status,
        publish_at: data.publish_at,
      }, state.editing);
      $("announcementModalRoot").replaceChildren();
      await load();
      toast(announcement.status === "published" ? "Announcement published successfully." : "Announcement saved successfully.");
    } catch (error) {
      console.error("Unable to save announcement.", error);
      toast(error.message || "Unable to save this announcement.", true);
      submitButton.disabled = false;
    }
  }

  async function handleAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const item = state.announcements.find((row) => String(row.id) === String(button.dataset.id));
    if (!item) return;
    if (button.dataset.action === "edit" || button.dataset.action === "view") {
      openModal(item);
      return;
    }
    if (button.dataset.action === "delete" && window.confirm("Delete this announcement?")) {
      button.disabled = true;
      try {
        await AnnouncementService.deleteAnnouncement(item.id);
        await load();
        toast("Announcement deleted.");
      } catch (error) {
        console.error("Unable to delete announcement.", error);
        toast(error.message || "Unable to delete this announcement.", true);
        button.disabled = false;
      }
    }
  }

  async function refreshFromRealtime() {
    try {
      await load();
    } catch (error) {
      console.error("Unable to refresh announcements after a realtime update.", error);
      toast(error.message || "Announcements could not be refreshed.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("announcementMode").textContent = "Connecting…";
    try {
      state.context = await AnnouncementService.getTeacherContext();
      state.groups = await AnnouncementService.loadScope(state.context);
      window.AttendanceService?.setRegisteredTeachingScope(state.groups);
      populateClasses();
      populateTypes();
      await load();
      $("announcementMode").textContent = "Supabase mode";
      state.stopRealtime = AnnouncementService.subscribe(
        state.context,
        () => void refreshFromRealtime(),
        (error) => toast(error.message || "Live announcement updates are unavailable.", true),
      );
    } catch (error) {
      console.error("Announcements initialization error:", error);
      $("announcementMode").textContent = "Connection error";
      toast(error.message || "Announcements could not be loaded.", true);
    }

    const openCreateAnnouncement = () => {
      window.location.assign("create-announcement.html");
    };
    $("newAnnouncementButton").addEventListener("click", openCreateAnnouncement);
    $("newAnnouncementBanner").addEventListener("click", openCreateAnnouncement);
    $("classFilter").addEventListener("change", (event) => { state.grade = event.target.value; state.page = 1; renderTable(); });
    $("typeFilter").addEventListener("change", (event) => { state.type = event.target.value; state.page = 1; renderTable(); });
    $("statusFilter").addEventListener("change", (event) => { state.status = event.target.value.toLowerCase(); state.page = 1; renderTable(); });
    $("sortAnnouncements").addEventListener("change", (event) => { state.sort = event.target.value; renderTable(); });
    $("searchInput").addEventListener("input", (event) => { state.query = event.target.value.trim().toLowerCase(); state.page = 1; renderTable(); });
    $("pageButtons").addEventListener("click", (event) => {
      const page = Number(event.target.dataset.page);
      if (page) { state.page = page; renderTable(); }
    });
    $("announcementsTableBody").addEventListener("click", handleAction);
    $("draftList").addEventListener("click", (event) => {
      const id = event.target.closest("[data-draft]")?.dataset.draft;
      if (id) openModal(state.announcements.find((item) => String(item.id) === String(id)));
    });

    const createdStatus = new URLSearchParams(window.location.search).get("created");
    if (["draft", "scheduled", "published"].includes(createdStatus)) {
      const messages = {
        draft: "Draft saved successfully.",
        scheduled: "Announcement scheduled successfully.",
        published: "Announcement published successfully.",
      };
      toast(messages[createdStatus]);
      window.history.replaceState({}, "", window.location.pathname);
    }
  });

  window.addEventListener("beforeunload", () => state.stopRealtime());
})();
