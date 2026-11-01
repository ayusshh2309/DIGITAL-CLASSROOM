(() => {
  const PAGE_SIZE = 1000;
  const STUDY_SESSION_STATUSES = new Set(["active", "completed", "abandoned", "paused"]);
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const state = { client: null, user: null, studentId: null, definitions: [], unlocked: [], metrics: null };

  function setStatus(message, isError = false) {
    const status = $("achievementStatus");
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
    status.setAttribute("role", isError ? "alert" : "status");
    status.style.color = isError ? "#b83d4b" : "";
  }

  function setGridMessage(message, isError = false) {
    const grid = $("badgesGrid");
    if (!grid) return;
    grid.innerHTML = `<p class="empty-state"${isError ? ' role="alert"' : ' role="status"'}>${escapeHtml(message)}</p>`;
  }

  function renderRegistrationContext(student) {
    const context = $("registrationContext");
    const text = $("registrationContextText");
    if (!context || !text || !student?.grade) return;

    const grade = Number(student.grade);
    const stream = String(student.stream || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const streamLabels = {
      science_pcm: "Science (PCM)",
      science_pcb: "Science (PCB)",
      commerce: "Commerce",
      arts: "Arts / Humanities",
      arts_humanities: "Arts / Humanities",
    };
    const streamText = grade >= 11
      ? ` - ${streamLabels[stream] || stream.replace(/_/g, " ")}`
      : "";

    text.textContent = `Grade ${grade}${streamText}`;
    context.hidden = false;
  }

  function dateKey(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  async function readAllRows(createQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await createQuery().range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new Error("An achievement data query returned an invalid response.");
      }
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  function calculateStreak(sessions) {
    const days = [...new Set(sessions.map((session) => dateKey(session.ended_at)).filter(Boolean))].sort().reverse();
    if (!days.length) return { current: 0, best: 0 };
    const dayNumber = (key) => Date.parse(`${key}T00:00:00`);
    let best = 1;
    let run = 1;
    for (let index = 1; index < days.length; index += 1) {
      if (dayNumber(days[index - 1]) - dayNumber(days[index]) === 86400000) { run += 1; best = Math.max(best, run); } else run = 1;
    }
    const today = dateKey(new Date());
    const yesterday = dateKey(Date.now() - 86400000);
    let current = days[0] === today || days[0] === yesterday ? 1 : 0;
    for (let index = 1; current && index < days.length; index += 1) {
      if (dayNumber(days[index - 1]) - dayNumber(days[index]) === 86400000) current += 1; else break;
    }
    return { current, best: Math.max(best, current) };
  }

  function metricsFrom(rows) {
    const sessionsById = new Map(rows.sessions.map((session) => [String(session.id), session]));
    const segmentsBySession = new Map();
    for (const segment of rows.segments) {
      const session = sessionsById.get(String(segment.session_id));
      const duration = Number(segment.duration_seconds);
      const end = new Date(segment.ended_at);
      if (
        !STUDY_SESSION_STATUSES.has(String(session?.status || "").toLowerCase()) ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(end.getTime())
      ) continue;
      const segments = segmentsBySession.get(String(session.id)) || [];
      segments.push({ duration, end });
      segmentsBySession.set(String(session.id), segments);
    }
    const completedSessions = rows.sessions
      .filter((session) => session.status === "completed")
      .map((session) => {
        const segments = segmentsBySession.get(String(session.id)) || [];
        return {
          ...session,
          ended_at: segments.reduce(
            (latest, segment) => segment.end > latest ? segment.end : latest,
            new Date(0),
          ),
        };
      });
    const currentWeek = Date.now() - 7 * 86400000;
    const weeklyMinutes = rows.segments.reduce((total, segment) => {
      const session = sessionsById.get(String(segment.session_id));
      const end = new Date(segment.ended_at);
      const duration = Number(segment.duration_seconds);
      return STUDY_SESSION_STATUSES.has(String(session?.status || "").toLowerCase()) &&
        Number.isFinite(end.getTime()) && end.getTime() >= currentWeek &&
        Number.isFinite(duration) && duration > 0
        ? total + duration / 60
        : total;
    }, 0);
    const today = dateKey(new Date());
    const sessionsToday = completedSessions.filter((session) => dateKey(session.ended_at) === today).length;
    const highScoreQuizzes = rows.quizzes.filter((attempt) =>
      attempt.attempt_status === "submitted" &&
      attempt.result_released === true &&
      Number(attempt.percentage) >= 90,
    ).length;
    const streak = calculateStreak(completedSessions);
    return {
      completedSessions: completedSessions.length,
      sessionsToday,
      completedResources: rows.videos.filter((row) => row.completed).length,
      weeklyStudyMinutes: weeklyMinutes,
      highScoreQuizzes,
      studyStreak: streak.current,
      bestStreak: streak.best,
      challengesCompleted: 0,
      rankingPosition: null,
    };
  }

  function metricValue(definition) {
    const metrics = state.metrics || {};
    const metric = {
      sessions_in_day: "sessionsToday",
      study_streak: "studyStreak",
      high_score_quizzes: "highScoreQuizzes",
      weekly_study_minutes: "weeklyStudyMinutes",
      completed_sessions: "completedSessions",
      completed_resources: "completedResources",
      ranking_position: "rankingPosition",
    }[definition.requirement_type];
    return Number(metrics[metric] || 0);
  }

  async function loadRows() {
    const [videos, quizAttempts, sessions, definitions, unlocked] = await Promise.all([
      readAllRows(() => state.client.from("student_video_progress")
        .select("video_id,completed")
        .eq("student_id", state.user.id)
        .order("video_id", { ascending: true })),
      readAllRows(() => state.client.from("quiz_attempts")
        .select("id,status,percentage,submitted_at")
        .eq("student_id", state.studentId)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true })),
      readAllRows(() => state.client.from("study_sessions")
        .select("id,status")
        .eq("student_id", state.studentId)
        .order("id", { ascending: true })),
      readAllRows(() => state.client.from("achievement_definitions")
        .select("id,name,description,icon,color,category,requirement_type,requirement_value,xp_reward")
        .eq("active", true)
        .order("created_at", { ascending: true })),
      readAllRows(() => state.client.from("student_achievements")
        .select("achievement_id,unlocked_at,achievement_definition:achievement_definitions(id,name,description,icon,color,category,requirement_type,requirement_value,xp_reward)")
        .eq("student_id", state.user.id)
        .order("unlocked_at", { ascending: false })
        .order("achievement_id", { ascending: true })),
    ]);
    const sessionIds = sessions.map((session) => String(session.id));
    const segments = [];
    for (let index = 0; index < sessionIds.length; index += 100) {
      const batch = sessionIds.slice(index, index + 100);
      segments.push(...await readAllRows(() => state.client
        .from("study_session_segments")
        .select("id,session_id,started_at,ended_at,duration_seconds")
        .in("session_id", batch)
        .order("id", { ascending: true })));
    }
    return {
      sessions,
      segments,
      videos,
      quizzes: quizAttempts,
      definitions,
      unlocked,
    };
  }

  async function refreshAchievements() {
    if (!state.client || !state.user) return;
    const rows = await loadRows();
    state.metrics = metricsFrom(rows);
    state.definitions = rows.definitions;
    state.unlocked = rows.unlocked.map((item) => ({
      ...item,
      definition: item.achievement_definition,
    }));
    render();
  }

  async function evaluateStudentAchievements() {
    const { data, error } = await state.client.rpc("evaluate_student_achievements_v1");
    if (error) throw error;
    console.info("Student achievements evaluated.", { result: data });
  }

  function unlockedFor(definition) { return state.unlocked.find((item) => item.achievement_id === definition.id); }
  function percent(value, total) { return total ? Math.min(100, Math.round(value / total * 100)) : 0; }
  function relativeDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function formatUnlockDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Date unavailable";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function renderBadges() {
    const grid = $("badgesGrid");
    if (!grid) return;
    $("badgesCard").style.display = "";
    if (!state.definitions.length) {
      grid.innerHTML = '<p class="empty-state">No achievements are available yet.</p>';
      return;
    }
    grid.innerHTML = state.definitions.map((definition) => {
      const unlock = unlockedFor(definition);
      const earned = Boolean(unlock);
      const requirement = Number(definition.requirement_value) || 0;
      const current = Math.min(metricValue(definition), requirement);
      const progress = percent(current, requirement);
      const xp = Number(definition.xp_reward) || 0;
      const unlockText = earned
        ? `Unlocked ${formatUnlockDate(unlock.unlocked_at)}`
        : `${Math.max(0, requirement - current)} remaining`;
      return `<div class="badge-card ${earned ? "earned" : "locked"}" data-status="${earned ? "earned" : "locked"}" data-achievement-id="${escapeHtml(definition.id)}"><div class="badge-big ${earned ? `badge-${escapeHtml(definition.color)}` : ""}"><i class="fa-solid ${escapeHtml(definition.icon)}"></i></div><h3>${escapeHtml(definition.name)}</h3><p>${escapeHtml(definition.description)}</p><div class="next-progress"><div class="next-progress-bar"><div class="next-progress-fill" style="width:${earned ? 100 : progress}%"></div></div><div class="next-progress-text"><span>${current} / ${requirement}</span><span>${progress}%</span></div></div><span class="${earned ? "badge-check" : "badge-lock"}"><i class="fa-solid fa-${earned ? "check" : "lock"}"></i> ${earned ? "Earned" : "Locked"}</span><p>${xp} XP · ${escapeHtml(unlockText)}</p></div>`;
    }).join("");
  }

  function render() {
    const earned = state.definitions.filter(unlockedFor).length;
    const total = state.definitions.length;
    const completion = percent(earned, total);
    const metrics = state.metrics || {};
    const earnedAchievementXp = state.unlocked.reduce(
      (sum, item) => sum + Number(item.definition?.xp_reward || 0),
      0,
    );
    $("totalPoints").textContent = `${earnedAchievementXp.toLocaleString()} XP`;
    $("earnedCount").textContent = earned;
    $("availableCount").textContent = `Out of ${total} available`;
    $("currentStreak").textContent = `${metrics.studyStreak || 0} Days`;
    $("bestStreak").textContent = `Your best is ${metrics.bestStreak || 0} days`;
    $("challengesCompleted").textContent = metrics.challengesCompleted || 0;
    $("challengesPeriod").textContent = "Configured challenges";
    $("achievementRank").textContent = "Not ranked";
    $("rankDescription").textContent = "Ranking is not enabled";
    $("completionPercent").textContent = `${completion}%`;
    $("progressDescription").textContent = `You have unlocked ${earned} out of ${total} available achievements.`;
    $("progressFill").style.width = `${completion}%`;
    $("earnedLabel").textContent = `${earned} earned`;
    $("remainingLabel").textContent = `${Math.max(0, total - earned)} remaining`;
    $("categoryCard").style.display = total ? "" : "none";
    const locked = state.definitions.filter((definition) => !unlockedFor(definition)).sort((a, b) => metricValue(b) / Number(b.requirement_value) - metricValue(a) / Number(a.requirement_value))[0];
    if (locked) {
      const current = Math.min(metricValue(locked), Number(locked.requirement_value));
      $("nextAchievementName").textContent = locked.name;
      $("nextAchievementDescription").textContent = locked.description;
      $("nextAchievementIcon").className = `fa-solid ${locked.icon}`;
      $("nextProgressFill").style.width = `${percent(current, Number(locked.requirement_value))}%`;
      $("nextProgressLabel").textContent = `${current} / ${locked.requirement_value}`;
      $("nextRemainingLabel").textContent = `${Math.max(0, Number(locked.requirement_value) - current)} more`;
    } else {
      $("nextProgressFill").style.width = "0%";
      $("nextProgressLabel").textContent = "0 / 0";
      $("nextRemainingLabel").textContent = "0 more";
    }
    const recent = [...state.unlocked].sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at)).slice(0, 5).map((item) => {
      const definition = state.definitions.find((entry) => entry.id === item.achievement_id);
      if (!definition) return "";
      return `<div class="achievement-item"><div class="achievement-left"><div class="badge badge-${escapeHtml(definition.color)}"><i class="fa-solid ${escapeHtml(definition.icon)}"></i></div><div class="achievement-info"><strong>${escapeHtml(definition.name)}</strong><span>${escapeHtml(definition.description)}</span></div></div><div class="earned-date">${relativeDate(item.unlocked_at)}</div></div>`;
    }).join("");
    $("recentAchievements").innerHTML = recent || '<p class="empty-state">No achievements unlocked yet.</p>';
    renderBadges();
    renderCategories();
  }

  function renderCategories() {
    const grid = $("categoryGrid");
    if (!grid) return;
    [...grid.querySelectorAll(".category")].forEach((category) => {
      const name = category.querySelector(".category-name")?.textContent.trim();
      const definitions = state.definitions.filter((definition) => String(definition.category || "").toLowerCase() === String(name).toLowerCase());
      const earned = definitions.filter(unlockedFor).length;
      const value = percent(earned, definitions.length);
      category.querySelector(".category-percent").textContent = `${value}%`;
      category.querySelector(".category-fill").style.width = `${value}%`;
    });
  }

  function bindFilters() {
    document.querySelectorAll(".filter-btn").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $("badgesGrid").querySelectorAll(".badge-card").forEach((card) => {
        card.style.display = button.dataset.filter === "all" ||
          card.dataset.status === button.dataset.filter
          ? "block"
          : "none";
      });
    }));
    $("badgesGrid").addEventListener("click", (event) => {
      const card = event.target.closest(".badge-card");
      if (!card) return;
      const title = card.querySelector("h3");
      if (!title) return;
      window.alert(card.dataset.status === "locked"
        ? `${title.textContent.trim()} is still locked. Keep learning to unlock it!`
        : `🏆 ${title.textContent.trim()} achievement earned!`);
    });
  }

  async function init() {
    bindFilters();
    render();
    setStatus("Loading your achievements…");
    setGridMessage("Loading your achievements…");
    const supabase = window.SmartLearningSupabase;
    if (!supabase || typeof supabase.getClient !== "function") {
      const message = "The existing Supabase client is unavailable on this page.";
      console.error(message);
      setStatus(message, true);
      setGridMessage(message, true);
      return;
    }
    try {
      state.client = supabase.getClient();
    } catch (error) {
      const message = `The existing Supabase client could not be initialized: ${error.message || "Unknown error."}`;
      console.error(message, error);
      setStatus(message, true);
      setGridMessage(message, true);
      return;
    }
    if (!state.client) {
      const configured = typeof supabase.isConfigured === "function"
        ? supabase.isConfigured()
        : null;
      const message = configured === true
        ? "Supabase reports that it is configured, but getClient() did not return a client."
        : "Supabase did not provide a client. Check the existing client initialization.";
      console.error(message);
      setStatus(message, true);
      setGridMessage(message, true);
      return;
    }
    let authData;
    try {
      const { data, error } = await state.client.auth.getUser();
      if (error) throw error;
      authData = data;
    } catch (error) {
      const message = `Could not verify your student session: ${error.message || "Please sign in again."}`;
      console.error(message, error);
      setStatus(message, true);
      setGridMessage(message, true);
      return;
    }
    state.user = authData?.user || null;
    if (!state.user) {
      const message = "Sign in with your student account to view achievements.";
      setStatus(message, true);
      setGridMessage(message, true);
      return;
    }

    try {
      const { data: student, error } = await state.client
        .from("students")
        .select("id, grade, stream")
        .eq("user_id", state.user.id)
        .single();
      if (error) throw error;
      if (!student?.id) throw new Error("Your student registration could not be found.");
      renderRegistrationContext(student);
      state.studentId = String(student.id);

      let evaluationError = null;
      try {
        await evaluateStudentAchievements();
      } catch (error) {
        console.error("Could not evaluate student achievements on page load.", error);
        evaluationError = error;
      }
      await refreshAchievements();
      setStatus(
        evaluationError
          ? "Achievement evaluation failed; showing your latest saved achievements."
          : "",
        Boolean(evaluationError),
      );

      state.client.channel(`achievements-${state.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "student_video_progress", filter: `student_id=eq.${state.user.id}` }, () => {
          void refreshAchievements().catch((refreshError) => {
            console.error("Could not refresh achievements after video progress changed.", refreshError);
            setStatus("Achievements could not be refreshed. Please reload the page.", true);
            setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "quiz_attempts", filter: `student_id=eq.${state.studentId}` }, () => {
          void refreshAchievements().catch((refreshError) => {
            console.error("Could not refresh achievements after quiz progress changed.", refreshError);
            setStatus("Achievements could not be refreshed. Please reload the page.", true);
            setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "student_achievements", filter: `student_id=eq.${state.user.id}` }, () => {
          void refreshAchievements().catch((refreshError) => {
            console.error("Could not refresh achievements after an unlock changed.", refreshError);
            setStatus("Achievements could not be refreshed. Please reload the page.", true);
            setGridMessage("Achievements could not be refreshed. Please reload the page.", true);
          });
        })
        .subscribe();
    } catch (error) {
      console.error("Achievements are unavailable.", error);
      const message = `Could not load achievements from Supabase: ${error.message || "Please try again."}`;
      setStatus(message, true);
      setGridMessage(message, true);
    }
  }

  window.StudentAchievements = { refresh: refreshAchievements };
  document.addEventListener("DOMContentLoaded", () => void init());
})();
