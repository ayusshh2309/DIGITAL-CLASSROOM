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
  panel.innerHTML = '<div class="student-announcement-panel-heading"><strong>Announcements</strong><button type="button" aria-label="Close notifications">×</button></div><div class="student-announcement-list" aria-live="polite"><p>Loading announcements…</p></div>';
  button.insertAdjacentElement("afterend", panel);

  const style = document.createElement("style");
  style.textContent = `
    .student-topbar-actions{position:relative}
    .student-announcement-panel{position:absolute;z-index:1000;right:0;top:calc(100% + 12px);width:min(360px,calc(100vw - 32px));max-height:min(480px,70vh);overflow:auto;background:#fff;border:1px solid #e6eaf0;border-radius:14px;box-shadow:0 14px 40px rgba(22,34,51,.18);color:#1f2937}
    .student-announcement-panel[hidden]{display:none}
    .student-announcement-panel-heading{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:15px 18px;background:#fff;border-bottom:1px solid #edf0f4}
    .student-announcement-panel-heading button{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#64748b}
    .student-announcement-list{padding:6px 14px}
    .student-announcement-item{display:block;width:100%;padding:12px 5px;text-align:left;background:#fff;border:0;border-bottom:1px solid #edf0f4;cursor:pointer;color:inherit}
    .student-announcement-item:last-child{border-bottom:0}
    .student-announcement-item.unread strong:after{content:"";display:inline-block;width:7px;height:7px;margin-left:7px;border-radius:50%;background:#087f8a;vertical-align:middle}
    .student-announcement-item strong{display:block;font-size:14px}
    .student-announcement-item span{display:block;margin-top:4px;color:#64748b;font-size:12px}
    .student-announcement-item p{margin:7px 0 0;color:#475569;font-size:13px;line-height:1.45;white-space:pre-wrap}
    .student-announcement-empty{padding:16px 4px;color:#64748b;font-size:13px}
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
          <span>${escapeHtml(announcement.type || "Notice")} · ${formatDate(announcement.published_at || recipient.created_at)}</span>
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
