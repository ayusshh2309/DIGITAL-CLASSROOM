(() => {
  const client = window.SmartLearningSupabase?.getClient?.();
  const button = document.querySelector(".student-notification-button");
  const badge = button?.querySelector(".student-notification-badge");
  if (badge) {
    badge.textContent = "0";
    badge.hidden = true;
  }
  if (!client || !button || !badge) return;

  const panel = document.createElement("section");
  panel.className = "student-announcement-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Announcements");
  panel.innerHTML = '<div class="student-announcement-panel-heading"><div class="student-announcement-heading-copy"><strong>Announcements</strong><span>Updates from your teachers</span></div><button type="button" aria-label="Close notifications"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div><div class="student-announcement-list" aria-live="polite"><p>Loading announcements…</p></div>';
  button.insertAdjacentElement("afterend", panel);

  const style = document.createElement("style");
  style.textContent = `
    .student-topbar-actions{position:relative}
    .student-announcement-panel{position:absolute;z-index:1000;right:0;top:calc(100% + 12px);width:min(390px,calc(100vw - 32px));max-height:min(520px,72vh);overflow:auto;background:#fff;border:1px solid #e5eaf1;border-radius:16px;box-shadow:0 20px 55px rgba(22,34,51,.2);color:#172638}
    .student-announcement-panel[hidden]{display:none}
    .student-announcement-panel-heading{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:17px 18px;background:rgba(255,255,255,.97);border-bottom:1px solid #edf0f4}
    .student-announcement-heading-copy{display:grid;gap:3px}
    .student-announcement-heading-copy strong{color:#172638;font-size:15px;font-weight:800;letter-spacing:-.01em}
    .student-announcement-heading-copy span{color:#8793a4;font-size:11px;font-weight:500}
    .student-announcement-panel-heading button{display:grid;width:32px;height:32px;place-items:center;border:1px solid #e6eaf0;border-radius:9px;background:#fff;cursor:pointer;color:#64748b;transition:background .15s ease,color .15s ease,border-color .15s ease}
    .student-announcement-panel-heading button:hover{border-color:#d6d0ff;background:#f5f3ff;color:#6045d8}
    .student-announcement-list{display:grid;gap:9px;padding:12px}
    .student-announcement-item{display:block;width:100%;padding:13px 14px;text-align:left;background:#fff;border:1px solid #e9edf3;border-radius:12px;cursor:pointer;color:inherit;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}
    .student-announcement-item:hover{border-color:#d8d2ff;background:#fcfbff;box-shadow:0 4px 12px rgba(31,45,75,.05)}
    .student-announcement-item.unread{border-left:3px solid #7257e8;background:#faf9ff;padding-left:12px}
    .student-announcement-item strong{display:block;color:#1d2b3d;font-size:13px;font-weight:800;line-height:1.4;overflow-wrap:anywhere}
    .student-announcement-item.unread strong:after{content:"";display:inline-block;width:7px;height:7px;margin-left:8px;border-radius:50%;background:#7257e8;vertical-align:middle}
    .student-announcement-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:7px}
    .student-announcement-type{display:inline-flex;align-items:center;min-height:21px;padding:3px 8px;border-radius:999px;background:#f0edff;color:#6248cf;font-size:10px;font-weight:800;line-height:1;text-transform:capitalize}
    .student-announcement-date{color:#8995a5;font-size:11px;font-weight:600}
    .student-announcement-item p{margin:9px 0 0;color:#526176;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
    .student-announcement-empty{margin:0;padding:24px 12px;color:#718196;font-size:13px;text-align:center}
    @media(max-width:480px){.student-announcement-panel{right:-8px;width:min(390px,calc(100vw - 20px));max-height:70vh}.student-announcement-list{padding:9px}}
  `;
  document.head.appendChild(style);

  const list = panel.querySelector(".student-announcement-list");
  const closeButton = panel.querySelector(".student-announcement-panel-heading button");
  let studentId = null;
  let channel = null;
  let records = [];
  let unreadCount = 0;

  function setBadge(count) {
    unreadCount = count;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    button.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
  }

  function render() {
    list.innerHTML = records.length
      ? records.map(({ recipient, announcement }) => `
        <button class="student-announcement-item${recipient.read_at ? "" : " unread"}" type="button" data-recipient-id="${escapeHtml(recipient.id)}">
          <strong>${escapeHtml(announcement.title)}</strong>
          <span class="student-announcement-meta"><span class="student-announcement-type">${escapeHtml(announcement.type || "Notice")}</span><time class="student-announcement-date">${formatDate(announcement.published_at || recipient.created_at)}</time></span>
          <p>${escapeHtml(announcement.message)}</p>
        </button>`).join("")
      : '<p class="student-announcement-empty">No announcements yet.</p>';
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[char]);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
  }

  async function load() {
    const { data: authResult, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authResult?.user) {
      list.innerHTML = '<p class="student-announcement-empty">Sign in to view announcements.</p>';
      setBadge(0);
      return;
    }

    const { data: student, error: studentError } = await client
      .from("students")
      .select("id")
      .eq("user_id", authResult.user.id)
      .single();
    if (studentError) throw studentError;
    studentId = student.id;

    const { count, error: unreadError } = await client
      .from("announcement_recipients")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .is("read_at", null);
    if (unreadError) throw unreadError;
    setBadge(count || 0);

    const { data: recipients, error: recipientError } = await client
      .from("announcement_recipients")
      .select("id, announcement_id, read_at, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (recipientError) throw recipientError;

    const ids = [...new Set((recipients || []).map((row) => row.announcement_id))];
    let announcements = [];
    if (ids.length) {
      const { data, error } = await client
        .from("announcements")
        .select("id, title, message, type, published_at")
        .in("id", ids)
        .eq("status", "published");
      if (error) throw error;
      announcements = data || [];
    }
    const byId = new Map(announcements.map((item) => [String(item.id), item]));
    records = (recipients || [])
      .filter((recipient) => byId.has(String(recipient.announcement_id)))
      .map((recipient) => ({ recipient, announcement: byId.get(String(recipient.announcement_id)) }));
    render();
    subscribe();
  }

  function subscribe() {
    if (!studentId || channel) return;
    channel = client.channel(`student-announcements-${studentId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "announcement_recipients",
        filter: `student_id=eq.${studentId}`,
      }, () => load().catch((error) => {
        console.error("Unable to refresh student announcements.", error);
      }))
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.error("Student announcement realtime subscription failed.");
      });
  }

  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  });
  closeButton.addEventListener("click", () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
  list.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-recipient-id]");
    if (!target) return;
    const item = records.find(({ recipient }) => String(recipient.id) === target.dataset.recipientId);
    if (!item || item.recipient.read_at) return;
    const { error } = await client.from("announcement_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("id", item.recipient.id)
      .is("read_at", null);
    if (error) {
      console.error("Unable to mark announcement as read.", error);
      return;
    }
    item.recipient.read_at = new Date().toISOString();
    setBadge(Math.max(0, unreadCount - 1));
    render();
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });

  load().catch((error) => {
    console.error("Unable to load student announcements.", error);
    list.innerHTML = '<p class="student-announcement-empty">Announcements could not be loaded.</p>';
    setBadge(0);
  });
})();
